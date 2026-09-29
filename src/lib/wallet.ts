import { and, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db as appDb } from './db';
import { compatibility, orders, walletLedger, type DbClient } from '../../lib/db';
import {
  HISTORY_KINDS,
  type ActorType,
  type HistoryKind,
  type LedgerBy,
  type LedgerEntry,
  type LedgerKind,
  type PackId,
  type ProductId,
} from '../../lib/shared/types/wallet';
import {
  BALANCE_CAP,
  BONUS_TTL_DAYS,
  CURRENCY,
  PACKS,
  PRODUCT_PRICES,
  WELCOME_GIFT,
  packAmountSatang,
  type SpendableProductId,
} from './pricing';

/**
 * The มู ledger (docs/wallet.md). Balance = SUM(delta) over an
 * append-only table. Every write that depends on the balance runs in one
 * transaction holding a per-user advisory lock, so two taps at once are
 * serialized and the balance never goes negative or over the cap. The partial
 * unique indexes in lib/db/schema/wallet.ts make every credit and spend
 * idempotent even without the lock.
 */

/** A spend needs more than the balance holds. The unlock route answers 402. */
export class InsufficientBalance extends Error {
  constructor(
    readonly balance: number,
    readonly price: number,
  ) {
    super(`Insufficient balance: balance ${balance}, price ${price}`);
  }
}

/** A credit would take the balance above BALANCE_CAP. */
export class BalanceCapExceeded extends Error {
  constructor(
    readonly balance: number,
    readonly credit: number,
    readonly cap: number = BALANCE_CAP,
  ) {
    super(`Balance cap: balance ${balance} + ${credit} > ${cap}`);
  }
}

/**
 * This thing was bought and the spend refunded. The spend index allows one
 * spend per thing, so it can't be charged again; what to offer is T13's call.
 */
export class SpendRefunded extends Error {
  constructor(
    readonly productId: ProductId,
    readonly refId: string,
  ) {
    super(`Spend on ${productId}/${refId} was refunded`);
  }
}

/** creditOrder on an order the provider has not marked paid. */
export class OrderNotPaid extends Error {
  constructor(
    readonly orderId: string,
    readonly status: string,
  ) {
    super(`Order ${orderId} is ${status}, not paid`);
  }
}

/**
 * An order transition the state machine forbids: paid only from pending,
 * failed or expired; refunded is terminal (docs/wallet.md, Payments).
 */
