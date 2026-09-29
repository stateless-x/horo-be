import type { PaymentGateway } from './gateway';

/** Stripe PromptPay. Not built yet: increment I3 replaces this stub with the adapter. */
export function createStripeGateway(): PaymentGateway {
  const notYet = async (): Promise<never> => {
    throw new Error('Stripe gateway not implemented (I3)');
  };
  return { provider: 'stripe', startCharge: notYet, lookupCharge: notYet, cancelCharge: notYet };
}
