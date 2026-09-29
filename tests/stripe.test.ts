import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import Stripe from 'stripe';
import { isLocalDatabaseUrl } from '../src/lib/dev-regenerate';
import { QR_TTL_MINUTES } from '../src/lib/pricing';
import { createWallet, type Order, type Wallet } from '../src/lib/wallet';
import { selectGateway } from '../src/lib/payments';
import { EmailRequired, type ChargeState } from '../src/lib/payments/gateway';
import { StripeCallFailed, StripeNoQr, createStripeClient, createStripeGateway, type StripeClient } from '../src/lib/payments/stripe';
import { PaymentAmountMismatch, handleProviderEvent, type ProviderEvent } from '../src/lib/payments/events';
import { fulfilPaidOrderUnlockLater } from '../src/lib/order-fulfilment';
import { stripeWebhookRoutes } from '../src/routes/stripe-webhook';
import { createDbClient, orders, paymentEvents, user, walletLedger, type DbClient } from '../lib/db';

/**
 * The Stripe PromptPay adapter and webhook (docs/wallet.md, Payments). No
 * network: the adapter gets a fake Stripe client, the webhook payloads are
 * signed locally. The last block needs a local Postgres, like tests/wallet.test.ts:
 *
 *   WALLET_TEST_DATABASE_URL="postgresql://dev:<pw>@localhost:5432/horo_dev" bun test tests/stripe.test.ts
 */

const ORDER = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: 'user-1',
  packId: 'p99',
  amountSatang: 9900,
  currency: 'THB',
  unitsBase: 99,
  unitsBonus: 10,
} as Order;

const QR = { data: 'promptpay-payload', hosted_instructions_url: 'https://h', image_url_png: 'https://q.png', image_url_svg: 'https://q.svg' };

function intent(fields: Partial<Stripe.PaymentIntent>): Stripe.PaymentIntent {
  return { id: 'pi_1', object: 'payment_intent', amount: 9900, amount_received: 0, currency: 'thb', status: 'requires_action', next_action: null, ...fields } as Stripe.PaymentIntent;
}

function unexpectedState() {
  return new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code: 'payment_intent_unexpected_state',
    message: 'This PaymentIntent could not be canceled (customer: someone@example.com)',
  });
}

/** A fake Stripe client: records calls, answers from the handlers. */
function fakeStripe(handlers: {
  create?: () => Stripe.PaymentIntent;
  retrieve?: () => Stripe.PaymentIntent;
  cancel?: () => Stripe.PaymentIntent;
}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const answer = (method: string, handler?: () => Stripe.PaymentIntent) => async (...args: unknown[]) => {
    calls.push({ method, args });
    if (!handler) throw new Error(`unexpected ${method}`);
    return handler();
  };
  const client = {
    paymentIntents: { create: answer('create', handlers.create), retrieve: answer('retrieve', handlers.retrieve), cancel: answer('cancel', handlers.cancel) },
  } as unknown as StripeClient;
  return { client, calls };
}

