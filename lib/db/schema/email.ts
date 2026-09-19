import { pgTable, uuid, varchar, text, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { user } from './users';

/**
 * One row per (user, campaign) — the record of an outbound campaign email.
 *
 * The unique index IS the "never send twice" guarantee, not bookkeeping after
 * the fact. The send loop claims recipients by INSERTing 'pending' rows with
 * onConflictDoNothing().returning(), so only the rows it actually claimed come
 * back, and only those get sent. Two concurrent runs, a redeploy mid-batch, or
 * a cron that fires twice all collide on this index and the loser sends
 * nothing.
 *
 * This is why the claim is an insert rather than a `lastEmailedAt` column on
 * `user` or a Redis set: both of those are written *after* a successful send,
 * so a crash between "sent" and "recorded" re-sends to that user on the next
 * run. Here the row exists before the API call, so a crash strands the user as
 * 'pending' and they are never mailed again for that campaign.
 *
 * That is the deliberate tradeoff: we accept "a crash may silently skip a
 * user" in exchange for "a crash can never double-send". Nothing re-queues
 * stale 'pending' rows automatically — see scripts/send-campaign.ts --requeue,
 * which is manual on purpose.
 *
 * status:
 *   pending — claimed, not yet handed to Resend. Crash-stranded rows stay here.
 *   sent    — Resend accepted it (providerId set). Not proof of delivery.
 *   failed  — Resend rejected it (error set). Stays claimed; not retried
 *             automatically, so a hard bounce is never re-sent in a loop.
 */
export const emailSends = pgTable('email_sends', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  campaignId: varchar('campaign_id', { length: 64 }).notNull(),
  email: text('email').notNull(), // snapshot at send time; user.email may change later
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  providerId: text('provider_id'), // Resend's message id, for support lookups
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  sentAt: timestamp('sent_at'),
}, (table) => ({
  // The dedup guarantee. Everything else here is reporting.
  userCampaignIdx: uniqueIndex('email_sends_user_campaign_idx').on(table.userId, table.campaignId),
  // "How many went out today / is this campaign drained?"
  campaignStatusIdx: index('email_sends_campaign_status_idx').on(table.campaignId, table.status),
  // Daily-cap accounting: count rows sent since a timestamp.
  sentAtIdx: index('email_sends_sent_at_idx').on(table.sentAt),
}));

/**
 * One row per delivery-outcome event Resend has told us about for a send —
 * "delivered", "bounced", "complained", and so on. This is an EVENT LOG, not a
 * current-state table: a message can legitimately produce more than one row
 * (e.g. `delivered` followed later by `complained`), and the latest status for
 * a send is `max(occurredAt)` grouped by `providerId`, never "the" row.
 *
 * The unique index on (providerId, eventType) IS the idempotency guarantee,
 * the same role email_sends' own unique index plays for sending. Two sources
 * write here and both can see the same event more than once:
 *   - resend-webhook.ts, which Resend may redeliver on a timeout or retry.
 *   - scripts/sync-email-events.ts, a backfill that can be re-run any time to
 *     catch events a webhook delivery missed.
 * Both upsert with onConflictDoNothing() on this index, so replaying the same
 * (providerId, eventType) pair a second time is a no-op rather than a second
 * row — a webhook retry or an overlapping backfill run can never double-count
 * a bounce or inflate a complaint rate.
 *
 * `occurredAt` has different meaning depending on the source, and that is
 * unavoidable rather than a bug: the webhook payload carries a true event
 * timestamp (`data.created_at` on the Resend event), but Resend's list/get
 * API exposes only `last_event` with no per-event timestamp at all — so the
 * backfill has nothing to record except the moment it observed that state.
 * Webhook-sourced rows are exact; backfill-sourced rows are an
 * observed-by-this-time bound. Do not average or sort the two sources
 * together as if they were on the same clock.
 *
 * providerId is NOT a foreign key into email_sends.providerId (that column
 * isn't unique — see email_sends' own comment) so it is joined manually at
 * query time. An event whose providerId matches no email_sends row (most
 * likely transactional mail, which never gets a row there) is recorded here
 * unchanged; userId/campaignId are filled in when the join resolves and left
 * null otherwise, rather than dropping the event.
 */
/**
 * Editable campaign content, keyed by the SAME id that email_sends.campaignId
 * uses as its dedupe key. This table exists to fix one problem: horo-be runs
 * on Railway with no persistent volume (the Dockerfile does
 * `COPY --from=builder /app/content ./content` at build time), so a file
 * written at runtime is erased on the very next deploy. Campaign copy edited
 * from the admin UI has nowhere durable to live except the database — content
 * committed to content/campaigns/*.md remains the SEED for this table (see
 * scripts/seed-campaigns.ts) and the fallback src/lib/campaigns.ts reads when
 * a given id has no row yet, so an un-migrated deploy still sends.
 *
 * `body` stays the same tiny markdown subset the disk files use (blank-line
 * paragraphs, **bold**, [label](url), {{name}}) rather than becoming
 * structured JSON. Two reasons: the renderer in src/lib/campaigns.ts
 * (toHtml/toText) is tuned line-by-line for Outlook/Gmail quirks and takes
 * that markdown as input, so JSON would need a second render path or a
 * markdown-to-JSON-to-markdown round trip for no benefit; and markdown is
 * what the operator already writes and previews — a JSON body would need its
 * own editor UI instead of a plain textarea.
 *
 * `id` is NOT a foreign key target for email_sends.campaignId, and never
 * should be: email_sends holds rows for disk-only campaigns that predate this
 * table, and drizzle-kit push runs without --force in production, so a
 * constraint that could reject an existing row would hang the deploy. The
 * immutability of `id` is enforced in application code instead — see the LOCK
 * rule in src/routes/internal-campaigns.ts, which refuses to change a
 * campaign's subject/body once email_sends has any row for it, and the
 * duplicate-not-rename route for revising a locked campaign under a new id.
 */
export const campaigns = pgTable('campaigns', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: text('name'), // optional label for listings, purely cosmetic — see Campaign['name'] in campaigns.ts
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const emailEvents = pgTable('email_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerId: text('provider_id').notNull(), // Resend's message id — joins back to email_sends.provider_id
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }), // null when providerId matches no known send
  campaignId: varchar('campaign_id', { length: 64 }), // null alongside userId, for the same reason
  eventType: varchar('event_type', { length: 32 }).notNull(), // 'delivered' | 'bounced' | 'complained' | ... (Resend's last_event / webhook `type` values)
  occurredAt: timestamp('occurred_at').notNull(), // see the source-dependent meaning above
  payload: jsonb('payload'), // raw webhook body or list-API row, kept for support lookups and re-deriving fields we didn't foresee needing
  createdAt: timestamp('created_at').defaultNow().notNull(), // when THIS row was written, not when the event occurred
}, (table) => ({
  // The dedup guarantee. See the table comment — this is the whole point.
  providerEventIdx: uniqueIndex('email_events_provider_event_idx').on(table.providerId, table.eventType),
  // "How many bounces/complaints has this campaign had?"
  campaignEventIdx: index('email_events_campaign_event_idx').on(table.campaignId, table.eventType),
}));
