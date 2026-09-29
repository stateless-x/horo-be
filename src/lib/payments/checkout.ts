import type { PackId } from '../../../lib/shared/types/wallet';
import { wallet as appWallet, type Order, type Wallet } from '../wallet';
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
export function expireStaleOrders(now: Date, deps: Pick<CheckoutDeps, 'wallet' | 'gateway'> = appDeps, orderId?: string) {
  return deps.wallet.expireStale(now, deps.gateway.provider, (order) => cancel(deps.gateway, order), orderId);
}

async function cancel(gateway: PaymentGateway, order: Order) {
  if (order.providerRef) await gateway.cancelCharge(order.providerRef);
}

/**
 * Creates the order and its charge. A new checkout for the same ดวงคู่ row
 * replaces the user's pending order for it: that charge is canceled and the
 * order expired first (a late payment on it still credits).
 */
export async function startCheckout(
  input: { userId: string; email: string | null; packId: PackId; unlockRef?: string },
  deps: Pick<CheckoutDeps, 'wallet' | 'gateway'> = appDeps,
  now = new Date(),
) {
  if (input.unlockRef) {
    await deps.wallet.expireSuperseded(input.userId, input.unlockRef, now, (order) => cancel(deps.gateway, order));
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
    const state = await deps.gateway.lookupCharge(order.providerRef);
    if (state.status !== 'pending') {
      await deps.handle({
        provider: deps.gateway.provider,
        eventRef: `lookup:${order.providerRef}:${state.status}`,
        providerRef: order.providerRef,
        state,
        source: 'lookup',
      });
    }
  }
  await expireStaleOrders(now, deps, order.id);
  return deps.wallet.getOrder(userId, orderId);
}
