import { z } from 'zod';

/**
 * ละอองดาว (stardust) wallet: the vocabulary and response shapes shared by the
 * API (src/routes/wallet.ts) and the frontend. The numbers (prices, pack sizes,
 * cap) live only in horo-be/src/lib/pricing.ts; the frontend reads them from
 * GET /api/wallet. Design: horo-be/docs/wallet.md.
 */

/** Everything ละอองดาว can buy. Only compat_unlock is spendable today. */
export const PRODUCT_IDS = ['compat_unlock', 'month_pass', 'year_reading', 'wallpaper'] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

/** Packs sold for baht. */
export const PACK_IDS = ['p49', 'p99', 'p199'] as const;
export type PackId = (typeof PACK_IDS)[number];

/** Why a ledger row exists. The ledger is append-only; a correction is a new row. */
export const LEDGER_KINDS = ['purchase', 'bonus', 'welcome', 'spend', 'refund', 'admin_adjust', 'expire'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const ORDER_STATUSES = ['pending', 'paid', 'failed', 'expired', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface WalletPack {
  id: PackId;
  /** What the buyer pays, VAT-inclusive, in whole baht. */
  priceBaht: number;
  /** ละอองดาว that never expire. */
  base: number;
  /** Extra ละอองดาว that expire 180 days after purchase. */
  bonus: number;
}

export interface LedgerEntry {
  id: string;
  delta: number;
  kind: LedgerKind;
  productId: ProductId | null;
  refId: string | null;
  note: string | null;
  /** ISO date; set on bonus rows only. */
  expiresAt: string | null;
  createdAt: string;
}

/** GET /api/wallet */
export interface WalletResponse {
  balance: number;
  cap: number;
  packs: WalletPack[];
  prices: Record<ProductId, number>;
  /** The newest 20 rows, newest first. */
  ledger: LedgerEntry[];
}

/** POST /api/wallet/checkout body. */
export const CheckoutRequestSchema = z.object({ packId: z.enum(PACK_IDS) });
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

/** POST /api/wallet/checkout. `payment` is 'unavailable' until the PromptPay provider is wired (monetization T5). */
export interface CheckoutResponse {
  orderId: string;
  status: 'pending';
  payment: 'unavailable';
  message: string;
}

/** GET /api/wallet/orders/:id */
export interface OrderStatusResponse {
  orderId: string;
  packId: PackId;
  status: OrderStatus;
  amountSatang: number;
  stardust: number;
  createdAt: string;
  paidAt: string | null;
}

/** HTTP 402 body when a spend needs more ละอองดาว than the balance holds. */
export interface InsufficientStardustBody {
  error: 'insufficient_stardust';
  balance: number;
  price: number;
}
