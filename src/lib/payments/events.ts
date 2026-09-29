import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db as appDb } from '../db';
import { orders, paymentEvents, type DbClient } from '../../../lib/db';
import { BalanceCapExceeded, IllegalOrderTransition, wallet as appWallet, type LedgerActor, type Order, type Wallet } from '../wallet';
import { fulfilPaidOrder } from '../order-fulfilment';
import type { ChargeState, PaymentProvider } from './gateway';

/**
 * The single entry for everything a payment provider tells Horo
 * (docs/wallet.md, Payments): the webhook (I3), the dev pay route, and the
 * missed-webhook recovery (`lookupCharge`). A client never changes an order.
 */

/** The provider reported less than the order costs, or another currency. Nothing is credited. */
export class PaymentAmountMismatch extends Error {
  constructor(
    readonly orderId: string,
    readonly expected: { amountSatang: number; currency: string },
    readonly received: { amountSatang: number; currency: string },
  ) {
    super(
      `Order ${orderId}: provider reported ${received.amountSatang} ${received.currency}, expected ${expected.amountSatang} ${expected.currency}`,
    );
  }
}

export type PaymentEventKind =
  | ChargeState['status']
  | 'amount_mismatch'
  | 'excess_payment'
  | 'illegal_transition'
  | 'unknown_order'
  | 'credit_failed_cap';

export type ProviderEvent = {
  provider: PaymentProvider;
  /** The provider's id for this notification; unique per provider. */
  eventRef: string;
  /** The charge it is about (orders.provider_ref). */
  providerRef: string;
  state: ChargeState;
  /** 'webhook': the provider told us. 'lookup': Horo asked it (lookupCharge), so there is no event id. */
  source: 'webhook' | 'lookup';
};

export type EventDeps = {
  db: DbClient;
  wallet: Wallet;
  fulfil: (orderId: string, actor: LedgerActor) => Promise<{ credited: boolean; balance: number; unlockStatus: number | null }>;
};

const appDeps: EventDeps = { db: appDb, wallet: appWallet, fulfil: fulfilPaidOrder };

type Writer = DbClient | Parameters<Parameters<DbClient['transaction']>[0]>[0];

/** Inserts the event row; false when (provider, event_ref) is already recorded. */
async function record(writer: Writer, row: { provider: string; eventRef: string; orderId: string | null; kind: PaymentEventKind; payload: object }) {
  const payloadHash = createHash('sha256').update(JSON.stringify(row.payload)).digest('hex');
  const inserted = await writer
    .insert(paymentEvents)
    .values({ ...row, payloadHash })
    .onConflictDoNothing()
    .returning({ id: paymentEvents.id });
  return inserted.length > 0;
}

/**
 * What the event means for this order. A succeeded charge must match the
 * order's currency and at least its amount: less, or another currency, is
 * `amount_mismatch` and credits nothing; more is `excess_payment`, which pays
 * the order and leaves the excess to an admin.
 */
function classify(order: Order | null, state: ChargeState): PaymentEventKind {
  if (!order) return 'unknown_order';
  if (state.status !== 'succeeded') return state.status;
  if (state.currency !== order.currency || state.amountSatang < order.amountSatang) return 'amount_mismatch';
  if (state.amountSatang > order.amountSatang) return 'excess_payment';
  return 'succeeded';
}

/**
 * Records the event, then applies it, once.
 *
 * 1. One transaction: insert into payment_events (a duplicate
 *    (provider, event_ref) inserts nothing and changes no order), and apply
 *    the transition with the order row locked.
 * 2. After commit, a paid order is fulfilled (credit, then unlock unlock_ref).
 *    This also runs for a duplicate of a paid order: fulfilment is idempotent,
 *    so a provider retry after a failed fulfilment finishes it and never
 *    credits twice.
 *
 * Throws PaymentAmountMismatch (recorded as amount_mismatch) and
 * IllegalOrderTransition (recorded as illegal_transition), so the provider
 * sees a failure. A credit refused by the cap is recorded as
 * credit_failed_cap, the order stays paid and is flagged needs_review.
 */
export async function handleProviderEvent(event: ProviderEvent, deps: EventDeps = appDeps) {
  const { provider, eventRef, providerRef, state } = event;
  const [order] = await deps.db
    .select()
    .from(orders)
    .where(and(eq(orders.provider, provider), eq(orders.providerRef, providerRef)))
    .limit(1);
  const kind = classify(order ?? null, state);
  const payload = kind === 'amount_mismatch' || kind === 'excess_payment'
    ? { ...state, expectedAmountSatang: order!.amountSatang, expectedCurrency: order!.currency }
    : state;
  const row = { provider, eventRef, orderId: order?.id ?? null, kind, payload };

  if (!order) {
    const recorded = await record(deps.db, row);
    return { outcome: 'unknown_order' as const, duplicate: !recorded };
  }
  if (kind === 'amount_mismatch') {
    await record(deps.db, row);
    throw new PaymentAmountMismatch(order.id, order, state);
  }

  let duplicate: boolean;
  try {
    duplicate = await deps.db.transaction(async (tx) => {
      // Lock the order before recording: the event's foreign key takes a share lock on the order row,
      // and two events each holding one would deadlock on the FOR UPDATE that follows.
      await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, order.id)).for('update');
      if (!(await record(tx, row))) return true;
      if (kind === 'succeeded' || kind === 'excess_payment') await deps.wallet.markPaidWithin(tx, order.id);
      else if (kind === 'failed' || kind === 'canceled') await deps.wallet.markFailedWithin(tx, order.id);
      return false;
    });
  } catch (error) {
    if (error instanceof IllegalOrderTransition) {
      await record(deps.db, { ...row, eventRef: `${eventRef}:illegal_transition`, kind: 'illegal_transition' });
    }
    throw error;
  }

  const [now] = await deps.db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id));
  if (now.status !== 'paid') return { outcome: now.status, duplicate };

  // The webhook names its event; a lookup has only the charge id.
  const label = event.source === 'lookup' ? `${provider}:${providerRef}` : `${provider}:${eventRef}`;
  try {
    const fulfilled = await deps.fulfil(order.id, { type: 'system', label });
    return { outcome: 'paid' as const, duplicate, ...fulfilled };
  } catch (error) {
    if (!(error instanceof BalanceCapExceeded)) throw error;
    await deps.db.transaction(async (tx) => {
      await record(tx, {
        provider,
        eventRef: `${eventRef}:credit_failed_cap`,
        orderId: order.id,
        kind: 'credit_failed_cap',
        payload: { balance: error.balance, credit: error.credit, cap: error.cap },
      });
      await deps.wallet.markNeedsReviewWithin(tx, order.id);
    });
    return { outcome: 'paid' as const, duplicate, credited: false, needsReview: true };
  }
}
