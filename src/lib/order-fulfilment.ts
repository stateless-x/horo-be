import { wallet as appWallet, type Wallet } from './wallet';
import { unlockForUser } from '../systems/compatibility/unlock';
import type { UnlockResult } from '../systems/compatibility/reading';

/**
 * What happens once the provider says an order is paid (docs/wallet.md). The
 * T5 webhook calls this after `markPaid`: credit the pack, then, for a
 * one-flow purchase ("ปลดล็อก ฿49" in the ดวงคู่ door), run the same atomic
 * unlock the route runs on the row stored in `unlock_ref`. Replays are safe:
 * the credit is idempotent per order and the unlock charges a row once.
 */
export async function fulfilPaidOrder(
  orderId: string,
  deps: {
    wallet: Pick<Wallet, 'creditOrder'>;
    unlock: (userId: string, rowId: string) => Promise<Pick<UnlockResult, 'status'>>;
  } = { wallet: appWallet, unlock: unlockForUser },
) {
  const credit = await deps.wallet.creditOrder(orderId);
  const unlock = credit.unlockRef ? await deps.unlock(credit.userId, credit.unlockRef) : null;
  return { credited: credit.credited, balance: credit.balance, unlockStatus: unlock?.status ?? null };
}
