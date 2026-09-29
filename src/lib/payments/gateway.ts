import type { Order } from '../wallet';

/**
 * The payment provider seam (docs/wallet.md, Payments). Horo talks to a
 * provider only through this interface; src/lib/payments/index.ts picks the
 * adapter. Adding Stripe (I3) is one adapter file plus its webhook route,
 * which calls handleProviderEvent (events.ts) and nothing else.
 */

export type PaymentProvider = 'stripe' | 'fake';

export type ChargeStarted = {
  /** The provider's id for this charge (Stripe: the PaymentIntent id). Stored as orders.provider_ref. */
  providerRef: string;
  qr: { data: string; imagePngUrl: string | null; imageSvgUrl: string | null };
  /** When Horo stops offering the QR (now + QR_TTL_MINUTES). */
  expiresAt: Date;
};

/** The provider's truth about a charge. `currency` is ISO 4217 upper case ('THB'); the adapter normalizes it. */
export type ChargeState = {
  status: 'pending' | 'succeeded' | 'failed' | 'canceled';
  amountSatang: number;
  currency: string;
};

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  /**
   * Create the charge for a pending order. Returns the QR and expiry.
   * Idempotent per order: calling twice returns the same charge (the order id
   * is the provider idempotency key).
   */
  startCharge(order: Order, customer: { email: string | null }): Promise<ChargeStarted>;
  /** Fetch the provider's truth for an order's charge; used to recover a missed webhook. */
  lookupCharge(providerRef: string): Promise<ChargeState>;
  /**
   * Stop the charge from being paid, when Horo expires or replaces its order.
   * Idempotent: canceling a canceled charge is a no-op. A charge that already
   * succeeded can't be canceled; the adapter throws, and the webhook pays it.
   */
  cancelCharge(providerRef: string): Promise<void>;
}
