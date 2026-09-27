import { config } from '../config';
import { INSUFFICIENT_BALANCE, type InsufficientBalanceBody } from '../../lib/shared/types/wallet';
import { PRODUCT_PRICES } from './pricing';
import { InsufficientBalance, wallet as appWallet, type Wallet, type WalletTx } from './wallet';

/**
 * Entitlements: what a user may open. For now only the ดวงคู่ unlock seam
 * (docs/monetization-tickets.md T8), paid in มู (docs/wallet.md).
 *
 * The unlock pays atomically with delivery:
 *   checkUnlock → generate the detail → one transaction { chargeUnlockWithin + patch the detail }.
 * A failed generation then costs nothing, and a failed patch rolls the charge back.
 */

/** Refused: the 402 body the unlock route sends as is. */
export type UnlockDecision = { ok: true } | { ok: false; body: InsufficientBalanceBody };

export type UnlockWallet = Pick<Wallet, 'ensureWelcome' | 'canAfford' | 'hasPaid' | 'spendWithin'>;

/** Nothing is sold while locked mode is off (a row locked earlier opens free), nor with COMPAT_UNLOCK_FREE (dev). */
const unlockIsFree = () => !config.compat.lockEnabled || config.compat.unlockFree;

const refused = (balance: number, price: number): UnlockDecision => ({
  ok: false,
  body: { error: INSUFFICIENT_BALANCE, balance, price },
});

/**
 * Before generating: may this user pay for an unlock of this row? A row
 * already paid for (devtools relocked it, or a patch failed after the charge)
 * skips the balance check: chargeUnlockWithin won't charge it again. Otherwise
 * grants the welcome gift first, so it lands at the first locked ดวงคู่ result.
 * Read-only apart from the gift.
 */
export async function checkUnlock(userId: string, compatibilityId: string, wallet: UnlockWallet = appWallet): Promise<UnlockDecision> {
  if (unlockIsFree()) return { ok: true };
  if (await wallet.hasPaid(userId, 'compat_unlock', compatibilityId)) return { ok: true };
  await wallet.ensureWelcome(userId);
  const check = await wallet.canAfford(userId, PRODUCT_PRICES.compat_unlock);
  return check.ok ? { ok: true } : refused(check.balance, check.price);
}

/**
 * Inside the transaction that patches the detail: charge the unlock for this
 * row, once. Refused if the balance dropped since checkUnlock; the caller then
 * rolls back instead of saving the detail. Any other error is thrown.
 */
export async function chargeUnlockWithin(
  tx: WalletTx,
  userId: string,
  compatibilityId: string,
  wallet: UnlockWallet = appWallet,
): Promise<UnlockDecision> {
  if (unlockIsFree()) return { ok: true };
  try {
    await wallet.spendWithin(tx, userId, 'compat_unlock', compatibilityId);
    return { ok: true };
  } catch (error) {
    if (error instanceof InsufficientBalance) return refused(error.balance, error.price);
    throw error;
  }
}
