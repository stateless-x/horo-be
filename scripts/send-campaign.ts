#!/usr/bin/env bun

/**
 * Send one campaign to users who have not received it, up to the daily cap.
 *
 * Usage:
 *   bun run scripts/send-campaign.ts --campaign 2026-09-15-relaunch --dry-run
 *   bun run scripts/send-campaign.ts --campaign 2026-09-15-relaunch --limit 3 --only me@example.com
 *   bun run scripts/send-campaign.ts --campaign 2026-09-15-relaunch
 *   bun run scripts/send-campaign.ts --status
 *
 * Flags:
 *   --campaign <id>  campaign file in content/campaigns/<id>.md (required to send)
 *   --dry-run        print recipients and the rendered email; write nothing, send nothing
 *   --limit <n>      send at most n (still bounded by the remaining daily cap)
 *   --only <email>   restrict to one address — use this for live test sends
 *   --status         print progress for every campaign and exit
 *   --requeue        reset this campaign's crash-stranded 'pending' rows (see below)
 *   --confirm <n>    approve sending to exactly n recipients (required to send)
 *   --no-unsubscribe omit the opt-out link and List-Unsubscribe header
 *
 * SHARED QUOTA
 * The Resend quota is per ACCOUNT, so your other projects spend it too. Before
 * each run this script asks Resend how many emails the account has actually
 * sent today (GET /emails) and sends only what is left. Nothing to configure
 * and nothing to estimate.
 *
 * If that number cannot be read, the run REFUSES rather than guessing — a guess
 * either wastes the allowance or eats another project's.
 *
 * A 429 mid-batch (another project spending the quota while we run) stops the
 * run cleanly: the in-flight claim is released and untouched recipients go out
 * next time.
 *
 * MANUAL APPROVAL
 * A live send never happens from --campaign alone. The script shows the batch
 * and exits, and you re-run with `--confirm <n>` where n is the recipient count
 * it printed. If the real count has changed since (someone signed up, someone
 * opted out), the numbers disagree and the run aborts rather than sending to a
 * set you did not actually review. That makes an unattended cron physically
 * unable to send — it has no way to supply a number it never saw.
 *
 * HOW "NEVER TWICE" IS GUARANTEED
 * Recipients are claimed by INSERTing a 'pending' row into email_sends, which
 * has UNIQUE(user_id, campaign_id). onConflictDoNothing().returning() gives
 * back only the rows this run actually claimed, and only those are sent. A
 * second run, a concurrent run, or a cron firing twice all lose the conflict
 * and send nothing. The claim happens BEFORE the API call, so a crash strands
 * the row as 'pending' rather than re-sending it.
 *
 * Stranded 'pending' rows are never retried automatically — that is the price
 * of the guarantee. `--requeue` clears them deliberately, and prints how many
 * it found so a systematic failure is visible rather than silently retried.
 */

import { sql, and, eq, gte, notInArray } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { user, emailSends } from '../lib/db/schema';
import { config } from '../src/config';
import { sendEmail, unsubscribeUrl, getAccountSentToday } from '../src/lib/email';
import { loadCampaign, listCampaignIds, listCampaigns, renderBody, toHtml, toText } from '../src/lib/campaigns';

