import Stripe from 'stripe';
import { QR_TTL_MINUTES, describeOrder } from '../pricing';
import { EmailRequired, type ChargeState, type PaymentGateway } from './gateway';

/**
 * Stripe PromptPay (docs/wallet.md, Payments). One PaymentIntent per order,
 * confirmed at creation so it carries the QR. PaymentIntents carry the
 * customer's email: log ids and statuses only, never the object, and never a
 * Stripe error as is (it can hold the PaymentIntent too); see StripeCallFailed.
 */

/** The part of the Stripe client the adapter uses; tests pass a fake. */
export type StripeClient = { paymentIntents: Pick<Stripe['paymentIntents'], 'create' | 'retrieve' | 'cancel'> };

/**
 * The Stripe client for this environment. Refuses a missing key, a live key
 * outside production, and anything but a live key in production, so a
 * misconfigured deploy fails at startup instead of charging the wrong account.
 */
export function createStripeClient(secretKey: string, production: boolean): Stripe {
  if (!secretKey) throw new Error('PAYMENT_PROVIDER=stripe needs STRIPE_SECRET_KEY');
  const live = /^(sk|rk)_live_/.test(secretKey);
  const test = /^(sk|rk)_test_/.test(secretKey);
  if (production && !live) throw new Error('STRIPE_SECRET_KEY refused: production needs a live key (sk_live_…)');
  if (!production && !test) throw new Error('STRIPE_SECRET_KEY refused: outside production only a test key (sk_test_…) is allowed');
  // The API version the SDK ships with (stripe 18.5.0). Retries are safe: every create carries an idempotency key.
  return new Stripe(secretKey, { apiVersion: '2025-08-27.basil', timeout: 8000, maxNetworkRetries: 2 });
}

/** A Stripe call failed. Carries Stripe's error type, code and request id, never its message or payload. */
export class StripeCallFailed extends Error {
  constructor(
    readonly operation: string,
    readonly ref: string,
    readonly stripe: { type?: string; code?: string; requestId?: string; statusCode?: number; status?: string },
  ) {
    super(`Stripe ${operation} ${ref} failed: ${JSON.stringify(stripe)}`);
  }
}

/** A PaymentIntent that should show a PromptPay QR came back without one. Nothing is stored on the order. */
export class StripeNoQr extends Error {
  constructor(readonly orderId: string, readonly paymentIntentId: string, readonly status: string) {
    super(`Order ${orderId}: PaymentIntent ${paymentIntentId} (${status}) has no PromptPay QR`);
  }
}

function failed(operation: string, ref: string, error: unknown): Error {
  if (!(error instanceof Stripe.errors.StripeError)) return error instanceof Error ? error : new Error(String(error));
  return new StripeCallFailed(operation, ref, {
    type: error.type,
    code: error.code,
    requestId: error.requestId,
    statusCode: error.statusCode,
  });
}

async function call<T>(operation: string, ref: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw failed(operation, ref, error);
  }
}

/** Horo's view of a PaymentIntent: the paid amount once it succeeded, else the asked amount; currency upper case. */
export function chargeState(pi: Pick<Stripe.PaymentIntent, 'amount' | 'amount_received' | 'currency'>, status: ChargeState['status']): ChargeState {
  return {
    status,
    amountSatang: status === 'succeeded' ? pi.amount_received : pi.amount,
    currency: pi.currency.toUpperCase(),
  };
}

function statusOf(pi: Pick<Stripe.PaymentIntent, 'id' | 'status'>): ChargeState['status'] {
  switch (pi.status) {
    case 'succeeded':
      return 'succeeded';
    case 'requires_payment_method':
    case 'requires_action':
    case 'processing':
      return 'pending';
    case 'canceled':
      return 'canceled';
    default:
      // requires_confirmation, requires_capture: Horo never creates these.
      throw new Error(`PaymentIntent ${pi.id} is ${pi.status}, a state Horo never creates`);
  }
}

export function createStripeGateway(client: StripeClient, now: () => Date = () => new Date()): PaymentGateway {
  return {
    provider: 'stripe',

    async startCharge(order, { email }) {
      // Stripe requires the billing email for PromptPay.
      if (!email) throw new EmailRequired(order.id);
      const pi = await call('create', order.id, () =>
        client.paymentIntents.create(
          {
            amount: order.amountSatang,
            currency: 'thb',
            payment_method_types: ['promptpay'],
            payment_method_data: { type: 'promptpay', billing_details: { email } },
            confirm: true,
            description: describeOrder(order),
            metadata: { orderId: order.id, packId: order.packId, userId: order.userId },
          },
          { idempotencyKey: `order:${order.id}` },
        ),
      );
      const qr = pi.next_action?.promptpay_display_qr_code;
      if (!qr) throw new StripeNoQr(order.id, pi.id, pi.status);
      return {
        providerRef: pi.id,
        qr: { data: qr.data, imagePngUrl: qr.image_url_png, imageSvgUrl: qr.image_url_svg },
        // Stripe's PromptPay QR has no expiry; this is Horo's own timer.
        expiresAt: new Date(now().getTime() + QR_TTL_MINUTES * 60_000),
      };
    },

    async lookupCharge(providerRef) {
      const pi = await call('retrieve', providerRef, () => client.paymentIntents.retrieve(providerRef));
      return chargeState(pi, statusOf(pi));
    },

    async cancelCharge(providerRef) {
      try {
        await client.paymentIntents.cancel(providerRef, { cancellation_reason: 'abandoned' });
        return { status: 'canceled' };
      } catch (error) {
        if (!(error instanceof Stripe.errors.StripeError) || error.code !== 'payment_intent_unexpected_state') {
          throw failed('cancel', providerRef, error);
        }
      }
      // Not cancelable in its current state. Ask Stripe which state, rather than trusting the error body.
      const pi = await call('retrieve', providerRef, () => client.paymentIntents.retrieve(providerRef));
      if (pi.status === 'canceled') return { status: 'canceled' };
      if (pi.status === 'succeeded') {
        console.warn('[stripe] cancel refused, the charge already succeeded; paying the order instead', { providerRef });
        return { status: 'succeeded' };
      }
      throw new StripeCallFailed('cancel', providerRef, { code: 'payment_intent_unexpected_state', status: pi.status });
    },
  };
}
