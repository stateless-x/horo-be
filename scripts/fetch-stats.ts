#!/usr/bin/env bun

/**
 * Stats Script: Fetch Dashboard Data for stats.html
 *
 * Queries all metrics needed to update the Horo BI dashboard.
 * Outputs JSON to stdout and writes stats-data.json to project root.
 *
 * Usage:
 *   bun run scripts/fetch-stats.ts
 */

import { db } from '../src/lib/db';
import { user, account } from '../lib/db/schema/users';
import { birthProfiles, baziCharts } from '../lib/db/schema/profiles';
import { dailyReadings, chartNarratives, compatibility } from '../lib/db/schema/readings';
import { surfaceViews, productEvents } from '../lib/db/schema/analytics';
import { sql, count, eq, and, isNotNull } from 'drizzle-orm';
import { TRACKED_EVENT_NAMES } from '../lib/shared/types/analytics';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function fetchStats() {
  console.error('📊 Fetching Horo dashboard stats...\n');

  // ── 1. Total users ────────────────────────────────────────────────────────
  const [{ totalUsers }] = await db
    .select({ totalUsers: count() })
    .from(user);

  // ── 2. Birth profiles created ─────────────────────────────────────────────
  const [{ totalProfiles }] = await db
    .select({ totalProfiles: count() })
    .from(birthProfiles);

  // ── 3. Onboarding completed ───────────────────────────────────────────────
  const [{ onboardingCompleted }] = await db
    .select({ onboardingCompleted: count() })
    .from(user)
    .where(eq(user.onboardingCompleted, true));

  // ── 4. Chart narratives ───────────────────────────────────────────────────
  const [{ totalNarratives }] = await db
    .select({ totalNarratives: count() })
    .from(chartNarratives);

  // ── 5. Compatibility checks ───────────────────────────────────────────────
  const [{ totalCompatibility }] = await db
    .select({ totalCompatibility: count() })
    .from(compatibility);

  // ── 6. Daily readings ─────────────────────────────────────────────────────
  const [{ totalDailyReadings }] = await db
    .select({ totalDailyReadings: count() })
    .from(dailyReadings);

  // ── 7. Daily signups (all time, grouped by date) ──────────────────────────
  const dailySignups = await db
    .select({
      date: sql<string>`DATE("createdAt")`.as('date'),
      count: count(),
    })
    .from(user)
    .groupBy(sql`DATE("createdAt")`)
    .orderBy(sql`DATE("createdAt")`);

  // ── 8. Find peak signup day ───────────────────────────────────────────────
  const peakDay = dailySignups.reduce((best, d) => d.count > best.count ? d : best, dailySignups[0]);

  // ── 9. Hourly signups on peak day ─────────────────────────────────────────
  const hourlySignups = await db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC')`.as('hour'),
      count: count(),
    })
    .from(user)
    .where(sql`DATE("createdAt") = ${peakDay.date}`)
    .groupBy(sql`EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC')`)
    .orderBy(sql`EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC')`);

  // ── 10. Gender split ──────────────────────────────────────────────────────
  const genderSplit = await db
    .select({
      gender: birthProfiles.gender,
      count: count(),
    })
    .from(birthProfiles)
    .groupBy(birthProfiles.gender);

  // ── 11. Auth provider × gender ────────────────────────────────────────────
  const authGender = await db
    .select({
      providerId: account.providerId,
      gender: birthProfiles.gender,
      count: count(),
    })
    .from(account)
    .innerJoin(birthProfiles, eq(account.userId, birthProfiles.userId))
    .groupBy(account.providerId, birthProfiles.gender)
    .orderBy(account.providerId, birthProfiles.gender);

  // ── 12. Birth year distribution ───────────────────────────────────────────
  const birthYearDist = await db
    .select({
      year: sql<number>`EXTRACT(YEAR FROM birth_date AT TIME ZONE 'UTC')`.as('year'),
      count: count(),
    })
    .from(birthProfiles)
    .groupBy(sql`EXTRACT(YEAR FROM birth_date AT TIME ZONE 'UTC')`)
    .orderBy(sql`EXTRACT(YEAR FROM birth_date AT TIME ZONE 'UTC')`);

  // ── 13. Birth day of week (0=Sun, 1=Mon ... 6=Sat) ───────────────────────
  const birthDow = await db
    .select({
      dow: sql<number>`EXTRACT(DOW FROM birth_date AT TIME ZONE 'UTC')`.as('dow'),
      count: count(),
    })
    .from(birthProfiles)
    .groupBy(sql`EXTRACT(DOW FROM birth_date AT TIME ZONE 'UTC')`)
    .orderBy(sql`EXTRACT(DOW FROM birth_date AT TIME ZONE 'UTC')`);

  // ── 14. Birth time period ─────────────────────────────────────────────────
  const birthTimePeriod = await db
    .select({
      period: birthProfiles.birthTimePeriod,
      count: count(),
    })
    .from(birthProfiles)
    .groupBy(birthProfiles.birthTimePeriod)
    .orderBy(sql`COUNT(*) DESC`);

  // ── 15. MBTI distribution ─────────────────────────────────────────────────
  const mbtiDist = await db
    .select({
      mbti: birthProfiles.mbtiType,
      count: count(),
    })
    .from(birthProfiles)
    .where(isNotNull(birthProfiles.mbtiType))
    .groupBy(birthProfiles.mbtiType)
    .orderBy(sql`COUNT(*) DESC`);

  // ── 16. MBTI by gender ────────────────────────────────────────────────────
  const mbtiByGender = await db
    .select({
      mbti: birthProfiles.mbtiType,
      gender: birthProfiles.gender,
      count: count(),
    })
    .from(birthProfiles)
    .where(isNotNull(birthProfiles.mbtiType))
    .groupBy(birthProfiles.mbtiType, birthProfiles.gender)
    .orderBy(sql`COUNT(*) DESC`);

  // ── 17. Generation breakdown ──────────────────────────────────────────────
  // Gen Z: 1997-2004, Millennial Late: 1990-1996, Gen Alpha/Z: 2005+,
  // Millennial Early: 1981-1989, Gen X & older: ≤1980
  const genBreakdown = await db
    .select({
      year: sql<number>`EXTRACT(YEAR FROM birth_date AT TIME ZONE 'UTC')`.as('year'),
      count: count(),
    })
    .from(birthProfiles)
    .groupBy(sql`EXTRACT(YEAR FROM birth_date AT TIME ZONE 'UTC')`);

  // ── 18. Surface views: which dashboard tab users actually open ───────────
  // uniqueUsers = distinct people who opened the surface at least once.
  // viewDays = total (user, day) pairs, i.e. how many days of use it drove.
  const surfaceTotals = await db
    .select({
      surface: surfaceViews.surface,
      uniqueUsers: sql<number>`COUNT(DISTINCT ${surfaceViews.userId})`.as('unique_users'),
      viewDays: count(),
    })
    .from(surfaceViews)
    .groupBy(surfaceViews.surface);

  // ── 19. Surface views by MBTI ────────────────────────────────────────────
  // Left join: a viewer without a birth profile (or without an MBTI) still
  // counts, under the 'unknown' bucket, so the totals here reconcile with #18.
  // Assumes one birth profile per user, which the profile-save path upserts on
  // (fortune/routes.ts) — there is no DB unique constraint enforcing it.
  const surfaceByMbti = await db
    .select({
      surface: surfaceViews.surface,
      mbti: birthProfiles.mbtiType,
      uniqueUsers: sql<number>`COUNT(DISTINCT ${surfaceViews.userId})`.as('unique_users'),
      viewDays: count(),
    })
    .from(surfaceViews)
    .leftJoin(birthProfiles, eq(surfaceViews.userId, birthProfiles.userId))
    .groupBy(surfaceViews.surface, birthProfiles.mbtiType);

  // ── 20. Product events: the generic event stream ──────────────────────────
  // NOTE: 'surface_viewed' in product_events supersedes surface_views (#18/#19)
  // for new data; the older table is frozen and kept for history.
  const eventTotals = await db
    .select({
      event: productEvents.event,
      count: count(),
      uniqueUsers: sql<number>`COUNT(DISTINCT ${productEvents.userId})`.as('unique_users'),
    })
    .from(productEvents)
    .groupBy(productEvents.event);

  // ── 21. Category opens: which reading areas users actually expand ─────────
  // openDays = (user, surface, category, day) rows, since the event dedups per
  // Bangkok day — so this is "days of interest", not raw taps.
  const categoryOpens = await db
    .select({
      surface: productEvents.surface,
      category: productEvents.category,
      uniqueUsers: sql<number>`COUNT(DISTINCT ${productEvents.userId})`.as('unique_users'),
      openDays: count(),
    })
    .from(productEvents)
    .where(eq(productEvents.event, 'category_opened'))
    .groupBy(productEvents.surface, productEvents.category);

  // ── 22. Tab opens on the fortune surface ─────────────────────────────────
  const tabOpens = await db
    .select({
      tab: productEvents.detail,
      uniqueUsers: sql<number>`COUNT(DISTINCT ${productEvents.userId})`.as('unique_users'),
      openDays: count(),
    })
    .from(productEvents)
    .where(eq(productEvents.event, 'tab_opened'))
    .groupBy(productEvents.detail);

  // ── 23. Compatibility checks by relationship type ────────────────────────
  // Not deduped, so count is every check performed.
  const compatibilityByType = await db
    .select({
      relationshipType: productEvents.detail,
      count: count(),
      uniqueUsers: sql<number>`COUNT(DISTINCT ${productEvents.userId})`.as('unique_users'),
    })
    .from(productEvents)
    .where(eq(productEvents.event, 'compatibility_checked'))
    .groupBy(productEvents.detail);

  // ── 24. Shares by surface ────────────────────────────────────────────────
  const sharesBySurface = await db
    .select({
      surface: productEvents.surface,
      count: count(),
      uniqueUsers: sql<number>`COUNT(DISTINCT ${productEvents.userId})`.as('unique_users'),
    })
    .from(productEvents)
    .where(eq(productEvents.event, 'reading_shared'))
    .groupBy(productEvents.surface);

  // ── 25. Surface views + category opens by MBTI ───────────────────────────
  // Same left-join shape as #19: a user without a birth profile still counts,
  // under the 'unknown' bucket, so totals reconcile with #20/#21.
  const eventSurfaceByMbti = await db
    .select({
      surface: productEvents.surface,
      mbti: birthProfiles.mbtiType,
      uniqueUsers: sql<number>`COUNT(DISTINCT ${productEvents.userId})`.as('unique_users'),
      viewDays: count(),
    })
    .from(productEvents)
    .leftJoin(birthProfiles, eq(productEvents.userId, birthProfiles.userId))
    .where(eq(productEvents.event, 'surface_viewed'))
    .groupBy(productEvents.surface, birthProfiles.mbtiType);

  const eventCategoryByMbti = await db
    .select({
      surface: productEvents.surface,
      category: productEvents.category,
      mbti: birthProfiles.mbtiType,
      uniqueUsers: sql<number>`COUNT(DISTINCT ${productEvents.userId})`.as('unique_users'),
      openDays: count(),
    })
    .from(productEvents)
    .leftJoin(birthProfiles, eq(productEvents.userId, birthProfiles.userId))
    .where(eq(productEvents.event, 'category_opened'))
    .groupBy(productEvents.surface, productEvents.category, birthProfiles.mbtiType);

  // ── Build output ──────────────────────────────────────────────────────────
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Normalise daily signups into { date, count } sorted
  const signupsTimeline = dailySignups.map(d => ({ date: d.date, count: Number(d.count) }));

  // Hourly: fill missing hours 0-23 with 0
  const hourlyMap: Record<number, number> = {};
  for (const h of hourlySignups) hourlyMap[Number(h.hour)] = Number(h.count);
  const hourlyFull = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: hourlyMap[i] ?? 0 }));

  // Gender map
  const genderMap: Record<string, number> = {};
  for (const g of genderSplit) genderMap[g.gender ?? 'unknown'] = Number(g.count);
  const femaleCount = genderMap['female'] ?? 0;
  const maleCount = genderMap['male'] ?? 0;

  // Auth × gender
  const authGenderMap: Record<string, Record<string, number>> = {};
  for (const ag of authGender) {
    const provider = ag.providerId ?? 'unknown';
    const gender = ag.gender ?? 'unknown';
    if (!authGenderMap[provider]) authGenderMap[provider] = {};
    authGenderMap[provider][gender] = Number(ag.count);
  }

  // Birth DOW: 0=Sun…6=Sat → array [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
  const dowMap: Record<number, number> = {};
  for (const d of birthDow) dowMap[Number(d.dow)] = Number(d.count);
  const dowArray = Array.from({ length: 7 }, (_, i) => dowMap[i] ?? 0);

  // Birth time period — sorted by count desc
  const timePeriodData = birthTimePeriod.map(t => ({ period: t.period ?? 'ไม่ทราบ', count: Number(t.count) }));

  // MBTI full list (all 16, 0 if missing)
  const mbtiOrder = ['INFP','INFJ','ENFP','INTP','INTJ','ENFJ','ISFJ','ISFP','ENTJ','ISTJ','ISTP','ENTP','ESFJ','ESFP','ESTJ','ESTP'];
  const mbtiMap: Record<string, number> = {};
  for (const m of mbtiDist) mbtiMap[m.mbti ?? ''] = Number(m.count);
  const mbtiArray = mbtiOrder.map(k => mbtiMap[k] ?? 0);

  // MBTI top5 by gender
  const mbtiFemale = mbtiByGender.filter(m => m.gender === 'female').slice(0, 5).map(m => ({ mbti: m.mbti ?? '', count: Number(m.count) }));
  const mbtiMale = mbtiByGender.filter(m => m.gender === 'male').slice(0, 5).map(m => ({ mbti: m.mbti ?? '', count: Number(m.count) }));

  // Birth year dist
  const birthYearArray = birthYearDist.map(b => ({ year: Number(b.year), count: Number(b.count) }));

  // Generation counts
  let genZ = 0, milLate = 0, genAlphaZ = 0, milEarly = 0, genXOlder = 0;
  for (const g of genBreakdown) {
    const y = Number(g.year);
    const c = Number(g.count);
    if (y >= 2005) genAlphaZ += c;
    else if (y >= 1997) genZ += c;
    else if (y >= 1990) milLate += c;
    else if (y >= 1981) milEarly += c;
    else genXOlder += c;
  }

  // Temperament groups
  const temperamentMap: Record<string, number> = { 'IN': 0, 'EN': 0, 'IS': 0, 'ES': 0 };
  for (const m of mbtiDist) {
    const key = (m.mbti ?? '').slice(0, 2);
    if (temperamentMap[key] !== undefined) temperamentMap[key] += Number(m.count);
  }

  // Surface views → { today: {uniqueUsers, viewDays}, fortune: {...} }
  const emptySurface = () => ({ uniqueUsers: 0, viewDays: 0 });
  const surfaceTotalsMap: Record<string, { uniqueUsers: number; viewDays: number }> = {
    today: emptySurface(),
    fortune: emptySurface(),
  };
  for (const row of surfaceTotals) {
    surfaceTotalsMap[row.surface] = {
      uniqueUsers: Number(row.uniqueUsers),
      viewDays: Number(row.viewDays),
    };
  }

  // By MBTI: every one of the 16 types plus an 'unknown' bucket, so the chart
  // has a stable x-axis even before a type has any views.
  const surfaceMbtiMap: Record<string, { today: { uniqueUsers: number; viewDays: number }; fortune: { uniqueUsers: number; viewDays: number } }> = {};
  for (const key of [...mbtiOrder, 'unknown']) {
    surfaceMbtiMap[key] = { today: emptySurface(), fortune: emptySurface() };
  }
  for (const row of surfaceByMbti) {
    const key = row.mbti ?? 'unknown';
    const bucket = surfaceMbtiMap[key];
    if (!bucket) continue; // ignore an MBTI value outside the known 16
    if (row.surface !== 'today' && row.surface !== 'fortune') continue;
    bucket[row.surface] = {
      uniqueUsers: Number(row.uniqueUsers),
      viewDays: Number(row.viewDays),
    };
  }
  const surfaceMbtiArray = [...mbtiOrder, 'unknown'].map((mbti) => ({
    mbti,
    today: surfaceMbtiMap[mbti].today,
    fortune: surfaceMbtiMap[mbti].fortune,
  }));

  // Product events → normalised, numeric (pg returns COUNT as a string).
  const eventTotalsMap: Record<string, { count: number; uniqueUsers: number }> = {};
  for (const key of TRACKED_EVENT_NAMES) eventTotalsMap[key] = { count: 0, uniqueUsers: 0 };
  for (const row of eventTotals) {
    eventTotalsMap[row.event] = { count: Number(row.count), uniqueUsers: Number(row.uniqueUsers) };
  }

  const categoryOpensArray = categoryOpens.map((row) => ({
    surface: row.surface ?? 'unknown',
    category: row.category ?? 'unknown',
    uniqueUsers: Number(row.uniqueUsers),
    openDays: Number(row.openDays),
  }));

  const tabOpensArray = tabOpens.map((row) => ({
    tab: row.tab ?? 'unknown',
    uniqueUsers: Number(row.uniqueUsers),
    openDays: Number(row.openDays),
  }));

  const compatibilityByTypeArray = compatibilityByType.map((row) => ({
    relationshipType: row.relationshipType ?? 'unknown',
    count: Number(row.count),
    uniqueUsers: Number(row.uniqueUsers),
  }));

  const sharesBySurfaceArray = sharesBySurface.map((row) => ({
    surface: row.surface ?? 'unknown',
    count: Number(row.count),
    uniqueUsers: Number(row.uniqueUsers),
  }));

  // By MBTI: stable x-axis over all 16 types plus 'unknown', same as #19.
  const mbtiBuckets = [...mbtiOrder, 'unknown'];

  const eventSurfaceMbtiArray = mbtiBuckets.map((mbti) => ({
    mbti,
    surfaces: eventSurfaceByMbti
      .filter((row) => (row.mbti ?? 'unknown') === mbti)
      .map((row) => ({
        surface: row.surface ?? 'unknown',
        uniqueUsers: Number(row.uniqueUsers),
        viewDays: Number(row.viewDays),
      })),
  }));

  const eventCategoryMbtiArray = mbtiBuckets.map((mbti) => ({
    mbti,
    categories: eventCategoryByMbti
      .filter((row) => (row.mbti ?? 'unknown') === mbti)
      .map((row) => ({
        surface: row.surface ?? 'unknown',
        category: row.category ?? 'unknown',
        uniqueUsers: Number(row.uniqueUsers),
        openDays: Number(row.openDays),
      })),
  }));

  const onboardingRate = totalUsers > 0 ? ((Number(onboardingCompleted) / Number(totalUsers)) * 100).toFixed(1) : '0.0';
  const profileRate = totalUsers > 0 ? ((Number(totalProfiles) / Number(totalUsers)) * 100).toFixed(1) : '0.0';
  const dropOff = Number(totalUsers) - Number(onboardingCompleted);

  const stats = {
    generatedAt: today,
    totals: {
      users: Number(totalUsers),
      profiles: Number(totalProfiles),
      onboardingCompleted: Number(onboardingCompleted),
      onboardingRate: parseFloat(onboardingRate),
      profileRate: parseFloat(profileRate),
      dropOff,
      narratives: Number(totalNarratives),
      compatibilityChecks: Number(totalCompatibility),
      dailyReadings: Number(totalDailyReadings),
    },
    peakDay: {
      date: peakDay.date,
      count: Number(peakDay.count),
    },
    signupsTimeline,
    hourlySignupsPeakDay: hourlyFull,
    gender: { female: femaleCount, male: maleCount },
    authGender: authGenderMap,
    birthYearDist: birthYearArray,
    birthDow: dowArray,
    birthTimePeriod: timePeriodData,
    mbti: { order: mbtiOrder, counts: mbtiArray, map: mbtiMap },
    mbtiFemale,
    mbtiMale,
    generations: { genZ, milLate, genAlphaZ, milEarly, genXOlder },
    temperament: temperamentMap,
    surfaceViews: {
      today: surfaceTotalsMap.today,
      fortune: surfaceTotalsMap.fortune,
      byMbti: surfaceMbtiArray,
    },
    events: {
      totals: eventTotalsMap,
      categoryOpens: categoryOpensArray,
      tabOpens: tabOpensArray,
      compatibilityByType: compatibilityByTypeArray,
      sharesBySurface: sharesBySurfaceArray,
      byMbti: {
        surfaceViewed: eventSurfaceMbtiArray,
        categoryOpened: eventCategoryMbtiArray,
      },
    },
  };

  // Print JSON to stdout
  const json = JSON.stringify(stats, null, 2);
  console.log(json);

  // Write to file for use by other scripts
  const outPath = join(import.meta.dir, '../../stats-data.json');
  writeFileSync(outPath, json, 'utf8');
  console.error(`\n✅ Stats written to stats-data.json`);
  console.error(`   Total users: ${stats.totals.users}`);
  console.error(`   Peak day: ${stats.peakDay.date} (${stats.peakDay.count} signups)`);
}

fetchStats()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
