import type { PackId } from '../../../lib/shared/types/wallet';
import { wallet as appWallet, type CancelCharge, type Wallet } from '../wallet';
import { handleProviderEvent, recordChargeFailed } from './events';
import type { PaymentGateway, PaymentProvider } from './gateway';
import { paymentGateway } from './index';

/**
 * The customer's side of an order (docs/wallet.md, Payments): start a charge,
 * and read the order back, recovering a missed webhook on the way.
 */

export type CheckoutDeps = {
  wallet: Wallet;
  gateway: PaymentGateway;
  handle: typeof handleProviderEvent;
  /** Marks an order whose charge could not start as failed, with the reason (recordChargeFailed). */
  chargeFailed: (orderId: string, provider: PaymentProvider, error: unknown) => Promise<void>;
};

/** A new checkout for a ดวงคู่ row whose previous order turned out paid: that order was fulfilled, no new charge. */
export class AlreadyPaid extends Error {
  constructor(readonly orderId: string) {
    super(`Order ${orderId} for this row is already paid`);
  }
}

/** The app's deps, or null when no payment provider is configured. */
export function appCheckoutDeps(gateway: PaymentGateway | null = paymentGateway): CheckoutDeps | null {
  if (!gateway) return null;
  return { wallet: appWallet, gateway, handle: handleProviderEvent, chargeFailed: recordChargeFailed };
}

/**
 * pending → expired for orders past expires_at, each charge canceled first.
 * `orderId` limits it to one order (the lazy expiry on GET /orders/:id);
 * without it, every stale order of this provider (for a future sweep).
 */
export async function expireStaleOrders(now: Date, deps: CheckoutDeps, orderId?: string) {
  const { expired } = await expireCanceling(deps, (cancel) => deps.wallet.expireStale(now, deps.gateway.provider, cancel, orderId));
  return expired;
}

/**
 * Runs an expiry with the gateway's cancel. A charge that had already
 * succeeded can't be canceled, so its order is not expired; after the expiry,
 * that order is paid and fulfilled from the provider's answer like any lookup.
 * Returns the expired order ids and the ids of the orders found paid.
 */
async function expireCanceling(deps: CheckoutDeps, expire: (cancel: CancelCharge) => Promise<string[]>) {
  const succeeded: { orderId: string; providerRef: string }[] = [];
  const expired = await expire(async (order) => {
    if (!order.providerRef) return true;
    const { status } = await deps.gateway.cancelCharge(order.providerRef);
    if (status === 'succeeded') succeeded.push({ orderId: order.id, providerRef: order.providerRef });
    return status === 'canceled';
  });
  for (const { providerRef } of succeeded) await applyLookup(deps, providerRef);
  return { expired, paid: succeeded.map((charge) => charge.orderId) };
}

/** Asks the provider about a charge and applies a settled answer through handleProviderEvent. */
async function applyLookup(deps: CheckoutDeps, providerRef: string) {
  const state = await deps.gateway.lookupCharge(providerRef);
  if (state.status === 'pending') return;
  await deps.handle({
    provider: deps.gateway.provider,
    eventRef: `lookup:${providerRef}:${state.status}`,
    providerRef,
    state,
    source: 'lookup',
  });
}

/**
 * Creates the order and its charge. A new checkout for the same ดวงคู่ row
 * replaces the user's pending order for it: that charge is canceled and the
 * order expired first (a late payment on it still credits). If that charge
 * had already succeeded, the old order is paid and fulfilled instead, and the
 * checkout throws AlreadyPaid rather than charge twice for one row.
 *
 * A charge that fails to start (EmailRequired, a provider error) leaves no
 * pending order behind: the order is marked failed with the reason recorded,
 * then the error is rethrown.
 */
export async function startCheckout(
  input: { userId: string; email: string | null; packId: PackId; unlockRef?: string },
  deps: CheckoutDeps,
  now = new Date(),
) {
  if (input.unlockRef) {
    const { userId, unlockRef } = input;
    const { paid } = await expireCanceling(deps, (cancel) => deps.wallet.expireSuperseded(userId, unlockRef, now, cancel));
    if (paid.length > 0) throw new AlreadyPaid(paid[0]);
  }
  const created = await deps.wallet.createOrder(input.userId, input.packId, input.unlockRef);
  let charge;
  try {
    charge = await deps.gateway.startCharge(created, { email: input.email });
  } catch (error) {
    await deps.chargeFailed(created.id, deps.gateway.provider, error);
    throw error;
  }
  return deps.wallet.attachCharge(created.id, deps.gateway.provider, charge);
}

/**
 * The owner's order, brought up to date. Asks the provider (lookupCharge)
 * when the client passes `verify`, or when a pending order's QR has run out
 * (before expiring it), and applies what it says through handleProviderEvent,
 * so a missed webhook still pays. Then expires the order if it is still
 * pending past expires_at. Null when the order isn't this user's.
 */
export async function refreshOrder(
  userId: string,
  orderId: string,
  opts: { verify: boolean; now?: Date },
  deps: CheckoutDeps,
) {
  const now = opts.now ?? new Date();
  const order = await deps.wallet.getOrder(userId, orderId);
  if (!order) return null;

  const due = order.status === 'pending' && order.expiresAt !== null && order.expiresAt <= now;
  const payable = order.status === 'pending' || order.status === 'expired' || order.status === 'failed';
  if (order.providerRef && order.provider === deps.gateway.provider && payable && (opts.verify || due)) {
    await applyLookup(deps, order.providerRef);
  }
  await expireStaleOrders(now, deps, order.id);
  return deps.wallet.getOrder(userId, orderId);
}
