import type { Order } from '../wallet';

/**
 * The payment provider seam (docs/wallet.md, Payments). Horo talks to a
 * provider only through this interface; src/lib/payments/index.ts picks the
 * adapter. Stripe is one adapter file (stripe.ts) plus its webhook route
 * (src/routes/stripe-webhook.ts), which calls handleProviderEvent (events.ts).
 */

export type PaymentProvider = 'stripe' | 'fake';

export type ChargeStarted = {
  /** The provider's id for this charge (Stripe: the PaymentIntent id). Stored as orders.provider_ref. */
  providerRef: string;
  qr: { data: string; imagePngUrl: string | null; imageSvgUrl: string | null };
  /** When Horo stops offering the QR (now + qrTtlMinutes, src/lib/pricing.ts). */
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
   * Idempotent: canceling a canceled charge is a no-op and returns 'canceled'.
   * A charge that already succeeded can't be canceled: it returns 'succeeded',
   * and the caller pays the order instead of expiring it (checkout.ts).
   */
  cancelCharge(providerRef: string): Promise<{ status: 'canceled' | 'succeeded' }>;
}

/** The provider needs the customer's email for this charge (Stripe PromptPay) and the account has none. */
export class EmailRequired extends Error {
  constructor(readonly orderId: string) {
    super(`Order ${orderId}: the payment provider needs the customer's email, and the account has none`);
  }
}
