import { describe, expect, test } from 'bun:test';
import { RATE_LIMITS, checkRateLimit, resetRateLimit } from '../src/lib/rate-limit';

/**
 * Guards rate-limit bucket isolation.
 *
 * Every limit used to call checkRateLimit with a bare identifier, so they all
 * incremented one key — `ratelimit:<userId>`. The smallest max among them
 * became the effective limit for all of them, and whichever endpoint was hit
 * first set the TTL for the rest. A new user spent that shared counter during
 * onboarding (profile save, analytics pings, chart generation) and was refused
 * their very first daily reading with a 429.
 *
 * These run against the in-memory store: no Redis is configured under test, so
 * checkRateLimit falls back to it, and it now builds keys the same way Redis
 * does.
 */

const ALL_LIMITS = Object.values(RATE_LIMITS);

/** A fresh id per test so buckets never carry over between cases. */
const userId = (label: string) => `test-user-${label}-${Math.random().toString(36).slice(2)}`;

describe('rate limit buckets are isolated', () => {
  test('every configured limit has a name', () => {
    for (const limit of ALL_LIMITS) {
      expect(limit.name).toBeTruthy();
    }
  });

  test('no two limits share a bucket name', () => {
    const names = ALL_LIMITS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('the config key and its bucket name agree', () => {
    // A rename that updates one and not the other would silently merge or
    // orphan a bucket, which is exactly the failure this file exists to catch.
    for (const [key, limit] of Object.entries(RATE_LIMITS)) {
      expect(limit.name).toBe(key);
    }
  });

  test('spending one bucket leaves the others untouched', async () => {
    const id = userId('isolation');

    // Exhaust the smallest bucket completely: chart allows 3 per 24h.
    for (let i = 0; i < RATE_LIMITS.chart.maxRequests; i++) {
      const spent = await checkRateLimit(id, RATE_LIMITS.chart);
      expect(spent.limited).toBe(false);
    }
    const overspent = await checkRateLimit(id, RATE_LIMITS.chart);
    expect(overspent.limited).toBe(true);

    // The daily reading is the endpoint that was failing in production. It must
    // still be untouched, with its own full allowance.
    const daily = await checkRateLimit(id, RATE_LIMITS.daily);
    expect(daily.limited).toBe(false);
    expect(daily.remaining).toBe(RATE_LIMITS.daily.maxRequests - 1);

    for (const limit of ALL_LIMITS) {
      if (limit.name === RATE_LIMITS.chart.name) continue;
      const other = await checkRateLimit(userId(`fresh-${limit.name}`), limit);
      expect(other.limited).toBe(false);
    }
  });

  test('a new user reaches their first daily reading', async () => {
    const id = userId('signup');

    // The onboarding path, in order, on one identifier.
    await checkRateLimit(id, RATE_LIMITS.profileSave);
    await checkRateLimit(id, RATE_LIMITS.onboardingComplete);
    await checkRateLimit(id, RATE_LIMITS.analyticsView);
    for (let i = 0; i < 10; i++) {
      await checkRateLimit(id, RATE_LIMITS.analyticsEvent);
    }
    await checkRateLimit(id, RATE_LIMITS.chart);

    const firstDaily = await checkRateLimit(id, RATE_LIMITS.daily);
    expect(firstDaily.limited).toBe(false);
    expect(firstDaily.remaining).toBe(RATE_LIMITS.daily.maxRequests - 1);
  });

  test('a bucket still enforces its own limit', async () => {
    const id = userId('enforce');

    for (let i = 0; i < RATE_LIMITS.daily.maxRequests; i++) {
      expect((await checkRateLimit(id, RATE_LIMITS.daily)).limited).toBe(false);
    }
    expect((await checkRateLimit(id, RATE_LIMITS.daily)).limited).toBe(true);
  });

  test('the two compatibility limits count separately', async () => {
    const id = userId('compat');

    // Both are checked on every compatibility request with the same bare id,
    // so they must not be the same counter.
    for (let i = 0; i < RATE_LIMITS.compatibility.maxRequests; i++) {
      await checkRateLimit(id, RATE_LIMITS.compatibility);
    }
    expect((await checkRateLimit(id, RATE_LIMITS.compatibility)).limited).toBe(true);

    const daily = await checkRateLimit(id, RATE_LIMITS.compatibilityDaily);
    expect(daily.limited).toBe(false);
  });

  test('resetting one bucket does not clear another', async () => {
    const id = userId('reset');

    await checkRateLimit(id, RATE_LIMITS.daily);
    await checkRateLimit(id, RATE_LIMITS.chart);
    resetRateLimit(id, RATE_LIMITS.daily);

    // daily starts over...
    const daily = await checkRateLimit(id, RATE_LIMITS.daily);
    expect(daily.remaining).toBe(RATE_LIMITS.daily.maxRequests - 1);
    // ...while chart keeps the request it already spent.
    const chart = await checkRateLimit(id, RATE_LIMITS.chart);
    expect(chart.remaining).toBe(RATE_LIMITS.chart.maxRequests - 2);
  });
});
