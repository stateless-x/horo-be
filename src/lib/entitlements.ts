import { config } from '../config';

/**
 * Entitlements: what a user may open. For now only the ดวงคู่ unlock seam
 * (docs/monetization-tickets.md T8); the credit ledger (T4) replaces the body
 * of assertCanUnlock, and its spend must commit with the detail patch, never
 * before it.
 */

export type UnlockDecision = { ok: true } | { ok: false; code: 'NO_CREDIT' };

/**
 * May this user unlock this compatibility report? Free while locked mode is
 * off (nothing is sold) or COMPAT_UNLOCK_FREE is set (dev). Otherwise no:
 * there is no credit ledger yet, so locked mode is not shippable without it.
 */
export async function assertCanUnlock(_userId: string, _compatibilityId: string): Promise<UnlockDecision> {
  if (!config.compat.lockEnabled || config.compat.unlockFree) return { ok: true };
  return { ok: false, code: 'NO_CREDIT' };
}
