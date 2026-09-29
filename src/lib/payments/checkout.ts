import type { PackId } from '../../../lib/shared/types/wallet';
import { wallet as appWallet, type CancelCharge, type Wallet } from '../wallet';
import { handleProviderEvent } from './events';
import type { PaymentGateway } from './gateway';
import { paymentGateway } from './index';

/**
 * The customer's side of an order (docs/wallet.md, Payments): start a charge,
 * and read the order back, recovering a missed webhook on the way.
 */

export type CheckoutDeps = {
  wallet: Wallet;
  gateway: PaymentGateway;
  handle: typeof handleProviderEvent;
};

const appDeps: CheckoutDeps = { wallet: appWallet, gateway: paymentGateway, handle: handleProviderEvent };

/**
 * pending → expired for orders past expires_at, each charge canceled first.
 * `orderId` limits it to one order (the lazy expiry on GET /orders/:id);
 * without it, every stale order of this provider (for a future sweep).
 */
export function expireStaleOrders(now: Date, deps: CheckoutDeps = appDeps, orderId?: string) {
  return expireCanceling(deps, (cancel) => deps.wallet.expireStale(now, deps.gateway.provider, cancel, orderId));
}

/**
 * Runs an expiry with the gateway's cancel. A charge that had already
 * succeeded can't be canceled, so its order is not expired; once the expiry
 * has committed (it holds the order row locked), that order is paid from the
 * provider's answer like any lookup. Returns the expired order ids.
 */
async function expireCanceling(deps: CheckoutDeps, expire: (cancel: CancelCharge) => Promise<string[]>) {
  const succeeded: string[] = [];
  const expired = await expire(async (order) => {
    if (!order.providerRef) return true;
    const { status } = await deps.gateway.cancelCharge(order.providerRef);
    if (status === 'succeeded') succeeded.push(order.providerRef);
    return status === 'canceled';
  });
  for (const providerRef of succeeded) await applyLookup(deps, providerRef);
  return expired;
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
 * order expired first (a late payment on it still credits).
 */
export async function startCheckout(
  input: { userId: string; email: string | null; packId: PackId; unlockRef?: string },
  deps: CheckoutDeps = appDeps,
  now = new Date(),
) {
  if (input.unlockRef) {
    const { userId, unlockRef } = input;
    await expireCanceling(deps, (cancel) => deps.wallet.expireSuperseded(userId, unlockRef, now, cancel));
  }
  const created = await deps.wallet.createOrder(input.userId, input.packId, input.unlockRef);
  const charge = await deps.gateway.startCharge(created, { email: input.email });
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
  deps: CheckoutDeps = appDeps,
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