describe('stripe adapter', () => {
  const at = new Date('2026-09-29T10:00:00Z');

  test('startCharge: a confirmed PromptPay intent keyed by the order, and its QR with Horo\'s own expiry', async () => {
    const { client, calls } = fakeStripe({
      create: () => intent({ id: 'pi_new', next_action: { type: 'promptpay_display_qr_code', promptpay_display_qr_code: QR } as Stripe.PaymentIntent.NextAction }),
    });
    const charge = await createStripeGateway(client, () => at).startCharge(ORDER, { email: 'buyer@example.com' });
    expect(charge).toEqual({
      providerRef: 'pi_new',
      qr: { data: 'promptpay-payload', imagePngUrl: 'https://q.png', imageSvgUrl: 'https://q.svg' },
      expiresAt: new Date(at.getTime() + QR_TTL_MINUTES * 60_000),
    });
    expect(calls).toEqual([
      {
        method: 'create',
        args: [
          {
            amount: 9900,
            currency: 'thb',
            payment_method_types: ['promptpay'],
            payment_method_data: { type: 'promptpay', billing_details: { email: 'buyer@example.com' } },
            confirm: true,
            description: 'Horo เติม ฿99 (109 มู)',
            metadata: { orderId: ORDER.id, packId: 'p99', userId: 'user-1' },
          },
          { idempotencyKey: `order:${ORDER.id}` },
        ],
      },
    ]);
  });

  test('startCharge without an email throws EmailRequired and calls Stripe not at all', async () => {
    const { client, calls } = fakeStripe({});
    await expect(createStripeGateway(client).startCharge(ORDER, { email: null })).rejects.toBeInstanceOf(EmailRequired);
    expect(calls).toEqual([]);
  });

  test('startCharge throws StripeNoQr when the intent has no QR', async () => {
    const { client } = fakeStripe({ create: () => intent({ id: 'pi_odd', status: 'requires_payment_method' }) });
    await expect(createStripeGateway(client).startCharge(ORDER, { email: 'b@example.com' })).rejects.toBeInstanceOf(StripeNoQr);
  });

  test('lookupCharge maps the status; the amount is amount_received once succeeded; currency upper case', async () => {
    const cases: [Stripe.PaymentIntent.Status, ChargeState][] = [
      ['succeeded', { status: 'succeeded', amountSatang: 9800, currency: 'THB' }],
      ['requires_payment_method', { status: 'pending', amountSatang: 9900, currency: 'THB' }],
      ['requires_action', { status: 'pending', amountSatang: 9900, currency: 'THB' }],
      ['processing', { status: 'pending', amountSatang: 9900, currency: 'THB' }],
      ['canceled', { status: 'canceled', amountSatang: 9900, currency: 'THB' }],
    ];
    for (const [status, expected] of cases) {
      const { client } = fakeStripe({ retrieve: () => intent({ status, amount_received: status === 'succeeded' ? 9800 : 0 }) });
      expect(await createStripeGateway(client).lookupCharge('pi_1')).toEqual(expected);
    }
    const { client } = fakeStripe({ retrieve: () => intent({ status: 'requires_capture' }) });
    await expect(createStripeGateway(client).lookupCharge('pi_1')).rejects.toThrow('requires_capture');
  });

  test('cancelCharge: canceled; already canceled is a no-op; already succeeded says so', async () => {
    const ok = fakeStripe({ cancel: () => intent({ status: 'canceled' }) });
    expect(await createStripeGateway(ok.client).cancelCharge('pi_1')).toEqual({ status: 'canceled' });
    expect(ok.calls[0]).toEqual({ method: 'cancel', args: ['pi_1', { cancellation_reason: 'abandoned' }] });

    const again = fakeStripe({ cancel: () => { throw unexpectedState(); }, retrieve: () => intent({ status: 'canceled' }) });
    expect(await createStripeGateway(again.client).cancelCharge('pi_1')).toEqual({ status: 'canceled' });

    const paid = fakeStripe({ cancel: () => { throw unexpectedState(); }, retrieve: () => intent({ status: 'succeeded' }) });
    expect(await createStripeGateway(paid.client).cancelCharge('pi_1')).toEqual({ status: 'succeeded' });

    const busy = fakeStripe({ cancel: () => { throw unexpectedState(); }, retrieve: () => intent({ status: 'processing' }) });
    await expect(createStripeGateway(busy.client).cancelCharge('pi_1')).rejects.toBeInstanceOf(StripeCallFailed);
  });

  test('a Stripe error leaves the adapter as StripeCallFailed, without Stripe\'s message', async () => {
    const { client } = fakeStripe({ retrieve: () => { throw unexpectedState(); } });
    const error = await createStripeGateway(client).lookupCharge('pi_1').catch((caught) => caught);
    expect(error).toBeInstanceOf(StripeCallFailed);
    expect(error.stripe).toMatchObject({ type: 'StripeInvalidRequestError', code: 'payment_intent_unexpected_state' });
    expect(error.message).not.toContain('@');
  });

  test('keys: missing refused; live only in production; test only outside it', () => {
    expect(() => createStripeClient('', false)).toThrow('needs STRIPE_SECRET_KEY');
    expect(() => createStripeClient('sk_live_x', false)).toThrow('refused');
    expect(() => createStripeClient('sk_test_x', true)).toThrow('refused');
    expect(() => createStripeClient('pk_test_x', false)).toThrow('refused');
    expect(createStripeClient('sk_test_x', false)).toBeInstanceOf(Stripe);
    expect(createStripeClient('sk_live_x', true)).toBeInstanceOf(Stripe);
  });

  test('production with stripe and no webhook secret refuses to start', () => {
    expect(() => selectGateway({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'stripe' }, { secretKey: 'sk_live_x', webhookSecret: '' })).toThrow('STRIPE_WEBHOOK_SECRET');
    expect(selectGateway({ PAYMENT_PROVIDER: 'stripe' }, { secretKey: 'sk_test_x', webhookSecret: '' }).provider).toBe('stripe');
  });
});

const SECRET = 'whsec_horo_test';

/** A Stripe event for this PaymentIntent, pretty-printed so a parse-and-restringify would not match the signature. */
function eventBody(id: string, type: string, pi: Partial<Stripe.PaymentIntent>) {
  return JSON.stringify({ id, object: 'event', type, data: { object: { object: 'payment_intent', currency: 'thb', ...pi } } }, null, 2);
}

