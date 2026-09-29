import { z } from 'zod';

/**
 * มู wallet (1 มู = ฿1): the vocabulary and response shapes shared by the
 * API (src/routes/wallet.ts) and the frontend. The numbers (prices, pack sizes,
 * cap) live only in horo-be/src/lib/pricing.ts; the frontend reads them from
 * GET /api/wallet. Design: horo-be/docs/wallet.md.
 */

/** Everything มู can buy. Only compat_unlock is spendable today. */
export const PRODUCT_IDS = ['compat_unlock', 'month_pass', 'year_reading', 'wallpaper'] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

/** Packs sold for baht. */
export const PACK_IDS = ['p49', 'p99', 'p199', 'p399'] as const;
export type PackId = (typeof PACK_IDS)[number];

/** Why a ledger row exists. The ledger is append-only; a correction is a new row. */
export const LEDGER_KINDS = ['purchase', 'bonus', 'welcome', 'spend', 'refund', 'admin_adjust', 'expire'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/**
 * Who caused a ledger row. 'admin' rows also store the admin's id and email,
 * which never leave the backend; users see only `LedgerBy`.
 */
export const ACTOR_TYPES = ['user', 'system', 'admin', 'dev'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Who a user is shown as the cause of a row: themselves, Horo (system and dev), or the team (an admin). */
export type LedgerBy = 'you' | 'horo' | 'team';

/** GET /api/wallet/history `kind` filter groups. */
export const HISTORY_KINDS = {
  topup: ['purchase', 'bonus'],
  spend: ['spend'],
  refund: ['refund'],
  adjust: ['admin_adjust'],
  welcome: ['welcome'],
} as const satisfies Record<string, readonly LedgerKind[]>;
export type HistoryKind = keyof typeof HISTORY_KINDS;

export const ORDER_STATUSES = ['pending', 'paid', 'failed', 'expired', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface WalletPack {
  id: PackId;
  /** What the buyer pays, VAT-inclusive, in whole baht. */
  priceBaht: number;
  /** มู that never expire. */
  base: number;
  /** Extra มู that expire 180 days after purchase. */
  bonus: number;
}

/** A pack as GET /api/wallet offers it: with the bonus as a whole percent of the base, rounded down (the chip). */
export interface WalletPackOffer extends WalletPack {
  bonusPercent: number;
}

export interface LedgerEntry {
  id: string;
  delta: number;
  kind: LedgerKind;
  productId: ProductId | null;
  refId: string | null;
  /** What refId points at, for a ดวงคู่ unlock the partner's name; null once that row is gone. */
  refName: string | null;
  note: string | null;
  /** ISO date; set on bonus rows only. */
  expiresAt: string | null;
  createdAt: string;
  /** Who caused the row, as the user sees it. Never the admin's identity. */
  by: LedgerBy;
  /** Purchase rows: the baht paid for the order, for "฿99 → +99 มู". Null on every other kind. */
  amountBaht: number | null;
}

/**
 * GET /api/wallet. `enabled: false` while nothing is sellable (ดวงคู่ locked
 * mode off): no balance, no welcome gift, and the frontend shows no wallet.
 */
export type WalletResponse = { enabled: false } | WalletState;

export interface WalletState {
  enabled: true;
  balance: number;
  cap: number;
  packs: WalletPackOffer[];
  prices: Record<ProductId, number>;
  /** The newest 20 rows, newest first. */
  ledger: LedgerEntry[];
}

/** GET /api/wallet/history. Newest first; pass `nextCursor` back as `cursor` for the next page. */
export interface WalletHistoryResponse {
  entries: LedgerEntry[];
  nextCursor: string | null;
}

/** POST /api/wallet/checkout body. */
export const CheckoutRequestSchema = z.object({
  packId: z.enum(PACK_IDS),
  /** One-flow purchase: the ดวงคู่ row to unlock as soon as this order is paid. */
  unlockRef: z.string().uuid().optional(),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

/**
 * POST /api/wallet/checkout. `qr`: a PromptPay QR to show until `expiresAt`;
 * poll GET /api/wallet/orders/:id for the result. `unavailable`: no payment
 * provider can take the order.
 */
export type CheckoutResponse =
  | {
      orderId: string;
      status: 'pending';
      payment: 'qr';
      /** `data` is the PromptPay payload to render; `pngUrl` and `svgUrl` ready images, when the provider gives them. */
      qr: { data: string; pngUrl: string | null; svgUrl: string | null };
      /** ISO date. Horo expires the order after this; a late scan still credits. */
      expiresAt: string;
      amountBaht: number;
    }
  | {
      orderId: string;
      status: 'pending';
      payment: 'unavailable';
      message: string;
    };

/** GET /api/wallet/orders/:id */
export interface OrderStatusResponse {
  orderId: string;
  packId: PackId;
  status: OrderStatus;
  amountSatang: number;
  /** Base + bonus มู the order credits once paid. */
  units: number;
  createdAt: string;
  paidAt: string | null;
  /** ISO date the QR stops being offered; null before a charge exists. */
  expiresAt: string | null;
  /** The owner's มู balance now, so a paid order can show the new total. */
  balance: number;
}

/**
 * The error code of an HTTP 402 when a spend needs more มู than the balance
 * holds. One name for the entitlement seam, the unlock route and the frontend.
 */
export const INSUFFICIENT_BALANCE = 'insufficient_balance';

/** HTTP 402 body when a spend needs more มู than the balance holds. */
export interface InsufficientBalanceBody {
  error: typeof INSUFFICIENT_BALANCE;
  balance: number;
  price: number;
}
