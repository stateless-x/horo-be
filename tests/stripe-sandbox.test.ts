import { describe, expect, test } from 'bun:test';
import { createStripeClient, createStripeGateway } from '../src/lib/payments/stripe';
import type { Order } from '../src/lib/wallet';

/**
 * Real calls to the Stripe sandbox. Skipped unless STRIPE_SECRET_KEY is a test
 * key (`bun test` loads no env file, and a live key never runs this). Run once
 * by hand, passing only the key, never the rest of .env.local (it holds the
 * production DATABASE_URL):
 *
 *   STRIPE_SECRET_KEY="$(grep '^STRIPE_SECRET_KEY=' .env.local | cut -d= -f2- | tr -d '"')" bun test tests/stripe-sandbox.test.ts
 *
 * Leaves no pending PaymentIntent behind.
 */

const KEY = process.env.STRIPE_SECRET_KEY ?? '';

describe.skipIf(!KEY.startsWith('sk_test_'))('stripe sandbox smoke', () => {
  test('a ฿49 PromptPay charge: QR, cancel, cancel again, lookup canceled', async () => {
    const gateway = createStripeGateway(createStripeClient(KEY, false));
    // A fresh order id per run: the idempotency key is scoped for 24 h.
    const order = {
      id: crypto.randomUUID(),
      userId: 'sandbox-smoke',
      packId: 'p49',
      amountSatang: 4900,
      currency: 'THB',
      unitsBase: 49,
      unitsBonus: 0,
    } as Order;
    const charge = await gateway.startCharge(order, { email: 'sandbox-smoke@example.com' });
    try {
      console.log('[smoke] created', charge.providerRef, 'expiresAt', charge.expiresAt.toISOString());
      expect(charge.providerRef).toStartWith('pi_');
      expect(charge.qr.data.length).toBeGreaterThan(20);
      expect(charge.qr.imagePngUrl).toStartWith('https://');
      expect(charge.qr.imageSvgUrl).toStartWith('https://');
      const again = await gateway.startCharge(order, { email: 'sandbox-smoke@example.com' });
      expect(again.providerRef).toBe(charge.providerRef); // idempotent per order
      expect(await gateway.lookupCharge(charge.providerRef)).toEqual({ status: 'pending', amountSatang: 4900, currency: 'THB' });
      console.log('[smoke] lookup pending');
    } finally {
      expect(await gateway.cancelCharge(charge.providerRef)).toEqual({ status: 'canceled' });
    }
    expect(await gateway.cancelCharge(charge.providerRef)).toEqual({ status: 'canceled' }); // already canceled: no-op
    expect(await gateway.lookupCharge(charge.providerRef)).toEqual({ status: 'canceled', amountSatang: 4900, currency: 'THB' });
    console.log('[smoke] canceled twice, lookup canceled');
  }, 30_000);
});
