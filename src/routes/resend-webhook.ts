import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { emailSends, emailEvents } from '../../lib/db/schema';
import { verifyResendWebhook } from '../lib/resend-webhook';

/**
 * Receives Resend's delivery-event webhooks (delivered / bounced / complained
 * / etc.) and records them in email_events.
 *
 * Deliberately unauthenticated in the session sense — Resend cannot log in —
 * but NOT open: every request must carry a valid svix signature before its
 * payload is trusted at all. Signature failure and "we don't recognise this
 * email" are different outcomes on purpose:
 *   - bad/missing signature  -> 401, nothing is read from the body, nothing
 *     is written. The request could be forged.
 *   - valid signature, but the email_id matches no email_sends row -> 200,
 *     ignored. This is normal for transactional mail (login, password reset),
 *     which never gets an email_sends row, so it must not look like an error
 *     to Resend's retry logic.
 *
 * IMPORTANT — raw body handling: this route declares NO `body`/`type` schema.
 * Elysia's route-level `type: 'text'` was tried and rejected: with an
 * incoming `Content-Type: application/json` (what Resend sends), Elysia
 * still parses it as an object rather than handing back the raw text — the
 * `type` option is a hint, not an override, in this Elysia version (verified
 * empirically; see the probe this route's tests document). Calling
 * `request.text()` directly on the untouched `Request` object is the only
 * way found to get the exact bytes Resend signed. Signing over anything
 * re-serialized (different key order, different whitespace) would fail
 * verification for legitimate payloads while looking, to a casual reader,
 * like it works — so this is spelled out here rather than left implicit.
 */

export const resendWebhookRoutes = new Elysia().post('/webhooks/resend', async ({ request, set }) => {
  const rawBody = await request.text();

  const verification = verifyResendWebhook(rawBody, {
    svixId: request.headers.get('svix-id'),
    svixTimestamp: request.headers.get('svix-timestamp'),
    svixSignature: request.headers.get('svix-signature'),
  });

  if (!verification.ok) {
    console.warn('[resend-webhook] rejected:', verification.reason);
    set.status = 401;
    return { error: 'Invalid signature' };
  }

  // Parsed only AFTER the signature is verified — an attacker who cannot
  // forge a valid signature must never reach code that trusts the content.
  let event: { type?: string; created_at?: string; data?: { email_id?: string; to?: string | string[] } } | null;
  try {
    event = JSON.parse(rawBody);
  } catch {
    // A body that fails to parse despite a valid signature would mean Resend
    // signed something we cannot read — not something to retry into forever.
    set.status = 400;
    return { error: 'Body is not valid JSON' };
  }

  const emailId = event?.data?.email_id;
  const eventType = event?.type;
  if (!emailId || !eventType) {
    set.status = 400;
    return { error: 'Missing data.email_id or type' };
  }

  // event.type arrives as "email.bounced"; email_events.eventType stores the
  // Resend-vocabulary suffix ("bounced") to match what the list/get API
  // calls `last_event`, so both ingestion paths write the same values.
  const shortEventType = eventType.startsWith('email.') ? eventType.slice('email.'.length) : eventType;

  // Ignore anything that isn't a delivery-outcome event this table tracks
  // (domain.*, contact.*, clicked, opened, etc.) rather than growing
  // email_events with rows nothing queries.
  const TRACKED_EVENTS = new Set(['sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed']);
  if (!TRACKED_EVENTS.has(shortEventType)) {
    return { ok: true, ignored: 'untracked event type' };
  }

  const sendRow = await db
    .select({ userId: emailSends.userId, campaignId: emailSends.campaignId })
    .from(emailSends)
    .where(eq(emailSends.providerId, emailId))
    .limit(1);

  // Unknown email_id (most likely transactional mail — see the route comment)
  // is not an error: still record the event, just without an owning user or
  // campaign, so support lookups by provider id find it either way.
  const match = sendRow[0];

  const occurredAt = event?.created_at ? new Date(event.created_at) : new Date();

  await db
    .insert(emailEvents)
    .values({
      providerId: emailId,
      userId: match?.userId ?? null,
      campaignId: match?.campaignId ?? null,
      eventType: shortEventType,
      occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
      payload: event,
    })
    // The idempotency guarantee — see email_events' doc comment. Resend can
    // and does redeliver the same event after a timeout; this makes a
    // redelivery a no-op instead of a duplicate row.
    .onConflictDoNothing({ target: [emailEvents.providerId, emailEvents.eventType] });

  return { ok: true };
});
