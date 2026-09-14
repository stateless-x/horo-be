import { Elysia, t } from 'elysia';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';
import { planSend, executeSend, missingSendConfig } from '../lib/campaign-sender';
import { loadCampaign, listCampaigns } from '../lib/campaigns';

/**
 * Service-to-service campaign sending, called by horo-admin.
 *
 * NOT a public API and not session-authenticated: horo-admin proves itself with
 * a shared secret (ADMIN_API_SECRET) that only the two services know. horo-admin
 * does its own access check before calling — this endpoint's job is to refuse
 * anyone who is not horo-admin at all.
 *
 * The whole route is absent unless ADMIN_API_SECRET is set, so a misconfigured
 * deploy cannot expose an unauthenticated send. Mounting is gated in index.ts
 * for the same reason.
 *
 * Every send still runs through the shared campaign-sender module, so the
 * claim-before-send dedupe and the account-wide quota check apply exactly as
 * they do on the CLI. There is no "just send" path.
 */

/** Constant-time compare so the secret cannot be guessed a byte at a time. */
function secretMatches(provided: string | undefined): boolean {
  const expected = config.adminApi.secret;
  if (!expected || !provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const internalCampaignRoutes = new Elysia({ prefix: '/internal/campaigns' })
  // One guard for every route below: no valid secret, no access.
  .onBeforeHandle(({ request, set }) => {
    const header = request.headers.get('x-admin-secret') ?? undefined;
    if (!secretMatches(header)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
  })

  /** What would be sent right now. Writes nothing — backs the admin preview. */
  .get('/plan/:campaignId', async ({ params, set }) => {
    let campaign;
    try {
      campaign = loadCampaign(params.campaignId);
    } catch (err) {
      set.status = 404;
      return { error: err instanceof Error ? err.message : 'Unknown campaign' };
    }

    const plan = await planSend(params.campaignId);
    if (!plan.ok) {
      set.status = 409; // readable state, just not a sendable one
      return {
        error: plan.reason,
        code: plan.code,
        ...(plan.code === 'quota_exhausted'
          ? { quotaUsed: plan.quotaUsed, quotaCap: plan.quotaCap }
          : {}),
      };
    }

    return {
      campaignId: params.campaignId,
      name: campaign.name ?? null,
      subject: campaign.subject,
      from: config.email.from,
      replyTo: config.email.replyTo,
      recipientCount: plan.candidates.length,
      // The whole batch, not a sample. It is bounded by the daily cap (100 on
      // the free tier), so this is a short list — and "who exactly am I about
      // to mail?" is the question the preview exists to answer. A five-address
      // teaser left the operator approving 100 sends on trust.
      recipients: plan.candidates.map((c) => c.email),
      // Kept for older callers; the first few of the same list.
      sampleRecipients: plan.candidates.slice(0, 5).map((c) => c.email),
      quotaUsed: plan.quotaUsed,
      quotaCap: plan.quotaCap,
    };
  })

  /** Campaign files available to send. */
  .get('/', () => ({ campaigns: listCampaigns() }))

  /**
   * Send one batch.
   *
   * `expectedCount` is the same gate as the CLI's --confirm: the caller states
   * how many recipients it showed a human, and a mismatch aborts. Without it a
   * stale admin tab could approve a batch that has since changed.
   */
  .post(
    '/send',
    async ({ body, set }) => {
      const missing = missingSendConfig();
      if (missing.length > 0) {
        set.status = 503;
        return { error: `Cannot send — missing: ${missing.join(', ')}` };
      }

      try {
        loadCampaign(body.campaignId);
      } catch (err) {
        set.status = 404;
        return { error: err instanceof Error ? err.message : 'Unknown campaign' };
      }

      const plan = await planSend(body.campaignId);
      if (!plan.ok) {
        set.status = 409;
        return { error: plan.reason, code: plan.code };
      }

      if (plan.candidates.length !== body.expectedCount) {
        set.status = 409;
        return {
          error:
            `The batch changed since you reviewed it: you approved ${body.expectedCount} ` +
            `recipient(s), but it now has ${plan.candidates.length}. Nothing was sent — ` +
            `reload and confirm the new count.`,
        };
      }

      if (plan.candidates.length === 0) {
        return { sent: 0, failed: 0, requeued: 0, errored: 0, quotaHit: false };
      }

      const outcome = await executeSend(body.campaignId, plan.candidates, {
        // Unsubscribe links need BETTER_AUTH_SECRET to sign; without it we send
        // without a footer rather than failing the batch.
        withUnsubscribe: Boolean(process.env.BETTER_AUTH_SECRET),
      });

      return outcome;
    },
    {
      body: t.Object({
        campaignId: t.String({ minLength: 1, maxLength: 64 }),
        expectedCount: t.Integer({ minimum: 0 }),
      }),
    },
  );
