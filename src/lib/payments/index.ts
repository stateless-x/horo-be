import { createFakeGateway } from './fake';
import type { PaymentGateway } from './gateway';
import { createStripeGateway } from './stripe';

/**
 * The one place the payment adapter is chosen, from PAYMENT_PROVIDER:
 * 'fake' | 'stripe'. Outside production the default is 'fake'. In production
 * it must be 'stripe' (the default there), and 'fake' throws, so a
 * misconfigured deploy refuses to start instead of taking fake payments.
 */
export function selectGateway(env: { NODE_ENV?: string; PAYMENT_PROVIDER?: string }): PaymentGateway {
  const production = env.NODE_ENV === 'production';
  const provider = env.PAYMENT_PROVIDER || (production ? 'stripe' : 'fake');
  if (provider === 'stripe') return createStripeGateway();
  if (provider === 'fake') {
    if (production) throw new Error('PAYMENT_PROVIDER=fake is refused in production');
    return createFakeGateway();
  }
  throw new Error(`Unknown PAYMENT_PROVIDER: ${provider}`);
}

/** The app's gateway. src/index.ts imports this first, so a bad PAYMENT_PROVIDER stops startup. */
export const paymentGateway = selectGateway(process.env);