/** Bangkok day boundary — the cap is "per calendar day" as the user sees it. */
function startOfBangkokDay(): Date {
  const now = new Date();
  const bangkokMs = now.getTime() + 7 * 60 * 60 * 1000;
  const dayStart = new Date(Math.floor(bangkokMs / 86400000) * 86400000);
  return new Date(dayStart.getTime() - 7 * 60 * 60 * 1000);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function printStatus() {
  const totalUsers = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(user)
    .where(eq(user.emailOptOut, false));

  const rows = await db
    .select({
      campaignId: emailSends.campaignId,
      status: emailSends.status,
      n: sql<number>`count(*)::int`,
    })
    .from(emailSends)
    .groupBy(emailSends.campaignId, emailSends.status);

  const sentToday = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailSends)
    .where(and(eq(emailSends.status, 'sent'), gte(emailSends.sentAt, startOfBangkokDay())));

  console.log(`\nEligible users (not opted out): ${totalUsers[0]?.n ?? 0}`);
  console.log(`Campaign emails sent today (Bangkok): ${sentToday[0]?.n ?? 0}`);

  // The account-wide number is the one that decides whether a send can proceed,
  // so --status reports it rather than only our own rows.
  const usage = await getAccountSentToday(startOfBangkokDay());
  if (usage.known) {
    console.log(
      `All projects today: ${usage.sentToday}/${config.email.dailyCap} · ` +
        `ส่งได้อีก ${Math.max(0, config.email.dailyCap - usage.sentToday)}\n`,
    );
  } else {
    console.log(`All projects today: unavailable (${usage.reason}) — sending is blocked\n`);
  }

  const all = listCampaigns();
  if (all.length === 0) {
    console.log('No campaign files in content/campaigns/');
    return;
  }

  console.log('Campaign                        sent  failed  pending  remaining');
  console.log('─'.repeat(70));
  for (const { id, name } of all) {
    const forCampaign = rows.filter((r) => r.campaignId === id);
    const count = (s: string) => forCampaign.find((r) => r.status === s)?.n ?? 0;
    const done = count('sent') + count('failed') + count('pending');
    const remaining = Math.max(0, (totalUsers[0]?.n ?? 0) - done);
    console.log(
      `${id.padEnd(30)}  ${String(count('sent')).padStart(4)}  ${String(count('failed')).padStart(6)}  ${String(count('pending')).padStart(7)}  ${String(remaining).padStart(9)}`,
    );
    if (name) console.log(`${' '.repeat(2)}↳ ${name}`);
  }
  console.log();
}

async function requeue(campaignId: string) {
  const stranded = await db
    .select({ id: emailSends.id })
    .from(emailSends)
    .where(and(eq(emailSends.campaignId, campaignId), eq(emailSends.status, 'pending')));

  if (stranded.length === 0) {
    console.log(`No stranded 'pending' rows for ${campaignId}.`);
    return;
  }

  await db.delete(emailSends).where(
    and(eq(emailSends.campaignId, campaignId), eq(emailSends.status, 'pending')),
  );
  console.log(
    `Cleared ${stranded.length} stranded 'pending' row(s) for ${campaignId}.\n` +
      `Those users are eligible again on the next run. If this number is large, a\n` +
      `send is crashing mid-batch — investigate before re-running.`,
  );
}

