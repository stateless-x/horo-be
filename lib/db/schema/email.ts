import { pgTable, uuid, varchar, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
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
