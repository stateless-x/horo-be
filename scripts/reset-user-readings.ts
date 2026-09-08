#!/usr/bin/env bun
/**
 * Delete every generated reading for one user, so the next visit regenerates
 * from scratch. For testing a prompt or schema change against a real account
 * without clearing the whole table the way scripts/clear-narratives.ts does.
 *
 *   bun run scripts/reset-user-readings.ts <email>            # dry run, counts only
 *   bun run scripts/reset-user-readings.ts <email> --confirm  # actually deletes
 *
 * Dry run is the default on purpose: this points at whatever DATABASE_URL is
 * set, which in practice is production, and the rows it removes are LLM output
 * that cost money to make and cannot be recovered.
 *
 * Deletes: daily_readings, chart_narratives, compatibility — all scoped to the
 * user's birth_profiles rows.
 * Keeps: the account, the birth profile, and the derived bazi_charts /
 * thai_astrology_data, which are deterministic calculations rather than
 * generated prose. Wiping those would change nothing except force a recompute.
 *
 * Also busts the Redis keys that would otherwise serve the deleted narrative
 * straight back — a DB-only delete leaves the chart cached for up to 24h and
 * makes the reset look like it silently failed.
 */
import { db } from '../src/lib/db';
import { user } from '../lib/db/schema/users';
import { birthProfiles } from '../lib/db/schema/profiles';
import { dailyReadings, chartNarratives, compatibility } from '../lib/db/schema/readings';
import { invalidateCache } from '../src/lib/redis';
import { eq, inArray } from 'drizzle-orm';

const email = process.argv[2];
const confirmed = process.argv.includes('--confirm');

if (!email) {
  console.error('Usage: bun run scripts/reset-user-readings.ts <email> [--confirm]');
  process.exit(1);
}

const [account] = await db.select().from(user).where(eq(user.email, email));

if (!account) {
  console.error(`User not found: ${email}`);
  process.exit(1);
}

const profiles = await db
  .select({ id: birthProfiles.id })
  .from(birthProfiles)
  .where(eq(birthProfiles.userId, account.id));

const profileIds = profiles.map((row) => row.id);

console.log(`User:     ${email} (${account.id})`);
console.log(`Profiles: ${profileIds.length}`);

if (profileIds.length === 0) {
  console.log('No birth profile, so no readings exist. Nothing to do.');
  process.exit(0);
}

const [dailyRows, narrativeRows, compatRows] = await Promise.all([
  db.select({ id: dailyReadings.id }).from(dailyReadings).where(inArray(dailyReadings.profileId, profileIds)),
  db.select({ id: chartNarratives.id }).from(chartNarratives).where(inArray(chartNarratives.profileId, profileIds)),
  db.select({ id: compatibility.id }).from(compatibility).where(inArray(compatibility.profileAId, profileIds)),
]);

console.log(`  daily_readings:   ${dailyRows.length}`);
console.log(`  chart_narratives: ${narrativeRows.length}`);
console.log(`  compatibility:    ${compatRows.length}`);

if (!confirmed) {
  console.log('\nDry run. Nothing was deleted. Re-run with --confirm to delete these rows.');
  process.exit(0);
}

await db.delete(dailyReadings).where(inArray(dailyReadings.profileId, profileIds));
await db.delete(chartNarratives).where(inArray(chartNarratives.profileId, profileIds));
await db.delete(compatibility).where(inArray(compatibility.profileAId, profileIds));

// Without this the API keeps serving the deleted chart from Redis for up to 24h.
await invalidateCache(
  `profile:${account.id}`,
  ...profileIds.map((id) => `chart:narrative:${id}`),
  ...compatRows.map((row) => `compat:${account.id}:${row.id}`),
);

console.log('\n✅ Deleted. Next visit regenerates.');
process.exit(0);
