#!/usr/bin/env bun

/**
 * Migration Script: Fix Birth Date Off-by-One Error
 *
 * This script fixes birth dates for users who completed onboarding before the
 * timezone fix was deployed. Due to incorrect timezone handling, their birth
 * dates were stored one day earlier than they should be.
 *
 * Root Cause:
 * - Frontend created dates in local timezone: new Date(1994, 10, 26)
 * - This became 1994-11-25T17:00:00.000Z in ISO format (one day earlier in UTC)
 * - Database stored the wrong date
 *
 * Fix:
 * - Identify affected users (birthDate timestamps where time != 00:00:00.000Z)
 * - Add 1 day to their birthDate
 * - Clear their cached chart data to trigger regeneration
 *
 * Usage:
 *   bun run scripts/migrate-birth-dates.ts --dry-run  # Preview changes
 *   bun run scripts/migrate-birth-dates.ts            # Execute migration
 */

import { db } from '../src/lib/db';
import { user, birthProfiles, chartNarratives } from '../lib/db/schema';
import { eq, sql } from 'drizzle-orm';

const DRY_RUN = process.argv.includes('--dry-run');

async function migrateBirthDates() {
  console.log('🔍 Migration: Fix Birth Date Off-by-One Error');
  console.log(`Mode: ${DRY_RUN ? '🔎 DRY RUN (no changes)' : '✍️  LIVE (will modify data)'}\n`);

  try {
    // Find affected profiles
    // Affected profiles have birthDate timestamps where the time component is NOT 00:00:00.000Z
    // This indicates they were created with the buggy timezone code
    const affectedProfiles = await db
      .select({
        userId: birthProfiles.userId,
        name: user.name,
        displayName: user.displayName,
        birthDate: birthProfiles.birthDate,
      })
      .from(birthProfiles)
      .innerJoin(user, eq(birthProfiles.userId, user.id))
      .where(
        sql`EXTRACT(HOUR FROM ${birthProfiles.birthDate}) != 0
            OR EXTRACT(MINUTE FROM ${birthProfiles.birthDate}) != 0
            OR EXTRACT(SECOND FROM ${birthProfiles.birthDate}) != 0`
      );

    if (affectedProfiles.length === 0) {
      console.log('✅ No affected profiles found. All birth dates are correct!');
      return;
    }

    console.log(`Found ${affectedProfiles.length} affected profile(s):\n`);

    // Display affected profiles
    for (const p of affectedProfiles) {
      const currentDate = new Date(p.birthDate);
      const fixedDate = new Date(currentDate);
      fixedDate.setUTCDate(fixedDate.getUTCDate() + 1);
      fixedDate.setUTCHours(0, 0, 0, 0);

      console.log(`📝 User: ${p.displayName || p.name} (ID: ${p.userId})`);
      console.log(`   Current: ${currentDate.toISOString()} (${currentDate.getUTCFullYear()}-${String(currentDate.getUTCMonth() + 1).padStart(2, '0')}-${String(currentDate.getUTCDate()).padStart(2, '0')})`);
      console.log(`   Fixed:   ${fixedDate.toISOString()} (${fixedDate.getUTCFullYear()}-${String(fixedDate.getUTCMonth() + 1).padStart(2, '0')}-${String(fixedDate.getUTCDate()).padStart(2, '0')})`);
      console.log('');
    }

    if (DRY_RUN) {
      console.log('🔎 DRY RUN - No changes made. Run without --dry-run to execute migration.');
      return;
    }

    // Confirm before proceeding
    console.log('\n⚠️  WARNING: This will modify user data!');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    let successCount = 0;
    let errorCount = 0;

    // Execute migration
    for (const p of affectedProfiles) {
      try {
        const currentDate = new Date(p.birthDate);
        const fixedDate = new Date(currentDate);
        fixedDate.setUTCDate(fixedDate.getUTCDate() + 1);
        fixedDate.setUTCHours(0, 0, 0, 0);

        // Update birthProfile birthDate
        await db
          .update(birthProfiles)
          .set({
            birthDate: fixedDate,
            updatedAt: new Date(),
          })
          .where(eq(birthProfiles.userId, p.userId));

        // Clear cached chart narratives to force regeneration
        await db
          .delete(chartNarratives)
          .where(eq(chartNarratives.userId, p.userId));

        console.log(`✅ Migrated user ${p.userId} (${p.displayName || p.name})`);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to migrate user ${p.userId}:`, error);
        errorCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);
    console.log(`   📝 Total: ${affectedProfiles.length}`);

    if (successCount > 0) {
      console.log('\n🎉 Migration complete! Users will see correct birth dates on next login.');
      console.log('   Chart data has been cleared and will be regenerated automatically.');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateBirthDates()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
