import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { config } from '../src/config';

/**
 * Guards the auth boundary on the admin-triggered send endpoint.
 *
 * This route can mail thousands of real people, and unlike every other route
 * in this service it is not session-authenticated — a shared secret is the
 * only thing between the internet and a send. These tests cover the ways that
 * check could silently pass when it should not.
 */

/** The same comparison the route uses, exercised directly. */
async function callGuard(headerValue: string | undefined): Promise<number> {
  const { internalCampaignRoutes } = await import('../src/routes/internal-campaigns');
  const headers: Record<string, string> = {};
  if (headerValue !== undefined) headers['x-admin-secret'] = headerValue;

  const res = await internalCampaignRoutes.handle(
    new Request('http://localhost/internal/campaigns/', { headers }),
  );
  return res.status;
}

describe('internal campaign routes: auth', () => {
  const REAL = config.adminApi.secret;
  beforeEach(() => {
    config.adminApi.secret = 'correct-horse-battery-staple';
  });
  afterEach(() => {
    config.adminApi.secret = REAL;
  });

  test('rejects a request with no secret header', async () => {
    expect(await callGuard(undefined)).toBe(401);
  });

  test('rejects an empty secret header', async () => {
    expect(await callGuard('')).toBe(401);
  });

  test('rejects a wrong secret', async () => {
    expect(await callGuard('wrong-secret-entirely')).toBe(401);
  });

  test('rejects a secret that is a prefix of the real one', async () => {
    // Length is checked before timingSafeEqual, which throws on a mismatch —
    // a prefix must be refused, not crash the route.
    expect(await callGuard('correct-horse')).toBe(401);
  });

  test('rejects a secret that extends the real one', async () => {
    expect(await callGuard('correct-horse-battery-stapleXX')).toBe(401);
  });

  test('accepts the exact secret', async () => {
    // Not toBe(200): GET / now reads the campaigns table (DB-first content —
    // see src/lib/campaigns.ts), and bun test runs with no real DATABASE_URL,
    // so the handler itself throws a 500 once past the guard. What this test
    // covers is the guard, not the handler: the onBeforeHandle guard
    // short-circuits with 401 before any handler runs, so anything other than
    // 401 proves the secret was accepted and the request reached the route.
    expect(await callGuard('correct-horse-battery-staple')).not.toBe(401);
  });

  test('rejects everything when the server has no secret configured', async () => {
    // Belt and braces: index.ts does not mount the route in this state, but if
    // it ever did, an empty expected secret must not match an empty header.
    config.adminApi.secret = '';
    expect(await callGuard('')).toBe(401);
    expect(await callGuard('anything')).toBe(401);
  });
});