async function post(app: ReturnType<typeof stripeWebhookRoutes>, body: string, signature?: string) {
  const header = signature ?? (await Stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret: SECRET }));
  return app.handle(
    new Request('http://localhost/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
      body,
    }),
  );
}

describe('stripe webhook route', () => {
  function routeWith(handle: (event: ProviderEvent) => Promise<{ outcome: string; duplicate: boolean }>) {
    const seen: ProviderEvent[] = [];
    const app = stripeWebhookRoutes(SECRET, async (event) => (seen.push(event), handle(event)) as never);
    return { app, seen };
  }

  test('a bad or missing signature is 400 and reaches nothing', async () => {
    const { app, seen } = routeWith(async () => ({ outcome: 'paid', duplicate: false }));
    const body = eventBody('evt_1', 'payment_intent.succeeded', { id: 'pi_1', amount: 4900, amount_received: 4900, status: 'succeeded' });
    const forged = await Stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret: 'whsec_other' });
    expect((await post(app, body, forged)).status).toBe(400);
    expect((await post(app, body, '')).status).toBe(400);
    expect((await post(app, body.replace('4900', '4901'))).status).toBe(200); // re-signed: fine
    expect(seen).toHaveLength(1);
  });

  test('maps the event type to the state (a failed intent is requires_payment_method), with the raw body', async () => {
    const { app, seen } = routeWith(async () => ({ outcome: 'failed', duplicate: false }));
    const body = eventBody('evt_f', 'payment_intent.payment_failed', { id: 'pi_f', amount: 4900, amount_received: 0, status: 'requires_payment_method' });
    const response = await post(app, body);
    expect(response.status).toBe(200);
    expect(seen).toEqual([
      { provider: 'stripe', eventRef: 'evt_f', providerRef: 'pi_f', source: 'webhook', state: { status: 'failed', amountSatang: 4900, currency: 'THB' } },
    ]);
  });

  test('other event types are 200 and ignored', async () => {
    const { app, seen } = routeWith(async () => ({ outcome: 'paid', duplicate: false }));
    const response = await post(app, eventBody('evt_c', 'charge.succeeded', { id: 'ch_1' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: 'charge.succeeded' });
    expect(seen).toEqual([]);
  });

  test('recorded refusals are 200; anything else is 500 so Stripe retries', async () => {
    const body = eventBody('evt_s', 'payment_intent.succeeded', { id: 'pi_s', amount: 4900, amount_received: 100, status: 'succeeded' });
    const mismatch = routeWith(async () => {
      throw new PaymentAmountMismatch('o1', { amountSatang: 4900, currency: 'THB' }, { amountSatang: 100, currency: 'THB' });
    });
    const response = await post(mismatch.app, body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, recorded: 'amount_mismatch' });
    const down = routeWith(async () => {
      throw new Error('connection refused');
    });
    expect((await post(down.app, body)).status).toBe(500);
  });
});

