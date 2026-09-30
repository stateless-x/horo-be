import type { PackId, ProductId, WalletPack } from '../../lib/shared/types/wallet';

/**
 * The single source of truth for what Horo sells and for how much
 * (docs/wallet.md). Everything is in มู, a closed-loop unit
 * pegged 1 มู = ฿1 and always shown with the baht beside it. Integers
 * only, VAT-inclusive.
 *
 * Closed loop (owner decision 2026-09-27): never cashed out, never transferred
 * between users, never spent outside Horo.
 */

/** Price of each product in มู. */
export const PRODUCT_PRICES: Record<ProductId, number> = {
  compat_unlock: 49,
  month_pass: 29,
  year_reading: 99,
  wallpaper: 39,
};

/** Products that can be bought with มู today. The others have no unlock path yet. */
export type SpendableProductId = Extract<ProductId, 'compat_unlock'>;

/** Packs sold for baht: base units never expire, bonus units expire BONUS_TTL_DAYS after purchase. */
export const PACKS: Record<PackId, WalletPack> = {
  p49: { id: 'p49', priceBaht: 49, base: 49, bonus: 0 },
  p99: { id: 'p99', priceBaht: 99, base: 99, bonus: 10 },
  p199: { id: 'p199', priceBaht: 199, base: 199, bonus: 30 },
  p399: { id: 'p399', priceBaht: 399, base: 399, bonus: 80 },
};

/** The bonus as a whole percent of the base, rounded down: the chip on a pack (p99 → 10, p199 → 15, p399 → 20). */
export function bonusPercent(pack: WalletPack): number {
  return Math.floor((pack.bonus / pack.base) * 100);
}

/** Granted once per account, on the first wallet touch. Equals one ดวงคู่ unlock. */
export const WELCOME_GIFT = 49;

/** No credit may take a balance above this. */
export const BALANCE_CAP = 2_000;

/** Bonus units carry expires_at = purchase + this. Expiry is not enforced yet (docs/wallet.md). */
export const BONUS_TTL_DAYS = 180;

export const CURRENCY = 'THB';

/**
 * How long a checkout's PromptPay QR is offered. Horo's own timer: Stripe's
 * PromptPay QR has no expiry, so a scan after this still pays (docs/wallet.md, Payments).
 */
export const QR_TTL_MINUTES = 15;

/**
 * The QR TTL in effect. Outside production, env QR_TTL_MINUTES (a positive
 * number, e.g. 1 to watch the countdown reach 0) overrides the constant; a
 * value that isn't one stops startup. Production always uses QR_TTL_MINUTES.
 */
export function resolveQrTtlMinutes(env: { NODE_ENV?: string; QR_TTL_MINUTES?: string }): number {
  if (env.NODE_ENV === 'production' || !env.QR_TTL_MINUTES) return QR_TTL_MINUTES;
  const minutes = Number(env.QR_TTL_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(`QR_TTL_MINUTES must be a positive number of minutes, got "${env.QR_TTL_MINUTES}"`);
  return minutes;
}

export const qrTtlMinutes = resolveQrTtlMinutes(process.env);

/** A pack's price in satang, the unit orders store. */
export function packAmountSatang(pack: WalletPack): number {
  return pack.priceBaht * 100;
}

/** What an order buys, for the provider's payment description: "Horo เติม ฿99 (109 มู)". */
export function describeOrder(order: { amountSatang: number; unitsBase: number; unitsBonus: number }): string {
  return `Horo เติม ฿${order.amountSatang / 100} (${order.unitsBase + order.unitsBonus} มู)`;
}
