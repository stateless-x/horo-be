import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

/**
 * Svix webhook signature verification, implemented by hand rather than by
 * adding the `svix` package — this codebase deliberately avoids SDKs for
 * thin integrations (see the comment at the top of src/lib/email.ts). Resend
 * signs webhooks with svix, whose scheme is documented but small enough to
 * reimplement correctly:
 *
 *   signed content = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   secret         = base64 bytes AFTER stripping the "whsec_" prefix
 *                    (NOT the ASCII secret string itself)
 *   signature      = base64(HMAC-SHA256(secret, signed content))
 *   header         = "v1,<sig1> v1,<sig2> ..." — space-separated, because a
 *                    secret rotation briefly signs with both the old and new
 *                    key and a receiver must accept either.
 *
 * Verification MUST run over the exact raw request body — see
 * src/routes/resend-webhook.ts for how the route obtains that (Elysia's text
 * parser, not JSON.parse'd first). A signature computed over a re-serialized
 * object would only happen to match when key order and whitespace are
 * byte-identical to what Resend sent, which is not guaranteed.
 */

const TOLERANCE_SECONDS = 5 * 60; // matches svix's own verifier

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verifies one webhook delivery. Checks, in order: the secret is configured,
 * the required headers are present, the timestamp is within tolerance, and at
 * least one signature in the header matches.
 *
 * The timestamp check is a second, independent guard alongside the
 * email_events unique index — the index stops the same event from being
 * recorded twice, but does nothing about a captured request being replayed
 * verbatim before it is ever recorded. Rejecting a stale timestamp closes
 * that gap at the transport layer, the same way svix's own verifier does.
 */
export function verifyResendWebhook(
  rawBody: string,
  headers: { svixId?: string | null; svixTimestamp?: string | null; svixSignature?: string | null },
): VerifyResult {
  const secret = config.email.webhookSecret;
  if (!secret) return { ok: false, reason: 'RESEND_WEBHOOK_SECRET not set' };

  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: 'missing svix-id, svix-timestamp, or svix-signature header' };
  }

  const timestampSeconds = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: 'svix-timestamp is not a number' };
  }
  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > TOLERANCE_SECONDS) {
    return { ok: false, reason: `svix-timestamp outside ${TOLERANCE_SECONDS}s tolerance` };
  }

  if (!secret.startsWith('whsec_')) {
    // A misconfigured secret (e.g. pasted without the prefix) would otherwise
    // silently HMAC with the wrong key material and every request would
    // fail verification with a confusing "tampered payload" reason.
    return { ok: false, reason: 'RESEND_WEBHOOK_SECRET must start with "whsec_"' };
  }
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac('sha256', key).update(signedContent).digest();

  // svix-signature is space-separated "v1,<base64>" pairs (plural during key
  // rotation). Accept if ANY entry matches.
  const candidates = svixSignature
    .split(' ')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('v1,'))
    .map((entry) => entry.slice('v1,'.length));

  if (candidates.length === 0) {
    return { ok: false, reason: 'svix-signature has no v1 entry' };
  }

  for (const candidate of candidates) {
    let provided: Buffer;
    try {
      provided = Buffer.from(candidate, 'base64');
    } catch {
      continue; // not valid base64 — cannot match, try the next candidate
    }
    // Equal-length check first: timingSafeEqual throws on a length mismatch
    // (same pattern as verifyUnsubscribeToken in src/lib/email.ts).
    if (provided.length !== expected.length) continue;
    if (timingSafeEqual(provided, expected)) return { ok: true };
  }

  return { ok: false, reason: 'no signature matched' };
}
