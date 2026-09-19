#!/usr/bin/env bun

/**
 * Backfill email_events from Resend for every email_sends row we believe we
 * sent, so delivery outcomes (delivered / bounced / complained) are captured
 * even for sends that predate the webhook, or for any delivery whose webhook
 * never arrived (Resend redelivers on failure, but not forever).
 *
 * Usage:
 *   bun run scripts/sync-email-events.ts --dry-run
 *   bun run scripts/sync-email-events.ts --limit 50
 *   bun run scripts/sync-email-events.ts
 *
 * Flags:
 *   --dry-run     print what would be written; write nothing
 *   --limit <n>   sync at most n email_sends rows, oldest sentAt first
 *
 * WHY THE LIST ENDPOINT, NOT ONE GET PER ROW
 * GET /emails/{id} is one HTTP round trip per row. With thousands of sends,
 * that is thousands of requests and a real chance of tripping Resend's rate
 * limit partway through. GET /emails (list, `limit` + `after` cursor,
 * documented max 100/page) returns `last_event` for up to 100 messages per
 * call, so a full backfill of N sends costs N/100 requests instead of N.
 *
 * The list has no date or id filter, so we cannot ask Resend for "just these
 * ids" — instead we walk it newest-first, build a lookup by provider id, and
 * match it against the email_sends rows we're syncing. Rows that fall outside
 * the pages we walked (older than MAX_PAGES * 100 messages ago, or from a
 * Resend account whose history this key cannot fully see) are looked up
 * individually with GET /emails/{id} as a fallback — the whole point of
 * paging first is that this fallback is the exception, not the norm.
 *
 * IDEMPOTENCY
 * Every write goes through onConflictDoNothing() against email_events' unique
 * index on (providerId, eventType) — see lib/db/schema/email.ts. Re-running
 * this script after a webhook already recorded the same (id, event) pair is a
 * no-op, not a duplicate. That is what makes it safe to run on a cron AND by
 * hand without coordinating with the webhook.
 *
 * FAILURE HANDLING
 * A single row's lookup or insert failing must not lose progress on the rest
 * — each row's outcome is recorded independently (synced / skipped / errored),
 * mirroring send-campaign.ts's per-recipient accounting. A 429 triggers an
 * exponential backoff retry (a few attempts) rather than aborting the run,
 * since the whole point of preferring the list endpoint was to avoid rate
 * limits in the first place — hitting one anyway should slow down, not quit.
 */

import { eq, and, isNotNull } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { emailSends, emailEvents } from '../lib/db/schema';
import { config } from '../src/config';

const RESEND_API = 'https://api.resend.com/emails';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

type ResendListRow = { id: string; last_event?: string; created_at: string };

/** One paginated fetch, retried with backoff on 429. Never throws. */
async function fetchWithBackoff(url: string): Promise<Response | { error: string }> {
  const MAX_ATTEMPTS = 5;
  let delayMs = 1000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${config.email.resendApiKey}` } });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }

    if (res.status !== 429) return res;
    if (attempt === MAX_ATTEMPTS) return { error: 'rate limited after retries' };

    console.warn(`  429 rate limited — retrying in ${delayMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs *= 2;
  }
  return { error: 'unreachable' }; // satisfies the type checker; loop always returns above
}

/**
 * Walks the list endpoint newest-first, collecting `last_event` per id, up to
 * a page ceiling — mirrors getAccountSentToday's pagination shape in
 * src/lib/email.ts. Stops early once every id we care about has been seen so
 * we don't page through the whole account history for a small sync.
 */
async function listKnownEvents(wantedIds: Set<string>): Promise<Map<string, ResendListRow>> {
  const PAGE = 100; // Resend's documented maximum
  const MAX_PAGES = 50; // 5,000 messages — generous ceiling for one run
  const found = new Map<string, ResendListRow>();
  let after: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (found.size >= wantedIds.size) break; // nothing left to find

    const url = new URL(RESEND_API);
    url.searchParams.set('limit', String(PAGE));
    if (after) url.searchParams.set('after', after);

    const res = await fetchWithBackoff(url.toString());
    if ('error' in res) {
      console.warn(`  List page ${page} failed: ${res.error} — falling back to per-id lookups for the rest.`);
      break;
    }
    if (!res.ok) {
      console.warn(`  List page ${page} returned HTTP ${res.status} — falling back to per-id lookups for the rest.`);
      break;
    }

    const payload = (await res.json().catch(() => null)) as { data?: ResendListRow[] } | null;
    if (!payload || !Array.isArray(payload.data) || payload.data.length === 0) break;

    for (const row of payload.data) {
      if (wantedIds.has(row.id)) found.set(row.id, row);
    }

    if (payload.data.length < PAGE) break; // last page
    after = payload.data[payload.data.length - 1].id;
  }

  return found;
}

