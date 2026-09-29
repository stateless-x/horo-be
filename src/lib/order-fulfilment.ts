import { wallet as appWallet, type LedgerActor, type Wallet } from './wallet';
import { unlockForUser } from '../systems/compatibility/unlock';
import type { UnlockResult } from '../systems/compatibility/reading';

/**
 * What happens once the provider says an order is paid (docs/wallet.md). The
 * T5 webhook calls this after `markPaid`: credit the pack, then, for a
 * one-flow purchase ("ปลดล็อก ฿49" in the ดวงคู่ door), run the same atomic
 * unlock the route runs on the row stored in `unlock_ref`. Replays are safe:
 * the credit is idempotent per order and the unlock charges a row once.
 * `actor` confirmed the payment and is recorded on the credit rows.
 */
type FulfilDeps = {
  wallet: Pick<Wallet, 'creditOrder'>;
  unlock: (userId: string, rowId: string) => Promise<Pick<UnlockResult, 'status'>>;
};

const appDeps: FulfilDeps = { wallet: appWallet, unlock: unlockForUser };

export async function fulfilPaidOrder(orderId: string, actor: LedgerActor, deps: FulfilDeps = appDeps) {
  const credit = await deps.wallet.creditOrder(orderId, actor);
  const unlock = credit.unlockRef ? await deps.unlock(credit.userId, credit.unlockRef) : null;
  return { credited: credit.credited, balance: credit.balance, unlockStatus: unlock?.status ?? null };
}

/**
 * fulfilPaidOrder for the Stripe webhook, which must answer within seconds:
 * the credit is awaited, the unlock (up to ~20 s of generation) is not. A
 * failed unlock is logged; the credit stays, and the door's own unlock
 * (balance now ≥ price) finishes it. Both steps stay idempotent, so a replay
 * still credits once and charges the row once.
 */
export async function fulfilPaidOrderUnlockLater(orderId: string, actor: LedgerActor, deps: FulfilDeps = appDeps) {
  const credit = await deps.wallet.creditOrder(orderId, actor);
  const { userId, unlockRef } = credit;
  if (unlockRef) {
    deps.unlock(userId, unlockRef).then(
      (result) => {
        if (result.status !== 200) console.warn('[fulfil] background unlock not done', { orderId, unlockRef, status: result.status });
      },
      (error) => console.error('[fulfil] background unlock failed', { orderId, unlockRef }, error),
    );
  }
  return { credited: credit.credited, balance: credit.balance, unlockStatus: null };
}