async function main() {
  if (has('status')) {
    await printStatus();
    return;
  }

  const campaignId = arg('campaign');
  if (!campaignId) {
    console.error('Missing --campaign <id>. Available:');
    for (const c of listCampaigns()) {
      console.error(`  ${c.id}${c.name ? `  — ${c.name}` : ''}`);
    }
    console.error('\nOr run with --status to see progress.');
    process.exit(1);
  }

  if (has('requeue')) {
    await requeue(campaignId);
    return;
  }

  const dryRun = has('dry-run');
  const campaign = loadCampaign(campaignId); // throws on malformed front-matter
  const only = arg('only');

  // Preflight: fail before claiming anything, so config problems never strand rows.
  if (!dryRun) {
    const missing = [
      !config.email.resendApiKey && 'RESEND_API_KEY',
      !config.email.from && 'EMAIL_FROM',
      // The campaign copy says "ตอบกลับอีเมลนี้ได้โดยตรง". Without this the
      // reply_to is silently omitted and replies go to the From mailbox, which
      // may not exist — a broken promise that is invisible until someone replies.
      !config.email.replyTo && 'EMAIL_REPLY_TO',
    ].filter(Boolean);
    if (missing.length > 0) {
      console.error(`Cannot send — missing: ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  // Unsubscribe is on unless --no-unsubscribe is passed (or no secret exists to
  // sign links with). Off means no footer and no List-Unsubscribe header, so
  // an unhappy recipient's only route is "Report spam" — which is what damages
  // the sending domain. Kept as an explicit flag rather than a silent default.
  const withUnsubscribe = !has('no-unsubscribe') && Boolean(config.email.unsubscribeSecret);
  if (!withUnsubscribe && !dryRun) {
    console.warn(
      has('no-unsubscribe')
        ? 'WARNING: --no-unsubscribe — no opt-out link or header. Recipients who want out can only report spam.'
        : 'WARNING: no EMAIL_UNSUBSCRIBE_SECRET/BETTER_AUTH_SECRET — sending without an opt-out link.',
    );
  }

  // Remaining daily budget.
  //
  // The quota is per ACCOUNT, so other sites on the same Resend key (Pawjai,
  // etc.) spend it too. Rather than guess their volume with a fixed reserve, we
  // ASK RESEND how many messages the whole account sent today and subtract
  // that. `ourSentToday` stays as the fallback for when the API cannot answer.
  const dayStart = startOfBangkokDay();

  // Ask Resend how many emails the whole account sent today — every site on the
  // key, not just ours. If that cannot be read we do NOT send: a guess here
  // either wastes the allowance or eats another project's.
  const usage = await getAccountSentToday(dayStart);

  if (!usage.known) {
    console.error(
      `Cannot read today's usage from Resend (${usage.reason}).\n` +
        `Not sending — the quota is shared with your other projects, so without\n` +
        `that number there is no safe amount to send. Try again in a moment.`,
    );
    process.exit(1);
  }

  const sentToday = usage.sentToday;
  let budget = Math.max(0, config.email.dailyCap - sentToday);

  console.log(`Quota:      ${sentToday}/${config.email.dailyCap} used today (all projects) · ส่งได้อีก ${budget}`);

  const limitFlag = arg('limit');
  if (limitFlag) budget = Math.min(budget, parseInt(limitFlag));

  if (budget <= 0) {
    console.log(`Daily cap reached. Nothing to do.`);
    return;
  }

  // Candidates: eligible users with no email_sends row for this campaign.
  // The NOT IN subquery is the readable form of the anti-join; the real
  // guarantee is the unique index below, so a race here is harmless.
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
        notInArray(user.id, alreadyHandled),
        only ? eq(user.email, only) : undefined,
      ),
    )
    .orderBy(user.createdAt) // oldest signups first — stable across runs
    .limit(budget);

  if (candidates.length === 0) {
    console.log(`Nothing to send: every eligible user already has "${campaignId}".`);
    return;
  }

  console.log(`Campaign:   ${campaignId}${campaign.name ? `  (${campaign.name})` : ''}`);
  console.log(`Subject:    ${campaign.subject}`);
  console.log(`From:       ${config.email.from || '(EMAIL_FROM not set)'}`);
  console.log(`Reply-To:   ${config.email.replyTo || '(none)'}`);
  console.log(`Recipients: ${candidates.length}${dryRun ? '  [DRY RUN]' : ''}\n`);

  if (dryRun) {
    for (const c of candidates.slice(0, 10)) {
      console.log(`  ${c.email}  (${c.name || c.fallbackName || 'no name'})`);
    }
    if (candidates.length > 10) console.log(`  ... and ${candidates.length - 10} more`);

    const sample = candidates[0];
    const name = sample.name || sample.fallbackName || 'คุณ';
    console.log('\n─── rendered text for first recipient ───\n');
    console.log(toText(renderBody(campaign.body, { name }), withUnsubscribe ? unsubscribeUrl(sample.id) : undefined));
    console.log('\n─── end ───');
    console.log('\nNothing was written or sent.');
    const onlyFlag = only ? ` --only ${only}` : '';
    console.log(`To send this batch:  bun run scripts/send-campaign.ts --campaign ${campaignId}${onlyFlag} --confirm ${candidates.length}`);
    return;
  }

  // THE APPROVAL GATE. Sending requires --confirm <n> matching the exact
  // recipient count computed above. No flag = show and exit; wrong number =
  // the set changed since you reviewed it, so abort instead of sending blind.
  const confirmFlag = arg('confirm');
  if (!confirmFlag) {
    for (const c of candidates.slice(0, 10)) {
      console.log(`  ${c.email}  (${c.name || c.fallbackName || 'no name'})`);
    }
    if (candidates.length > 10) console.log(`  ... and ${candidates.length - 10} more`);
    console.log('\nNot sent — approval required.');
    const onlyFlag = only ? ` --only ${only}` : '';
    console.log(`Review above, then run:  bun run scripts/send-campaign.ts --campaign ${campaignId}${onlyFlag} --confirm ${candidates.length}`);
    return;
  }

  if (parseInt(confirmFlag) !== candidates.length) {
    console.error(
      `\nAborted: you approved ${confirmFlag} recipient(s), but this batch now has ${candidates.length}.\n` +
        `The eligible set changed since you reviewed it (a new signup, an opt-out, or\n` +
        `another run). Nothing was sent. Re-check with --dry-run and confirm the new count.`,
    );
    process.exit(1);
  }

  let sent = 0;
  let failed = 0;
  let requeued = 0;
  let errored = 0;
  /** Set when the provider reports the account is out of quota mid-batch. */
  let quotaHit = false;

  for (const c of candidates) {
    // One recipient must never abort the batch. sendEmail already swallows its
    // own errors, but the db calls around it can throw (connection blip, pool
    // timeout) — without this, a hiccup at recipient 12 would leave the other
    // 88 unsent. Errors are counted and reported, never silently dropped.
    try {
      // THE CLAIM. Losing this conflict means another run already has this user.
      const claimed = await db
        .insert(emailSends)
        .values({ userId: c.id, campaignId, email: c.email, status: 'pending' })
        .onConflictDoNothing()
        .returning({ id: emailSends.id });

      if (claimed.length === 0) continue; // someone else owns this recipient

      const name = c.name || c.fallbackName || 'คุณ';
      const link = withUnsubscribe ? unsubscribeUrl(c.id) : undefined;
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
        console.log(`  ✓ ${c.email}`);
      } else if (/rate|quota|limit|429|too many/i.test(result.error) && result.retryable) {
        // Quota exhausted mid-batch — typically another site on the account
        // spending it while we ran. Release this claim and STOP: continuing
        // would fail every remaining send and pile up retryable rows.
        await db.delete(emailSends).where(eq(emailSends.id, claimed[0].id));
        requeued++;
        console.log(`  ↻ ${c.email} — ${result.error}`);
        console.warn(
          `\nStopped early: the Resend account hit its rate or quota limit.\n` +
            `Sent ${sent} this run. The rest are untouched and will go out on the next run.`,
        );
        quotaHit = true;
        break;
      } else if (result.retryable) {
        // Transient (network, 5xx, 429): Resend never accepted the message, so
        // releasing the claim cannot double-send. Deleting the row puts this
        // user back in the candidate pool for the next run automatically — one
        // bad address or a blip never blocks the rest of the batch.
        await db.delete(emailSends).where(eq(emailSends.id, claimed[0].id));
        requeued++;
        console.log(`  ↻ ${c.email} — ${result.error} (will retry next run)`);
      } else {
        // Terminal (bad address, unverified domain): keep the row so this
        // address is never mailed again for this campaign. Repeatedly retrying
        // hard bounces is what damages sending reputation.
        await db
          .update(emailSends)
          .set({ status: 'failed', error: result.error })
          .where(eq(emailSends.id, claimed[0].id));
        failed++;
        console.log(`  ✗ ${c.email} — ${result.error} (permanent, will not retry)`);
      }
    } catch (err) {
      // A throw here is the DB, not the send — the row may be stranded
      // 'pending'. Report it and keep going so the rest of the batch still
      // goes out; --status then --requeue surfaces and releases the stragglers.
      errored++;
      console.log(`  ! ${c.email} — ${err instanceof Error ? err.message : String(err)} (db error, batch continues)`);
    }

    // ~2/sec: Resend's default rate limit is 2 requests/second.
    await new Promise((r) => setTimeout(r, 550));
  }

  console.log(
    `\n${quotaHit ? 'Stopped at quota.' : 'Done.'} sent=${sent} failed=${failed} requeued=${requeued} errored=${errored}`,
  );
  if (errored > 0) {
    console.log(`${errored} recipient(s) hit a DB error and may be stranded 'pending' — run --status, then --requeue to release them.`);
  }
  if (requeued > 0) {
    console.log(`${requeued} transient failure(s) released — they are candidates again on the next run.`);
  }
  if (failed > 0) {
    console.log(`${failed} permanent failure(s) recorded and will NOT be retried (see --status).`);
  }
  console.log(`Run with --status to see remaining recipients.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nCampaign run failed:', err instanceof Error ? err.message : err);
    console.error('Any claimed-but-unsent rows are left as \'pending\' and will NOT be retried.');
    console.error('Inspect with --status, then --requeue if you want them re-queued.');
    process.exit(1);
  });
