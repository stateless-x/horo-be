#!/usr/bin/env bun
/**
 * Reset daily fortune for a user by email.
 * Usage: bun run scripts/reset-daily-fortune.ts <email>
 */
import { db } from '../src/lib/db';
import { user } from '../lib/db/schema/users';
import { birthProfiles } from '../lib/db/schema/profiles';
import { dailyReadings } from '../lib/db/schema/readings';
import { eq, and, sql } from 'drizzle-orm';

const email = process.argv[2];

if (!email) {
  console.error('Usage: bun run scripts/reset-daily-fortune.ts <email>');
  process.exit(1);
}

// Get today's date in YYYY-MM-DD format
const today = new Date().toISOString().split('T')[0];

console.log(`Looking for user: ${email}`);
console.log(`Date to reset: ${today}`);

// Find user by email
const [foundUser] = await db.select().from(user).where(eq(user.email, email));

if (!foundUser) {
  console.error(`User not found: ${email}`);
  process.exit(1);
}

console.log(`Found user: ${foundUser.id} (${foundUser.name})`);

// Find their birth profile
const [profile] = await db.select().from(birthProfiles).where(eq(birthProfiles.userId, foundUser.id));

if (!profile) {
  console.error(`No birth profile found for user: ${email}`);
  process.exit(1);
}

console.log(`Found profile: ${profile.id}`);

// Delete today's daily reading
const result = await db.delete(dailyReadings).where(
  and(
    eq(dailyReadings.profileId, profile.id),
    eq(dailyReadings.date, today)
  )
).returning();

if (result.length > 0) {
  console.log(`✅ Deleted ${result.length} daily reading(s) for ${today}`);
} else {
  console.log(`ℹ️  No daily reading found for ${today} - user will generate fresh on next visit`);
}

process.exit(0);
