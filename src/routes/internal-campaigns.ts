import { Elysia, t } from 'elysia';
import { eq, count } from 'drizzle-orm';
import { config } from '../config';
import { adminSecretMatches } from '../lib/admin-secret';
import { planSend, executeSend, missingSendConfig } from '../lib/campaign-sender';
import { loadCampaignAsync, listCampaignsAsync, listCampaignIds, renderBody, toHtml, toText } from '../lib/campaigns';
import { lintCampaign } from '../lib/campaign-lint';
import { db } from '../lib/db';
import { campaigns, emailSends } from '../../lib/db/schema';

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

export const internalCampaignRoutes = new Elysia({ prefix: '/internal/campaigns' })
  // One guard for every route below: no valid secret, no access.
  .onBeforeHandle(({ request, set }) => {
    const header = request.headers.get('x-admin-secret') ?? undefined;
    if (!adminSecretMatches(header)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
  })

  /** What would be sent right now. Writes nothing — backs the admin preview. */
  .get('/plan/:campaignId', async ({ params, set }) => {
    let campaign;
    try {
      // DB-first: this preview must show the same subject/body executeSend
      // will actually use, including an edit made in the admin UI.
      campaign = await loadCampaignAsync(params.campaignId);
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

  /** Campaigns available to send — DB rows plus any disk-only file not yet seeded. */
  .get('/', async () => ({ campaigns: await listCampaignsAsync() }))

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
        // Must use the DB-first loader: a campaign created only via
        // POST /internal/campaigns/:id/duplicate has no disk file at all, and
        // the sync disk-only lookup would 404 it here even though it can be sent.
        await loadCampaignAsync(body.campaignId);
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
  )

  /**
   * Current content for the admin editor: what would be sent, whether it can
   * still be edited, and how many email_sends rows already exist (the number
   * that locked it, if it is locked).
   */
  .get('/:id/content', async ({ params, set }) => {
    let campaign;
    try {
      campaign = await loadCampaignAsync(params.id);
    } catch (err) {
      set.status = 404;
      return { error: err instanceof Error ? err.message : 'Unknown campaign' };
    }

    const sentCount = await sendCountFor(params.id);
    const updatedAt = await updatedAtFor(params.id);

    return {
      id: campaign.id,
      name: campaign.name ?? null,
      subject: campaign.subject,
      body: campaign.body,
      locked: sentCount > 0,
      sentCount,
      updatedAt,
    };
  })

  /**
   * Save edited subject/body. THE LOCK: once email_sends has ANY row for this
   * campaign_id — sent, pending, or failed, no status filter, matching
   * planSend's own `alreadyHandled` — the id is retired from editing. A
   * 'pending' or 'failed' row still means that recipient will NEVER be
   * offered this campaign again (planSend excludes them regardless of
   * status), so it locks the copy just as hard as a delivered 'sent' row
   * would. This is what keeps "one campaign id = one email text" true even
   * when horo-admin's UI bug or a determined operator tries to edit around
   * it — the check lives in the route, not the button.
   *
   * `name` is exempt from the lock: campaigns.ts has always documented it as
   * "purely cosmetic... can be reworded any time without affecting who has
   * been sent what", so a locked campaign may still have its listing label
   * changed. Only a real subject/body change (compared to the stored row) is
   * refused.
   */
  .put(
    '/:id/content',
    async ({ params, body, set }) => {
      const sentCount = await sendCountFor(params.id);

      const existing = await db.select().from(campaigns).where(eq(campaigns.id, params.id)).limit(1);
      const current = existing[0];

      const changesLockedFields =
        !current || current.subject !== body.subject || current.body !== body.body;

      if (sentCount > 0 && changesLockedFields) {
        set.status = 409;
        return {
          error:
            `Campaign "${params.id}" is locked: ${sentCount} email_sends row(s) already exist for it. ` +
            `Subject and body can no longer change — duplicate it into a new campaign id to send revised copy.`,
          sentCount,
        };
      }

      const lint = lintCampaign(body.subject, body.body);
      if (!lint.ok) {
        set.status = 422;
        return { error: 'Campaign has validation errors and was not saved.', issues: lint.issues };
      }

      await db
        .insert(campaigns)
        .values({ id: params.id, name: body.name ?? null, subject: body.subject, body: body.body })
        .onConflictDoUpdate({
          target: campaigns.id,
          set: { name: body.name ?? null, subject: body.subject, body: body.body, updatedAt: new Date() },
        });

      return { id: params.id, saved: true, issues: lint.issues };
    },
    {
      body: t.Object({
        name: t.Optional(t.Nullable(t.String())),
        subject: t.String({ minLength: 1 }),
        body: t.String({ minLength: 1 }),
      }),
    },
  )

  /**
   * Fork a (possibly locked) campaign under a fresh id so the operator can
   * revise it as a new message rather than mutate history. Rejects a new id
   * that already denotes a campaign anywhere the send path would find one —
   * the DB, the disk seed files, AND email_sends — because a disk file
   * without a DB row, or an email_sends row whose disk file was since
   * deleted, are both "already used" even though neither alone would be
   * caught by an id-exists check on just one of the three.
   */
  .post(
    '/:id/duplicate',
    async ({ params, body, set }) => {
      const newId = body.newId;
      if (!/^[a-z0-9-]{1,64}$/.test(newId)) {
        set.status = 400;
        return {
          error: `Invalid campaign id "${newId}" — lowercase letters, digits and hyphens only, 1-64 characters.`,
        };
      }

      let source;
      try {
        source = await loadCampaignAsync(params.id);
      } catch (err) {
        set.status = 404;
        return { error: err instanceof Error ? err.message : 'Unknown source campaign' };
      }

      const [dbRow, sendCount] = await Promise.all([
        db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, newId)).limit(1),
        sendCountFor(newId),
      ]);
      const diskHasId = listCampaignIds().includes(newId);

      if (dbRow.length > 0 || diskHasId || sendCount > 0) {
        set.status = 409;
        return { error: `Campaign id "${newId}" is already in use.` };
      }

      await db.insert(campaigns).values({
        id: newId,
        name: body.name ?? (source.name ? `${source.name} (copy)` : null),
        subject: source.subject,
        body: source.body,
      });

      return { id: newId, subject: source.subject, body: source.body };
    },
    {
      body: t.Object({
        newId: t.String({ minLength: 1, maxLength: 64 }),
        name: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  /**
   * Render the given (not-yet-saved) subject/body through the REAL
   * toHtml/toText/renderBody so the operator sees the actual email — same
   * renderer, same sample substitution — before committing to a save. Saves
   * nothing: this is the ONLY route in this file with no db write at all.
   *
   * Returns lint issues alongside the render (not a 422) because the point of
   * a preview is to see what's wrong, including the errors that would block a
   * save — blocking the preview on the same errors it exists to surface would
   * defeat it. `errors` and `warnings` are split exactly like PUT's own
   * validation, so the admin UI never has to re-derive severity from `code` —
   * an error rendered as an advisory "warning" is how a near-miss
   * placeholder like {{ name }} ships to real recipients unnoticed.
   */
  .post(
    '/:id/preview',
    ({ body }) => {
      const lint = lintCampaign(body.subject, body.body);
      const rendered = renderBody(body.body, { name: 'ทดสอบ' }); // sample name, Thai so length/wrapping look real
      return {
        html: toHtml(rendered),
        text: toText(rendered),
        subject: body.subject,
        errors: lint.errors,
        warnings: lint.warnings,
      };
    },
    {
      body: t.Object({
        subject: t.String(),
        body: t.String(),
      }),
    },
  );

/** Total email_sends rows for a campaign, any status — the lock's own count. */
async function sendCountFor(campaignId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(emailSends)
    .where(eq(emailSends.campaignId, campaignId));
  return rows[0]?.n ?? 0;
}

/** DB row's updatedAt, or null for a campaign still served from the disk seed. */
async function updatedAtFor(campaignId: string): Promise<string | null> {
  const rows = await db
    .select({ updatedAt: campaigns.updatedAt })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return rows[0]?.updatedAt.toISOString() ?? null;
}