export class IllegalOrderTransition extends Error {
  constructor(
    readonly orderId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Order ${orderId}: ${from} → ${to} is not allowed`);
  }
}

/** An order row. */
export type Order = typeof orders.$inferSelect;

/** What a provider returned when it started an order's charge (src/lib/payments/gateway.ts). */
export type AttachedCharge = {
  providerRef: string;
  qr: { data: string; imagePngUrl: string | null; imageSvgUrl: string | null };
  expiresAt: Date;
};

/** Cancels an order's charge before it expires; false when the charge already succeeded (keep the order pending). */
export type CancelCharge = (order: Order) => Promise<boolean>;

/**
 * Who caused a ledger row. Every insert takes one (insertLedger), so the
 * audit trail can't be skipped. 'system' labels e.g. 'stripe:<event id>'.
 */
export type LedgerActor =
  | { type: 'user'; id: string }
  | { type: 'system'; label?: string }
  | { type: 'admin'; id: string; email: string }
  | { type: 'dev'; label: string };

/** A refund of a spend is made by an admin (T13) or automatically by the system. */
export type RefundActor = Extract<LedgerActor, { type: 'admin' | 'system' }>;

/** adjust refused: no reason given, or the actor is not an admin or dev. */
export class InvalidAdjustment extends Error {}

function actorColumns(actor: LedgerActor) {
  switch (actor.type) {
    case 'user':
      return { actorType: actor.type, actorId: actor.id, actorLabel: null };
    case 'system':
      return { actorType: actor.type, actorId: null, actorLabel: actor.label ?? null };
    case 'admin':
      return { actorType: actor.type, actorId: actor.id, actorLabel: actor.email };
    case 'dev':
      return { actorType: actor.type, actorId: null, actorLabel: actor.label };
  }
}

/** What a user is shown as the cause of a row. Admin identity never reaches the user. */
export function ledgerBy(actorType: ActorType): LedgerBy {
  if (actorType === 'user') return 'you';
  if (actorType === 'admin') return 'team';
  return 'horo';
}

/** A transaction on the app database, e.g. the one that also writes what was bought. */
export type WalletTx = Parameters<Parameters<DbClient['transaction']>[0]>[0];
type Tx = WalletTx;
type Reader = DbClient | Tx;

type LedgerRow = Omit<typeof walletLedger.$inferInsert, 'actorType' | 'actorId' | 'actorLabel'>;

/** The one way to write a ledger row: every row records its actor. */
function insertLedger(writer: Reader, rows: LedgerRow | LedgerRow[], actor: LedgerActor) {
  const who = actorColumns(actor);
  return writer.insert(walletLedger).values((Array.isArray(rows) ? rows : [rows]).map((row) => ({ ...row, ...who })));
}

async function sumBalance(reader: Reader, userId: string): Promise<number> {
  const [row] = await reader
    .select({ balance: sql<number>`coalesce(sum(${walletLedger.delta}), 0)::int` })
    .from(walletLedger)
    .where(eq(walletLedger.userId, userId));
  return row.balance;
}

/** Serializes every balance-dependent write for one user until the transaction ends. */
async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}

function toEntry(row: typeof walletLedger.$inferSelect, refName: string | null, amountSatang: number | null): LedgerEntry {
  return {
    id: row.id,
    delta: row.delta,
    kind: row.kind as LedgerKind,
    productId: row.productId as ProductId | null,
    refId: row.refId,
    refName,
    note: row.note,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    by: ledgerBy(row.actorType as ActorType),
    amountBaht: amountSatang === null ? null : amountSatang / 100,
  };
}

export function createWallet(db: DbClient) {
  const balance = (userId: string) => sumBalance(db, userId);

  /** Grants WELCOME_GIFT once per account; later calls and concurrent first touches insert nothing. */
  async function ensureWelcome(userId: string): Promise<void> {
    await insertLedger(db, { userId, delta: WELCOME_GIFT, kind: 'welcome', note: 'ของขวัญต้อนรับ' }, { type: 'system' })
      .onConflictDoNothing();
  }

  /**
   * Read-only pre-check, no lock: may this balance pay `price` right now? A
   * later spendWithin re-checks under the lock, so a race still can't overdraw.
   */
  async function canAfford(userId: string, price: number) {
    const current = await balance(userId);
    return { ok: current >= price, balance: current, price };
  }

  /**
   * Charges the product's price once per (user, product, refId) inside the
   * caller's transaction, under the per-user advisory lock (held until that
   * transaction ends). Commit the spend in the same transaction as the thing it
   * buys, so a failed delivery rolls the charge back. A repeat call for
   * something already paid returns charged: false and costs nothing.
   */
  async function spendWithin(tx: WalletTx, userId: string, productId: SpendableProductId, refId: string) {
    const price = PRODUCT_PRICES[productId];
    await lockUser(tx, userId);
    const sameThing = and(
      eq(walletLedger.userId, userId),
      eq(walletLedger.productId, productId),
      eq(walletLedger.refId, refId),
    );
    const prior = await tx
      .select({ kind: walletLedger.kind })
      .from(walletLedger)
      .where(and(sameThing, sql`${walletLedger.kind} in ('spend', 'refund')`));
    if (prior.some((row) => row.kind === 'refund')) throw new SpendRefunded(productId, refId);

    const current = await sumBalance(tx, userId);
    if (prior.length > 0) return { charged: false as const, balance: current };
    if (current < price) throw new InsufficientBalance(current, price);

    await insertLedger(tx, { userId, delta: -price, kind: 'spend', productId, refId }, { type: 'user', id: userId });
    return { charged: true as const, balance: current - price };
  }

  /**
   * Read-only, no lock: is this thing already paid for (a spend, not refunded)?
   * A later spendWithin for it charges nothing.
   */
  async function hasPaid(userId: string, productId: SpendableProductId, refId: string): Promise<boolean> {
    const rows = await db
      .select({ kind: walletLedger.kind })
      .from(walletLedger)
      .where(
        and(
          eq(walletLedger.userId, userId),
          eq(walletLedger.productId, productId),
          eq(walletLedger.refId, refId),
          sql`${walletLedger.kind} in ('spend', 'refund')`,
        ),
      );
    return rows.some((row) => row.kind === 'spend') && !rows.some((row) => row.kind === 'refund');
  }

  /** spendWithin in a transaction of its own. */
  async function spend(userId: string, productId: SpendableProductId, refId: string) {
    return db.transaction((tx) => spendWithin(tx, userId, productId, refId));
  }

  /**
   * Gives a spend's price back. At most once per spend; the thing can't be
   * charged again afterwards (see SpendRefunded).
   */
  async function refundSpend(userId: string, productId: SpendableProductId, refId: string, note: string, actor: RefundActor) {
    return db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const [spent] = await tx
        .select({ delta: walletLedger.delta })
        .from(walletLedger)
        .where(
          and(
            eq(walletLedger.userId, userId),
            eq(walletLedger.productId, productId),
            eq(walletLedger.refId, refId),
            eq(walletLedger.kind, 'spend'),
          ),
        );
      if (!spent) throw new Error(`No spend to refund for ${productId}/${refId}`);
      const inserted = await insertLedger(tx, { userId, delta: -spent.delta, kind: 'refund', productId, refId, note }, actor)
        .onConflictDoNothing()
        .returning({ id: walletLedger.id });
      return { refunded: inserted.length > 0, balance: await sumBalance(tx, userId) };
    });
  }

  /**
   * Creates a pending order for a pack, refused if paying it would pass the cap.
   * `unlockRef`: the ดวงคู่ row to unlock once the order is paid (one-flow purchase).
   */
  async function createOrder(userId: string, packId: PackId, unlockRef?: string) {
    const pack = PACKS[packId];
    const current = await balance(userId);
    if (current + pack.base + pack.bonus > BALANCE_CAP) throw new BalanceCapExceeded(current, pack.base + pack.bonus);
    const [order] = await db
      .insert(orders)
      .values({
        userId,
        packId,
        amountSatang: packAmountSatang(pack),
        currency: CURRENCY,
        unitsBase: pack.base,
        unitsBonus: pack.bonus,
        provider: 'stripe',
        unlockRef: unlockRef ?? null,
      })
      .returning();
    return order;
  }

  /** The order if it belongs to this user. */
  async function getOrder(userId: string, orderId: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
      .limit(1);
    return order ?? null;
  }

  /**
   * Credits a paid order's base and bonus. Idempotent: a replayed webhook
   * credits nothing the second time. A credit past the cap is refused, and the
   * paid order then needs a manual refund (T13). `actor` is whoever confirmed
   * the payment: the webhook ({ type: 'system', label: 'stripe:<event id>' }),
   * an admin, or dev.
   */
  async function creditOrder(orderId: string, actor: LedgerActor) {
    return db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) throw new Error(`Order ${orderId} not found`);
      if (order.status !== 'paid') throw new OrderNotPaid(orderId, order.status);
      await lockUser(tx, order.userId);

      const [already] = await tx
        .select({ id: walletLedger.id })
        .from(walletLedger)
        .where(and(eq(walletLedger.orderId, orderId), eq(walletLedger.kind, 'purchase')))
        .limit(1);
      const current = await sumBalance(tx, order.userId);
      const who = { userId: order.userId, unlockRef: order.unlockRef };
      if (already) return { credited: false as const, balance: current, ...who };

      const credit = order.unitsBase + order.unitsBonus;
      if (current + credit > BALANCE_CAP) throw new BalanceCapExceeded(current, credit);

      const rows: LedgerRow[] = [
        { userId: order.userId, delta: order.unitsBase, kind: 'purchase', orderId },
      ];
      if (order.unitsBonus > 0) {
        const expiresAt = new Date(Date.now() + BONUS_TTL_DAYS * 24 * 60 * 60 * 1000);
        rows.push({ userId: order.userId, delta: order.unitsBonus, kind: 'bonus', orderId, expiresAt });
      }
      await insertLedger(tx, rows, actor);
      return { credited: true as const, balance: current + credit, ...who };
    });
  }

  /**
   * Admin or dev correction. Never takes the balance below 0 or above the cap.
   * `note` is the reason and is required; the actor must be an admin or dev.
   */
  async function adjust(userId: string, delta: number, note: string, actor: LedgerActor) {
    if (!Number.isInteger(delta) || delta === 0) throw new Error(`adjust needs a non-zero integer, got ${delta}`);
    if (note.trim() === '') throw new InvalidAdjustment('adjust needs a note (the reason)');
    if (actor.type !== 'admin' && actor.type !== 'dev') throw new InvalidAdjustment(`adjust refused for actor ${actor.type}`);
    return db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const current = await sumBalance(tx, userId);
      if (current + delta > BALANCE_CAP) throw new BalanceCapExceeded(current, delta);
      if (current + delta < 0) throw new InsufficientBalance(current, -delta);
      await insertLedger(tx, { userId, delta, kind: 'admin_adjust', note }, actor);
      return { balance: current + delta };
    });
  }

  /**
   * The order state machine (docs/wallet.md, Payments). Each transition runs
   * with the order row locked (SELECT … FOR UPDATE).
   *
   * → paid from pending, failed or expired: the provider confirmed the money,
   * and a late scan after Horo's timer or a failure must still credit. From
   * paid it is a no-op ({ marked: false }); from refunded it throws
   * IllegalOrderTransition. The caller checks the amount first
   * (src/lib/payments/events.ts) and records the event in the same transaction.
   */
  async function markPaidWithin(tx: WalletTx, orderId: string, now = new Date()) {
    const [order] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.status === 'paid') return { marked: false };
    if (order.status === 'refunded') throw new IllegalOrderTransition(orderId, order.status, 'paid');
    await tx.update(orders).set({ status: 'paid', paidAt: now }).where(eq(orders.id, orderId));
    return { marked: true };
  }

  /** markPaidWithin in a transaction of its own. */
  async function markPaid(orderId: string) {
    return db.transaction((tx) => markPaidWithin(tx, orderId));
  }

  /** pending → failed. Any other state is left alone: paid is terminal, and a failure after expiry changes nothing. */
  async function markFailedWithin(tx: WalletTx, orderId: string, now = new Date()) {
    const [order] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.status !== 'pending') return { marked: false };
    await tx.update(orders).set({ status: 'failed', failedAt: now }).where(eq(orders.id, orderId));
    return { marked: true };
  }

  /** Flags a paid order the webhook could not credit, for the admin page. */
  async function markNeedsReviewWithin(tx: WalletTx, orderId: string) {
    await tx.update(orders).set({ needsReview: true }).where(eq(orders.id, orderId));
  }

  /**
   * Stores the provider's charge on a pending order: provider, providerRef, the
   * QR and when Horo stops offering it.
   */
  async function attachCharge(orderId: string, provider: string, charge: AttachedCharge): Promise<Order> {
    const [order] = await db
      .update(orders)
      .set({
        provider,
        providerRef: charge.providerRef,
        qrData: charge.qr.data,
        qrPngUrl: charge.qr.imagePngUrl,
        qrSvgUrl: charge.qr.imageSvgUrl,
        expiresAt: charge.expiresAt,
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
      .returning();
    if (!order) throw new Error(`Order ${orderId} is no longer pending; its charge was not stored`);
    return order;
  }

  /**
   * pending → expired for the orders matching `which`. Each order's charge is
   * canceled first (`cancel`), holding no lock, so a slow provider never holds
   * an order row. Then one UPDATE expires the ones whose cancel went through,
   * only if they are still pending: a webhook that paid or failed the order in
   * between wins. `cancel` returns false when the charge had already
   * succeeded: that order stays pending for the caller to pay. A paid order is
   * never expired. Returns the expired order ids.
   */
  async function expireOrders(which: ReturnType<typeof and>, now: Date, cancel: CancelCharge) {
    const due = await db.select().from(orders).where(and(eq(orders.status, 'pending'), which));
    const canceled: string[] = [];
    for (const order of due) {
      if (await cancel(order)) canceled.push(order.id);
    }
    if (canceled.length === 0) return [];
    const expired = await db
      .update(orders)
      .set({ status: 'expired', expiredAt: now })
      .where(and(inArray(orders.id, canceled), eq(orders.status, 'pending')))
      .returning({ id: orders.id });
    return expired.map((order) => order.id);
  }

  /** Pending orders of this provider whose QR is past expires_at, optionally just one order. */
  function expireStale(now: Date, provider: string, cancel: CancelCharge, orderId?: string) {
    return expireOrders(
      and(
        eq(orders.provider, provider),
        isNotNull(orders.expiresAt),
        lte(orders.expiresAt, now),
        orderId ? eq(orders.id, orderId) : undefined,
      ),
      now,
      cancel,
    );
  }

  /** The user's pending orders for this ดวงคู่ row, replaced by a new checkout (a new QR). */
  function expireSuperseded(userId: string, unlockRef: string, now: Date, cancel: CancelCharge) {
    return expireOrders(and(eq(orders.userId, userId), eq(orders.unlockRef, unlockRef)), now, cancel);
  }

  /**
   * One page of the user's rows, newest first, keyset on (created_at, id).
   * `cursor` is the id of the last row of the previous page; the comparison
   * reads that row's created_at in SQL, so microsecond ties don't skip rows, and
   * another user's row id matches nothing. A ดวงคู่ spend or refund is named by
   * its partner, a purchase carries its order's price (one query, no per-row lookup).
   */
  async function history(userId: string, opts: { limit: number; cursor?: string; kind?: HistoryKind }) {
    const conditions = [eq(walletLedger.userId, userId)];
    if (opts.kind) conditions.push(inArray(walletLedger.kind, [...HISTORY_KINDS[opts.kind]]));
    if (opts.cursor) {
      conditions.push(
        sql`(${walletLedger.createdAt}, ${walletLedger.id}) < (select c.created_at, c.id from wallet_ledger c where c.id = ${opts.cursor} and c.user_id = ${userId})`,
      );
    }
    const rows = await db
      .select({ row: walletLedger, refName: compatibility.partnerName, amountSatang: orders.amountSatang })
      .from(walletLedger)
      .leftJoin(
        compatibility,
        and(eq(walletLedger.productId, 'compat_unlock'), sql`${compatibility.id}::text = ${walletLedger.refId}`),
      )
      .leftJoin(orders, and(eq(walletLedger.kind, 'purchase'), eq(orders.id, walletLedger.orderId)))
      .where(and(...conditions))
      .orderBy(desc(walletLedger.createdAt), desc(walletLedger.id))
      .limit(opts.limit + 1);
    const page = rows.slice(0, opts.limit);
    return {
      entries: page.map(({ row, refName, amountSatang }) => toEntry(row, refName, amountSatang)),
      nextCursor: rows.length > opts.limit ? page[page.length - 1].row.id : null,
    };
  }

  /** The newest rows first (the first page of `history`). */
  async function ledger(userId: string, limit: number): Promise<LedgerEntry[]> {
    return (await history(userId, { limit })).entries;
  }

  return {
    balance, ensureWelcome, canAfford, hasPaid, spendWithin, spend, refundSpend, createOrder, getOrder,
    markPaidWithin, markPaid, markFailedWithin, markNeedsReviewWithin, attachCharge, expireStale, expireSuperseded,
    creditOrder, adjust, history, ledger,
  };
}

export type Wallet = ReturnType<typeof createWallet>;

/** The wallet on the app database. */
export const wallet = createWallet(appDb);
