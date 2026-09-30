import { Elysia } from 'elysia';
import Stripe from 'stripe';
import { config } from '../config';
import { db } from '../lib/db';
import { IllegalOrderTransition, wallet } from '../lib/wallet';
import { fulfilPaidOrderUnlockLater } from '../lib/order-fulfilment';
import { PaymentAmountMismatch, handleProviderEvent, type ProviderEvent } from '../lib/payments/events';
import { chargeState } from '../lib/payments/stripe';

/**
 * Stripe's webhook (docs/wallet.md, Payments). Mounted only when
 * STRIPE_WEBHOOK_SECRET is set (index.ts). Every request must carry a valid
 * Stripe-Signature over the exact raw body; the body is read with
 * `request.text()` and no `body` is taken from the context, as in
 * resend-webhook.ts, because a parsed and re-serialised body fails
 * verification.
 *
 * Responses (owner decision): 400 on a bad signature, nothing recorded. 200 once
 * the event is recorded, whatever it meant (amount_mismatch,
 * illegal_transition, unknown_order, excess_payment, credit_failed_cap, a
 * duplicate): a human resolves those, and a retry would change nothing. 500
 * on any other failure, so Stripe retries; a retry of a recorded event is a
 * duplicate that only finishes an idempotent fulfilment.
 *
 * The credit is awaited; the ดวงคู่ unlock runs after the answer
 * (fulfilPaidOrderUnlockLater), since Stripe's timeout is short.
 */

/** The PaymentIntent events Horo acts on. The state comes from the event type: a failed PromptPay intent is back to requires_payment_method. */
const STATES = {
  'payment_intent.succeeded': 'succeeded',
  'payment_intent.payment_failed': 'failed',
  'payment_intent.canceled': 'canceled',
} as const;

const appHandle = (event: ProviderEvent) => handleProviderEvent(event, { db, wallet, fulfil: fulfilPaidOrderUnlockLater });

export function stripeWebhookRoutes(secret: string = config.stripe.webhookSecret, handle: typeof appHandle = appHandle) {
  return new Elysia().post('/webhooks/stripe', async ({ request, set }) => {
    const rawBody = await request.text();
    let event: Stripe.Event;
    try {
      event = await Stripe.webhooks.constructEventAsync(rawBody, request.headers.get('stripe-signature') ?? '', secret);
    } catch (error) {
      console.warn('[stripe-webhook] rejected:', error instanceof Error ? error.message : 'invalid signature');
      set.status = 400;
      return { error: 'Invalid signature' };
    }

    const status = STATES[event.type as keyof typeof STATES];
    if (!status) return { received: true, ignored: event.type };

    // Log ids only: the PaymentIntent carries the customer's email.
    const pi = event.data.object as Stripe.PaymentIntent;
    try {
      const result = await handle({
        provider: 'stripe',
        eventRef: event.id,
        providerRef: pi.id,
        state: chargeState(pi, status),
        source: 'webhook',
      });
      return { received: true, outcome: result.outcome, duplicate: result.duplicate };
    } catch (error) {
      // Both are recorded in payment_events before they are thrown; an admin resolves them.
      if (error instanceof PaymentAmountMismatch || error instanceof IllegalOrderTransition) {
        console.error('[stripe-webhook] recorded for review:', { eventId: event.id, paymentIntent: pi.id }, error.message);
        return { received: true, recorded: error instanceof PaymentAmountMismatch ? 'amount_mismatch' : 'illegal_transition' };
      }
      console.error('[stripe-webhook] not processed, Stripe will retry:', { eventId: event.id, paymentIntent: pi.id }, error);
      set.status = 500;
      return { error: 'Not processed' };
    }
  });
}
