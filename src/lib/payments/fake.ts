import { QR_TTL_MINUTES } from '../pricing';
import type { ChargeState, PaymentGateway } from './gateway';

/**
 * The fake provider for dev and tests: charges live in memory, and `simulate`
 * stands in for the customer paying (or the bank refusing) plus the webhook
 * that reports it. Never selectable in production (index.ts).
 */
export type FakeGateway = PaymentGateway & {
  readonly provider: 'fake';
  /** Settle a charge as the provider would, and return the webhook event that reports it. */
  simulate(providerRef: string, outcome: 'succeeded' | 'failed'): { eventRef: string; state: ChargeState };
};

export function createFakeGateway(now: () => Date = () => new Date()): FakeGateway {
  const charges = new Map<string, ChargeState & { expiresAt: Date }>();

  function known(providerRef: string) {
    const charge = charges.get(providerRef);
    if (!charge) throw new Error(`Fake charge ${providerRef} not found (charges live in memory; restarted?)`);
    return charge;
  }

  return {
    provider: 'fake',
    async startCharge(order) {
      const providerRef = `fake_${order.id}`;
      const charge = charges.get(providerRef) ?? {
        status: 'pending' as const,
        amountSatang: order.amountSatang,
        currency: order.currency,
        expiresAt: new Date(now().getTime() + QR_TTL_MINUTES * 60_000),
      };
      charges.set(providerRef, charge);
      return { providerRef, qr: { data: `fake:${order.id}`, imagePngUrl: null, imageSvgUrl: null }, expiresAt: charge.expiresAt };
    },
    async lookupCharge(providerRef) {
      const { status, amountSatang, currency } = known(providerRef);
      return { status, amountSatang, currency };
    },
    // Unknown refs (memory wiped by a restart) are a no-op, like canceling a canceled charge.
    async cancelCharge(providerRef) {
      const charge = charges.get(providerRef);
      if (!charge) return;
      if (charge.status === 'succeeded') throw new Error(`Fake charge ${providerRef} already succeeded; it can't be canceled`);
      charge.status = 'canceled';
    },
    // Accepts a canceled charge too: that models a payment that landed just before the cancel.
    simulate(providerRef, outcome) {
      const charge = known(providerRef);
      charge.status = outcome;
      const { status, amountSatang, currency } = charge;
      return { eventRef: `fake_evt_${providerRef}_${outcome}`, state: { status, amountSatang, currency } };
    },
  };
}
