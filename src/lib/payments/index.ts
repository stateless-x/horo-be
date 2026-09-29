import { createFakeGateway } from './fake';
import type { PaymentGateway } from './gateway';
import { createStripeClient, createStripeGateway } from './stripe';
import { config } from '../../config';

/**
 * The one place the payment adapter is chosen, from PAYMENT_PROVIDER:
 * 'fake' | 'stripe'. Outside production the default is 'fake'. In production
 * it must be 'stripe' (the default there), and 'fake' throws, so a
 * misconfigured deploy refuses to start instead of taking fake payments.
 * Stripe also needs its secret key of the right mode (createStripeClient) and,
 * in production, the webhook secret: without it no payment would ever be
 * confirmed, so startup fails.
 */
export function selectGateway(
  env: { NODE_ENV?: string; PAYMENT_PROVIDER?: string },
  stripe: { secretKey: string; webhookSecret: string } = config.stripe,
): PaymentGateway {
  const production = env.NODE_ENV === 'production';
  const provider = env.PAYMENT_PROVIDER || (production ? 'stripe' : 'fake');
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

/** The app's gateway. src/index.ts imports this first, so a bad PAYMENT_PROVIDER or Stripe key stops startup. */
export const paymentGateway = selectGateway(process.env);
