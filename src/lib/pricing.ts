import type { PackId, ProductId, WalletPack } from '../../lib/shared/types/wallet';

/**
 * The single source of truth for what Horo sells and for how much
 * (docs/wallet.md). Everything is in ละอองดาว (stardust), a closed-loop unit
 * pegged 1 ละอองดาว = ฿1 and always shown with the baht beside it. Integers
 * only, VAT-inclusive.
 *
 * Closed loop (owner decision 2026-09-27): never cashed out, never transferred
 * between users, never spent outside Horo.
 */

/** Price of each product in ละอองดาว. */
export const PRODUCT_PRICES: Record<ProductId, number> = {
  compat_unlock: 49,
  month_pass: 29,
  year_reading: 99,
  wallpaper: 39,
};

/** Products that can be bought with ละอองดาว today. The others have no unlock path yet. */
export type SpendableProductId = Extract<ProductId, 'compat_unlock'>;

/** Packs sold for baht: base units never expire, bonus units expire BONUS_TTL_DAYS after purchase. */
export const PACKS: Record<PackId, WalletPack> = {
  p49: { id: 'p49', priceBaht: 49, base: 49, bonus: 0 },
  p99: { id: 'p99', priceBaht: 99, base: 99, bonus: 10 },
  p199: { id: 'p199', priceBaht: 199, base: 199, bonus: 30 },
};

/** Granted once per account, on the first wallet touch. Equals one ดวงคู่ unlock. */
export const WELCOME_GIFT = 49;

/** No credit may take a balance above this. */
export const BALANCE_CAP = 2_000;

/** Bonus units carry expires_at = purchase + this. Expiry is not enforced yet (docs/wallet.md). */
export const BONUS_TTL_DAYS = 180;

export const CURRENCY = 'THB';

/** A pack's price in satang, the unit orders store. */
export function packAmountSatang(pack: WalletPack): number {
  return pack.priceBaht * 100;
}