/** Fallback for ids the list walk didn't cover. One request each, on purpose — see the file header. */
async function getSingleEvent(id: string): Promise<ResendListRow | { error: string }> {
  const res = await fetchWithBackoff(`${RESEND_API}/${id}`);
  if ('error' in res) return res;
  if (!res.ok) return { error: `HTTP ${res.status}` };

  const payload = (await res.json().catch(() => null)) as ResendListRow | null;
  if (!payload) return { error: 'unreadable response body' };
  return payload;
}

async function main() {
  if (!config.email.resendApiKey) {
    console.error('Cannot sync — RESEND_API_KEY is not set.');
    process.exit(1);
  }

  const dryRun = has('dry-run');
  const limitFlag = arg('limit');
  const limit = limitFlag ? parseInt(limitFlag, 10) : undefined;
  if (limitFlag && (!Number.isFinite(limit) || (limit as number) <= 0)) {
    console.error(`--limit must be a positive integer, got "${limitFlag}"`);
    process.exit(1);
  }

  // Only rows we believe reached Resend. 'pending'/'failed' rows never got a
  // provider id, so there is nothing to ask Resend about.
  const rowsQuery = db
    .select({ id: emailSends.id, providerId: emailSends.providerId, userId: emailSends.userId, campaignId: emailSends.campaignId })
    .from(emailSends)
    .where(and(eq(emailSends.status, 'sent'), isNotNull(emailSends.providerId)))
    .orderBy(emailSends.sentAt);

  const rows = limit ? await rowsQuery.limit(limit) : await rowsQuery;

  if (rows.length === 0) {
    console.log('No sent email_sends rows with a provider id — nothing to sync.');
    return;
  }

  console.log(`Syncing ${rows.length} sent row(s) against Resend...${dryRun ? '  [DRY RUN]' : ''}`);

  const wantedIds = new Set(rows.map((r) => r.providerId as string));
  const fromList = await listKnownEvents(wantedIds);
  console.log(`  Found ${fromList.size}/${wantedIds.size} via the list endpoint; falling back per-id for the rest.`);

  let synced = 0;
  let skipped = 0;
  let errored = 0;

  for (const row of rows) {
    const providerId = row.providerId as string; // non-null by the query's WHERE clause

    let resendRow = fromList.get(providerId);
    if (!resendRow) {
      const single = await getSingleEvent(providerId);
      if ('error' in single) {
        console.warn(`  ✗ ${providerId}: ${single.error}`);
        errored++;
        continue;
      }
      resendRow = single;
    }

    const eventType = resendRow.last_event;
    if (!eventType) {
      skipped++; // Resend has no event for this id yet (e.g. still queued)
      continue;
    }

    if (dryRun) {
      console.log(`  would write: ${providerId} -> ${eventType}`);
      synced++;
      continue;
    }

    try {
      const result = await db
        .insert(emailEvents)
        .values({
          providerId,
          userId: row.userId,
          campaignId: row.campaignId,
          eventType,
          // The list/get API has no per-event timestamp, only `created_at`
          // (send time) — see email_events' doc comment on why this is a
          // deliberate, documented limitation rather than a bug. "Now" would
          // be equally wrong in a different way, so send time is used as the
          // best available anchor for when this state existed.
          occurredAt: new Date(resendRow.created_at),
          payload: resendRow,
        })
        .onConflictDoNothing({ target: [emailEvents.providerId, emailEvents.eventType] })
        .returning({ id: emailEvents.id });

      if (result.length > 0) synced++;
      else skipped++; // already recorded — the unique index did its job
    } catch (err) {
      console.warn(`  ✗ ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
      errored++;
    }
  }

  console.log(
    `\n${dryRun ? 'Dry run complete.' : 'Done.'} synced=${synced} skipped=${skipped} errored=${errored} (of ${rows.length} row(s) checked)`,
  );
  if (errored > 0) {
    console.log(`${errored} row(s) failed to sync — re-run the script to retry them; onConflictDoNothing makes re-running safe.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSync run failed:', err instanceof Error ? err.message : err);
    console.error('Rows already written are safe (idempotent upsert). Re-run to pick up where this left off.');
    process.exit(1);
  });
