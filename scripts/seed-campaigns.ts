#!/usr/bin/env bun

/**
 * Copy every content/campaigns/*.md file into the campaigns table.
 *
 * Usage:
 *   bun run scripts/seed-campaigns.ts --dry-run
 *   bun run scripts/seed-campaigns.ts
 *
 * Flags:
 *   --dry-run   print what would be inserted; write nothing
 *
 * onConflictDoNothing() on the primary key means this is safe to re-run any
 * time without clobbering an edit an operator already made in the admin UI —
 * but it is a MANUAL step, run by hand after a deploy that adds new campaign
 * files. It is deliberately NOT wired into railway.toml or the Dockerfile CMD
 * the way `drizzle-kit push` is: unlike a schema push, seeding writes actual
 * campaign content, and an operator should choose when a newly-committed
 * draft becomes send-able rather than have every deploy silently insert it.
 * A disk file is
 * a SEED, not a live source once its row exists: after the first successful
 * seed, editing the .md file on disk does nothing (src/lib/campaigns.ts only
 * reads it when no DB row exists yet), and this script will never overwrite
 * that row to "fix" the drift back. That is deliberate — the DB row is
 * authoritative once created; re-running the seed must never undo an
 * operator's edit.
 */

import { listCampaignIds, loadCampaign } from '../src/lib/campaigns';
import { db } from '../src/lib/db';
import { campaigns } from '../lib/db/schema';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const ids = listCampaignIds();
  if (ids.length === 0) {
    console.log('No campaign files in content/campaigns/ — nothing to seed.');
    return;
  }

  console.log(`Found ${ids.length} campaign file(s) on disk.${dryRun ? '  [DRY RUN]' : ''}\n`);

  let inserted = 0;
  let skipped = 0;

  for (const id of ids) {
    const campaign = loadCampaign(id); // throws on malformed front-matter — fail loud, not partial

    if (dryRun) {
      console.log(`  would insert: ${id}${campaign.name ? `  — ${campaign.name}` : ''}`);
      continue;
    }

    const result = await db
      .insert(campaigns)
      .values({
        id: campaign.id,
        name: campaign.name ?? null,
        subject: campaign.subject,
        body: campaign.body,
      })
      .onConflictDoNothing({ target: campaigns.id })
      .returning({ id: campaigns.id });

    if (result.length > 0) {
      inserted++;
      console.log(`  ✓ inserted: ${id}`);
    } else {
      skipped++;
      console.log(`  · already in DB, left untouched: ${id}`);
    }
  }

  if (dryRun) {
    console.log(`\nNothing written. ${ids.length} file(s) would be considered.`);
    return;
  }

  console.log(`\nDone. inserted=${inserted} skipped=${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSeed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
