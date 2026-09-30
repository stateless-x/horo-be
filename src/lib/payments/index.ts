import { createFakeGateway } from './fake';
import type { PaymentGateway } from './gateway';
import { createStripeClient, createStripeGateway } from './stripe';
import { config } from '../../config';

/**
 * The one place the payment adapter is chosen, from PAYMENT_PROVIDER:
 * unset or 'none' | 'stripe' | 'fake'.
 * - none (the default everywhere): no gateway. Checkout answers
 *   `payment: 'unavailable'`, /webhooks/stripe is not mounted, everything else
 *   runs. Payments not being configured never stops the API.
 * - stripe: needs its secret key of the right mode (createStripeClient) and, in
 *   production, the webhook secret, or startup fails: a deploy that asked for
 *   Stripe must not run half-configured.
 * - fake: dev and tests only; refused in production.
 */
export function selectGateway(
  env: { NODE_ENV?: string; PAYMENT_PROVIDER?: string },
  stripe: { secretKey: string; webhookSecret: string } = config.stripe,
): PaymentGateway | null {
  const production = env.NODE_ENV === 'production';
  const provider = env.PAYMENT_PROVIDER || 'none';
  if (provider === 'none') return null;
  if (provider === 'stripe') {
    if (production && !stripe.webhookSecret) {
      throw new Error('PAYMENT_PROVIDER=stripe in production needs STRIPE_WEBHOOK_SECRET: without the webhook no payment is confirmed');
    }
    return createStripeGateway(createStripeClient(stripe.secretKey, production));
  }
  if (provider === 'fake') {
    if (production) throw new Error('PAYMENT_PROVIDER=fake is refused in production');
    return createFakeGateway();
  }
  throw new Error(`Unknown PAYMENT_PROVIDER: ${provider}`);
}

/** The app's gateway, null when payments are off. src/index.ts imports this first, so a bad PAYMENT_PROVIDER or Stripe key stops startup. */
export const paymentGateway = selectGateway(process.env);
