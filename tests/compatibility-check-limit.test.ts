import { describe, expect, test } from 'bun:test';
import { checkRateLimit, getRateLimitStatus, RATE_LIMITS } from '../src/lib/rate-limit';
import { refundChecksOnFailure } from '../src/systems/compatibility/check-limit';

/** No REDIS_URL in tests, so the limiter is the in-memory one. */
const used = (userId: string) => ({
  hourly: getRateLimitStatus(userId, RATE_LIMITS.compatibility)?.count ?? 0,
  daily: getRateLimitStatus(userId, RATE_LIMITS.compatibilityDaily)?.count ?? 0,
});

/** What the route does: take both counters, then run the generation. */
async function check(userId: string, generate: () => Promise<string>) {
  await Promise.all([checkRateLimit(userId, RATE_LIMITS.compatibility), checkRateLimit(userId, RATE_LIMITS.compatibilityDaily)]);
  return refundChecksOnFailure(userId, generate);
}

describe('a ดวงคู่ check counts only when it succeeds', () => {
  test('a generation that throws leaves both counters as they were', async () => {
    const userId = 'check-limit-throws';
    await check(userId, async () => 'ok');
    const before = used(userId);
    expect(before).toEqual({ hourly: 1, daily: 1 });

    await expect(check(userId, async () => { throw new Error('Invalid compatibility JSON'); })).rejects.toThrow('Invalid compatibility JSON');
    expect(used(userId)).toEqual(before);
  });

  test('a successful check keeps its count', async () => {
    const userId = 'check-limit-ok';
    expect(await check(userId, async () => 'saved')).toBe('saved');
    expect(used(userId)).toEqual({ hourly: 1, daily: 1 });
  });
});
