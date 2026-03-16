/**
 * One-time migration: Fix day pillar branch index
 *
 * The DAY_REFERENCE.branchIndex was incorrectly set to 0 (子 zi)
 * when it should have been 8 (申 shen). This caused ALL users'
 * day pillar branches (animal signs) to be wrong by 8 positions.
 *
 * The day STEM was always correct, so the primary element (ธาตุ) was unaffected.
 * However, all LLM-generated content referenced wrong animal signs/branches,
 * so we must clear everything that was generated from the wrong data.
 *
 * This migration:
 * 1. Recalculates bazi_charts for all birth profiles
 * 2. Deletes all chart_narratives (forces LLM regeneration)
 * 3. Deletes all daily_readings (generated with wrong pillar context)
 * 4. Deletes all compatibility records (wrong branch data baked into analysis)
 * 5. Clears all related Redis caches
 * 6. Marks itself as complete so it won't run again
 *
 * Safe to run multiple times — checks a Redis flag and skips if already done.
 * Remove this import from index.ts after confirming it ran successfully.
 */

import { db } from '../lib/db';
import { birthProfiles, baziCharts, chartNarratives, dailyReadings, compatibility } from '../../lib/db';
import { calculateBazi } from '../../lib/astrology';
import { getRedisClient } from '../lib/redis';

const MIGRATION_KEY = 'migration:fix-day-branch:done';

export async function runFixDayBranchMigration(): Promise<void> {
  // Check if already run via Redis flag
  const redis = getRedisClient();
  if (redis) {
    try {
      const done = await redis.get(MIGRATION_KEY);
      if (done === '1') {
        console.log('[Migration] fix-day-branch: Already completed, skipping');
        return;
      }
    } catch {
      // Redis unavailable, proceed with migration (idempotent anyway)
    }
  }

  console.log('[Migration] fix-day-branch: Starting...');

  try {
    // 1. Fetch all birth profiles
    const profiles = await db
      .select({
        id: birthProfiles.id,
        birthDate: birthProfiles.birthDate,
        birthHour: birthProfiles.birthHour,
        gender: birthProfiles.gender,
      })
      .from(birthProfiles);

    console.log(`[Migration] fix-day-branch: Found ${profiles.length} profiles to recalculate`);

    // 2. Recalculate and upsert bazi charts
    let updated = 0;
    for (const profile of profiles) {
      try {
        const baziChart = calculateBazi(
          profile.birthDate,
          profile.birthHour ?? undefined,
          profile.gender as 'male' | 'female'
        );

        const baziData = {
          yearPillar: JSON.stringify(baziChart.yearPillar),
          monthPillar: JSON.stringify(baziChart.monthPillar),
          dayPillar: JSON.stringify(baziChart.dayPillar),
          hourPillar: baziChart.hourPillar ? JSON.stringify(baziChart.hourPillar) : null,
          dayMaster: baziChart.dayMaster,
          primaryElement: baziChart.element,
          elementStrength: JSON.stringify({}),
        };

        await db
          .insert(baziCharts)
          .values({ profileId: profile.id, ...baziData })
          .onConflictDoUpdate({
            target: baziCharts.profileId,
            set: baziData,
          });

        updated++;
      } catch (err) {
        console.error(`[Migration] fix-day-branch: Failed to update profile ${profile.id}:`, err);
      }
    }

    console.log(`[Migration] fix-day-branch: Updated ${updated}/${profiles.length} bazi charts`);

    // 3. Delete all chart narratives (will regenerate on next visit)
    await db.delete(chartNarratives);
    console.log('[Migration] fix-day-branch: Cleared all chart narratives');

    // 4. Delete all daily readings (generated with wrong branch context)
    await db.delete(dailyReadings);
    console.log('[Migration] fix-day-branch: Cleared all daily readings');

    // 5. Delete all compatibility records (wrong branch data in analysis)
    await db.delete(compatibility);
    console.log('[Migration] fix-day-branch: Cleared all compatibility records');

    // 6. Flush related Redis caches
    if (redis) {
      try {
        const patterns = ['chart:narrative:*', 'daily:*', 'compat:*', 'teaser:*'];
        let totalCleared = 0;
        for (const pattern of patterns) {
          const keys = await redis.keys(pattern);
          if (keys.length > 0) {
            await redis.del(...keys);
            totalCleared += keys.length;
          }
        }
        console.log(`[Migration] fix-day-branch: Cleared ${totalCleared} Redis cache keys`);
      } catch (err) {
        console.error('[Migration] fix-day-branch: Redis cache clear failed:', err);
      }
    }

    // 7. Mark as done (90-day TTL — remove this code well before then)
    if (redis) {
      try {
        await redis.set(MIGRATION_KEY, '1', 'EX', 90 * 24 * 60 * 60);
      } catch {
        // Not critical
      }
    }

    console.log('[Migration] fix-day-branch: Complete!');
  } catch (error) {
    console.error('[Migration] fix-day-branch: FAILED:', error);
    // Don't throw — let the server start even if migration fails
  }
}
