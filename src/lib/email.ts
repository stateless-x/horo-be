import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

/**
 * Thin Resend client + unsubscribe-token helpers.
 *
 * Plain fetch rather than the `resend` SDK: this is two endpoints and the
 * project has no other HTTP SDK dependencies (see src/lib/llm.ts, which calls
 * DeepSeek the same way).
 */

const RESEND_API = 'https://api.resend.com/emails';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Unsubscribe URL. Sets List-Unsubscribe so clients show a native opt-out. */
  unsubscribeUrl?: string;
}

export type SendEmailResult =
  | { ok: true; providerId: string }
  | { ok: false; error: string; retryable: boolean };

/**
 * Whether a failure is worth trying again on a later run.
 *
 * Retryable: the send never happened for a reason that may pass — a network
 * blip, a 5xx, or a 429 rate-limit. Re-sending cannot duplicate, because a
 * failed request means Resend never accepted the message.
 *
 * NOT retryable: the address itself is bad (422 validation, 400 malformed).
 * Retrying those every run mails a dead address forever, and repeated hard
 * bounces are exactly what wrecks domain reputation — the thing we are
 * protecting. A 403 is also terminal: the domain is not verified, so retrying
 * just burns quota until the config is fixed.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;   // rate limited — back off and retry
  if (status >= 500) return true;    // provider-side, likely transient
  return false;                      // 4xx: our request is wrong, retrying won't fix it
}

/**
 * Send one email. Never throws — the caller records the outcome per recipient,
 * so a single bad address must not abort a batch mid-run.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // Config problems are not retryable: every send fails identically until a
  // human fixes the env var, so marking them retryable would just churn.
  if (!config.email.resendApiKey) return { ok: false, error: 'RESEND_API_KEY not set', retryable: false };
  if (!config.email.from) return { ok: false, error: 'EMAIL_FROM not set', retryable: false };

  const headers: Record<string, string> = {};
  if (input.unsubscribeUrl) {
    // Gmail/Outlook surface a native "Unsubscribe" control from these two.
    // One-Click is required alongside List-Unsubscribe for bulk senders.
    headers['List-Unsubscribe'] = `<${input.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const body: Record<string, unknown> = {
    from: config.email.from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  if (config.email.replyTo) body.reply_to = config.email.replyTo;
  if (Object.keys(headers).length > 0) body.headers = headers;

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.email.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = await res.json().catch(() => null) as { id?: string; message?: string } | null;

    if (!res.ok) {
      return {
        ok: false,
        error: payload?.message || `HTTP ${res.status}`,
        retryable: isRetryableStatus(res.status),
      };
    }
    if (!payload?.id) {
      // 2xx with no id: ambiguous — Resend may have accepted it. Treat as
      // terminal, since retrying risks the double-send we exist to prevent.
      return { ok: false, error: 'Resend returned no message id', retryable: false };
    }
    return { ok: true, providerId: payload.id };
  } catch (err) {
    // Network/DNS/timeout — the request likely never landed, so retry is safe.
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
  }
}

/**
 * Unsubscribe links carry `<userId>.<hmac>` rather than a bare user id, so a
 * recipient cannot opt out somebody else by editing the URL. The id stays
 * readable — the signature is what authorises the write.
 */
export function signUnsubscribeToken(userId: string): string {
  const mac = createHmac('sha256', config.email.unsubscribeSecret).update(userId).digest('hex');
  return `${userId}.${mac}`;
}

/** Returns the userId when the signature matches, else null. */
export function verifyUnsubscribeToken(token: string): string | null {
  if (!config.email.unsubscribeSecret) return null;

  const sep = token.lastIndexOf('.');
  if (sep <= 0) return null;

  const userId = token.slice(0, sep);
  const provided = token.slice(sep + 1);
  const expected = createHmac('sha256', config.email.unsubscribeSecret).update(userId).digest('hex');

  // Equal-length check first: timingSafeEqual throws on a length mismatch.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;

  return userId;
}

export function unsubscribeUrl(userId: string): string {
  return `${config.oauth.baseUrl}/email/unsubscribe/${signUnsubscribeToken(userId)}`;
}
