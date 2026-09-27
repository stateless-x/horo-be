import { config } from '../config';
import { INSUFFICIENT_BALANCE, type InsufficientBalanceBody } from '../../lib/shared/types/wallet';
import { InsufficientBalance, wallet as appWallet, type Wallet } from './wallet';

/**
 * Entitlements: what a user may open. For now only the ดวงคู่ unlock seam
 * (docs/monetization-tickets.md T8), paid in มู (docs/wallet.md).
 */

/** Refused: the 402 body the unlock route sends as is. */
export type UnlockDecision = { ok: true } | { ok: false; body: InsufficientBalanceBody };

/**
 * May this user unlock this compatibility report? Free while locked mode is
 * off (nothing is sold; a row locked earlier opens free) or with
 * COMPAT_UNLOCK_FREE (dev). Otherwise the first wallet touch grants the welcome
 * gift, then one compat_unlock is spent for this row. The spend is keyed to the
 * row, so a retry after a failed generation is never charged a second time.
 */
export async function assertCanUnlock(
  userId: string,
  compatibilityId: string,
  wallet: Pick<Wallet, 'ensureWelcome' | 'spend'> = appWallet,
): Promise<UnlockDecision> {
  if (!config.compat.lockEnabled || config.compat.unlockFree) return { ok: true };
  await wallet.ensureWelcome(userId);
  try {
    await wallet.spend(userId, 'compat_unlock', compatibilityId);
    return { ok: true };
  } catch (error) {
    if (error instanceof InsufficientBalance) {
      return { ok: false, body: { error: INSUFFICIENT_BALANCE, balance: error.balance, price: error.price } };
    }
    throw error;
  }
}