const TEST_DB_URL = process.env.WALLET_TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('stripe webhook on a local Postgres', () => {
  let db: DbClient;
  let wallet: Wallet;
  const userIds: string[] = [];
  const run = crypto.randomUUID().slice(0, 8);
  const unlocks: string[] = [];
  let gate: Promise<void> = Promise.resolve();

  beforeAll(async () => {
    if (!TEST_DB_URL || !isLocalDatabaseUrl(TEST_DB_URL)) {
      throw new Error('WALLET_TEST_DATABASE_URL must point at a database on this machine');
    }
    db = createDbClient(TEST_DB_URL);
    wallet = createWallet(db);
  });

  afterAll(async () => {
    if (!db || userIds.length === 0) return;
    // Test cleanup only: the app never deletes ledger or payment event rows.
    const testOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds));
    await db.delete(paymentEvents).where(or(inArray(paymentEvents.orderId, testOrders), like(paymentEvents.eventRef, `evt_${run}%`)));
    await db.delete(walletLedger).where(inArray(walletLedger.userId, userIds));
    await db.delete(orders).where(inArray(orders.userId, userIds));
    await db.delete(user).where(inArray(user.id, userIds));
  });

  function app() {
    // The unlock waits on `gate`, standing in for ~20 s of generation.
    const unlock = async (_userId: string, rowId: string) => {
      await gate;
      unlocks.push(rowId);
      return { status: 200 as const };
    };
    return stripeWebhookRoutes(SECRET, (event) =>
      handleProviderEvent(event, { db, wallet, fulfil: (orderId, actor) => fulfilPaidOrderUnlockLater(orderId, actor, { wallet, unlock }) }),
    );
  }

  /** A pending order carrying a Stripe charge `pi_<run>_<n>`. */
  async function stripeOrder(packId: 'p49' | 'p99' = 'p49', unlockRef?: string) {
    const id = `stripe-test-${run}-${userIds.length}`;
    await db.insert(user).values({ id, name: 'stripe test', email: `${id}@wallet.test` });
    userIds.push(id);
    const order = await wallet.createOrder(id, packId, unlockRef);
    const providerRef = `pi_${run}_${userIds.length}`;
    await wallet.attachCharge(order.id, 'stripe', {
      providerRef,
      qr: { data: 'qr', imagePngUrl: null, imageSvgUrl: null },
      expiresAt: new Date(Date.now() + QR_TTL_MINUTES * 60_000),
    });
    return { userId: id, orderId: order.id, providerRef, amount: order.amountSatang };
  }

  const status = async (orderId: string) => (await db.select().from(orders).where(eq(orders.id, orderId)))[0].status;
  const eventsOf = (orderId: string) => db.select().from(paymentEvents).where(eq(paymentEvents.orderId, orderId));
  const purchases = (userId: string) =>
    db.select().from(walletLedger).where(and(eq(walletLedger.userId, userId), eq(walletLedger.kind, 'purchase')));

  test('a bad signature records nothing', async () => {
    const order = await stripeOrder();
    const body = eventBody(`evt_${run}_bad`, 'payment_intent.succeeded', { id: order.providerRef, amount: 4900, amount_received: 4900, status: 'succeeded' });
    const forged = await Stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret: 'whsec_other' });
    expect((await post(app(), body, forged)).status).toBe(400);
    expect(await eventsOf(order.orderId)).toEqual([]);
    expect(await status(order.orderId)).toBe('pending');
  });

  test('succeeded pays and credits once; the same event again is 200 and credits nothing more', async () => {
    const order = await stripeOrder('p99');
    const body = eventBody(`evt_${run}_ok`, 'payment_intent.succeeded', { id: order.providerRef, amount: 9900, amount_received: 9900, status: 'succeeded' });
    const first = await post(app(), body);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true, outcome: 'paid', duplicate: false });
    const again = await post(app(), body);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ outcome: 'paid', duplicate: true });
    expect(await status(order.orderId)).toBe('paid');
    expect(await wallet.balance(order.userId)).toBe(109);
    expect((await purchases(order.userId)).map((row) => row.actorLabel)).toEqual([`stripe:evt_${run}_ok`]);
  });

  test('payment_failed on a pending order fails it; a later succeeded pays and credits it (PO condition A)', async () => {
    const order = await stripeOrder();
    const failed = eventBody(`evt_${run}_f`, 'payment_intent.payment_failed', { id: order.providerRef, amount: 4900, amount_received: 0, status: 'requires_payment_method' });
    expect((await post(app(), failed)).status).toBe(200);
    expect(await status(order.orderId)).toBe('failed');
    const paid = eventBody(`evt_${run}_f2`, 'payment_intent.succeeded', { id: order.providerRef, amount: 4900, amount_received: 4900, status: 'succeeded' });
    expect((await post(app(), paid)).status).toBe(200);
    expect(await status(order.orderId)).toBe('paid');
    expect(await wallet.balance(order.userId)).toBe(49);
  });

  test('a short payment is 200, recorded as amount_mismatch, and credits nothing', async () => {
    const order = await stripeOrder();
    const body = eventBody(`evt_${run}_short`, 'payment_intent.succeeded', { id: order.providerRef, amount: 4900, amount_received: 100, status: 'succeeded' });
    const response = await post(app(), body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, recorded: 'amount_mismatch' });
    expect((await eventsOf(order.orderId)).map((row) => row.kind)).toEqual(['amount_mismatch']);
    expect(await status(order.orderId)).toBe('pending');
    expect(await wallet.balance(order.userId)).toBe(0);
  });

  test('the webhook answers once credited, without waiting for the ดวงคู่ unlock', async () => {
    let open!: () => void;
    gate = new Promise((resolve) => (open = resolve));
    try {
      const order = await stripeOrder('p49', `row-${run}`);
      const body = eventBody(`evt_${run}_unlock`, 'payment_intent.succeeded', { id: order.providerRef, amount: 4900, amount_received: 4900, status: 'succeeded' });
      const response = await post(app(), body);
      expect(response.status).toBe(200);
      expect(await wallet.balance(order.userId)).toBe(49);
      expect(unlocks).toEqual([]); // still generating
      open();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unlocks).toEqual([`row-${run}`]);
    } finally {
      open();
      gate = Promise.resolve();
    }
  });
});
