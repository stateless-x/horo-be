import { sql, and, eq, gte, notInArray } from 'drizzle-orm';
import { db } from './db';
import { user, emailSends } from '../../lib/db/schema';
import { config } from '../config';
import { sendEmail, unsubscribeUrl, getAccountSentToday } from './email';
import { loadCampaign, renderBody, toHtml, toText } from './campaigns';

/**
 * The campaign send loop, shared by scripts/send-campaign.ts and the
 * admin-triggered POST /internal/campaigns/send.
 *
 * It lives here rather than in the script so both callers get the SAME
 * guarantees — the claim-before-send dedupe and the account-wide quota check.
 * A second copy of this logic behind the HTTP route is how a "never twice"
 * promise quietly becomes "usually once".
 */

/** Bangkok day boundary — the quota is per calendar day as the user sees it. */
export function startOfBangkokDay(): Date {
  const now = new Date();
  const bangkokMs = now.getTime() + 7 * 60 * 60 * 1000;
  const dayStart = new Date(Math.floor(bangkokMs / 86400000) * 86400000);
  return new Date(dayStart.getTime() - 7 * 60 * 60 * 1000);
}

export type Candidate = {
  id: string;
  email: string;
  name: string | null;
  fallbackName: string;
};

export type PlanResult =
  | { ok: false; reason: string }
  | { ok: true; candidates: Candidate[]; quotaUsed: number; quotaCap: number };

/**
 * Who would receive this campaign right now, bounded by the remaining
 * account-wide quota. Writes nothing.
 *
 * Excludes users whose stored email is not a valid address, and anyone who
 * already has a row for this campaign — including a 'failed' one, so a rejected
 * address is never retried.
 *
 * Refuses when the provider's usage cannot be read: the quota is shared with
 * other projects, so without that number there is no safe batch size.
 */
export async function planSend(campaignId: string, only?: string): Promise<PlanResult> {
  const dayStart = startOfBangkokDay();
  const usage = await getAccountSentToday(dayStart);

  if (!usage.known) {
    return {
      ok: false,
      reason: `Cannot read today's Resend usage (${usage.reason}). The quota is shared with your other projects, so there is no safe amount to send.`,
    };
  }

  const budget = Math.max(0, config.email.dailyCap - usage.sentToday);
  if (budget <= 0) {
    return { ok: false, reason: `Daily cap reached (${usage.sentToday}/${config.email.dailyCap}).` };
  }

  const alreadyHandled = db
    .select({ userId: emailSends.userId })
    .from(emailSends)
    .where(eq(emailSends.campaignId, campaignId));

  const candidates = await db
    .select({ id: user.id, email: user.email, name: user.displayName, fallbackName: user.name })
    .from(user)
    .where(
      and(
        eq(user.emailOptOut, false),
        // Skip rows whose "email" is not one. OAuth sign-ups can land a
        // provider username here (153 of them at the time of writing), and
        // mailing those produces hard bounces — the single fastest way to
        // wreck a new sending domain's reputation.
        sql`${user.email} ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'`,
        notInArray(user.id, alreadyHandled),
        only ? eq(user.email, only) : undefined,
      ),
    )
    .orderBy(user.createdAt) // oldest signups first — stable across runs
    .limit(budget);

  return {
    ok: true,
    candidates,
    quotaUsed: usage.sentToday,
    quotaCap: config.email.dailyCap,
  };
}

export type SendOutcome = {
  sent: number;
  failed: number;
  requeued: number;
  errored: number;
  /** True when the provider reported the account out of quota mid-batch. */
  quotaHit: boolean;
};

/**
 * Send to an already-planned list. Each recipient is claimed by inserting a
 * 'pending' row BEFORE the API call, against UNIQUE(user_id, campaign_id) — so
 * a concurrent run, a double-submitted form, or a retried request all lose the
 * conflict and send nothing.
 *
 * `onProgress` exists so the CLI can print per-recipient lines; the HTTP caller
 * passes nothing and reads the totals.
 */
export async function executeSend(
  campaignId: string,
  candidates: Candidate[],
  opts: { withUnsubscribe: boolean; onProgress?: (line: string) => void },
): Promise<SendOutcome> {
  const campaign = loadCampaign(campaignId);
  const log = opts.onProgress ?? (() => {});

  let sent = 0;
  let failed = 0;
  let requeued = 0;
  let errored = 0;
  let quotaHit = false;

  for (const c of candidates) {
    // One recipient must never abort the batch: sendEmail swallows its own
    // errors, but the db calls around it can throw.
    try {
      const claimed = await db
        .insert(emailSends)
        .values({ userId: c.id, campaignId, email: c.email, status: 'pending' })
        .onConflictDoNothing()
        .returning({ id: emailSends.id });

      if (claimed.length === 0) continue; // another run owns this recipient

      const name = c.name || c.fallbackName || 'คุณ';
      const link = opts.withUnsubscribe ? unsubscribeUrl(c.id) : undefined;
      const body = renderBody(campaign.body, { name });

      const result = await sendEmail({
        to: c.email,
        subject: campaign.subject,
        html: toHtml(body, link),
        text: toText(body, link),
        unsubscribeUrl: link,
      });

      if (result.ok) {
        await db
          .update(emailSends)
          .set({ status: 'sent', providerId: result.providerId, sentAt: new Date() })
          .where(eq(emailSends.id, claimed[0].id));
        sent++;
        log(`  ✓ ${c.email}`);
      } else if (/rate|quota|limit|429|too many/i.test(result.error) && result.retryable) {
        // Quota exhausted mid-batch, typically another project spending it.
        // Release the claim and stop rather than failing every remaining send.
        await db.delete(emailSends).where(eq(emailSends.id, claimed[0].id));
        requeued++;
        log(`  ↻ ${c.email} — ${result.error}`);
        quotaHit = true;
        break;
      } else if (result.retryable) {
        // Transient: Resend never accepted it, so releasing the claim cannot
        // double-send. This user is a candidate again next run.
        await db.delete(emailSends).where(eq(emailSends.id, claimed[0].id));
        requeued++;
        log(`  ↻ ${c.email} — ${result.error} (will retry next run)`);
      } else {
        // Terminal: keep the row so a dead address is never mailed again.
        await db
          .update(emailSends)
          .set({ status: 'failed', error: result.error })
          .where(eq(emailSends.id, claimed[0].id));
        failed++;
        log(`  ✗ ${c.email} — ${result.error} (permanent, will not retry)`);
      }
    } catch (err) {
      errored++;
      log(`  ! ${c.email} — ${err instanceof Error ? err.message : String(err)} (db error, batch continues)`);
    }

    // ~2/sec: Resend's default rate limit is 2 requests/second.
    await new Promise((r) => setTimeout(r, 550));
  }

  return { sent, failed, requeued, errored, quotaHit };
}

/** Config that must be present before any claim is written. */
export function missingSendConfig(): string[] {
  return [
    !config.email.resendApiKey && 'RESEND_API_KEY',
    !config.email.from && 'EMAIL_FROM',
    !config.email.replyTo && 'EMAIL_REPLY_TO',
  ].filter(Boolean) as string[];
}
