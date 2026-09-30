import { afterEach, describe, expect, test } from 'bun:test';
import { config } from '../src/config';
import { flightResultKey, isLocalDatabaseUrl } from '../src/lib/dev-regenerate';
import { GenerationSingleFlight, generationKey } from '../src/lib/generation-singleflight';

/**
 * The regenerate routes WRITE the signed-in user's readings, and the local
 * .env.local points at the production database. Two guards: a 404 in
 * production, and a 403 unless DATABASE_URL is on this machine, both before
 * the session or the body is read.
 *
 * These tests only ever set a non-local URL: the db client is built at import,
 * so a route test must never be allowed past the guard.
 */
const REAL_ENV = config.env;
const REAL_DB_URL = config.database.url;
const PATHS = ['/regenerate/compatibility', '/relock/compatibility', '/regenerate/daily', '/regenerate/chart'];
const VALID_COMPAT = { kind: 'full', target: { type: 'row', id: '91d8920c-042b-4a05-802e-8050e388c70f' } };

async function post(path: string, body: unknown, cookie?: string) {
  const { devRoutes } = await import('../src/routes/dev');
  return devRoutes.handle(
    new Request(`http://localhost/api/dev${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  config.env = REAL_ENV;
  config.database.url = REAL_DB_URL;
});

describe('isLocalDatabaseUrl', () => {
  test.each([
    'postgresql://dev:pw@localhost:5432/horo_dev',
    'postgres://dev@127.0.0.1/horo_dev',
    'postgres://dev@[::1]:5432/horo_dev',
  ])('accepts %s', (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true);
  });

  test.each([
    '',
    'not a url',
    'postgresql://u:p@monorail.proxy.rlwy.net:12345/railway',
    'postgresql://u:p@localhost.evil.com/db',
    'postgresql://u:p@10.0.0.5/db',
    'postgresql://u:p@postgres.railway.internal/db',
  ])('refuses %p', (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(false);
  });
});

describe('regenerate routes in production', () => {
  test.each(PATHS)('%s is a 404, whatever the database', async (path) => {
    config.env = 'production';
    config.database.url = 'postgresql://dev:pw@localhost:5432/horo_dev';
    expect((await post(path, {})).status).toBe(404);
    expect((await post(path, VALID_COMPAT, 'better-auth.session_token=x')).status).toBe(404);
  });
});

describe('regenerate routes against a non-local database', () => {
  test.each(PATHS)('%s is a 403 before the session or body is read', async (path) => {
    config.env = 'development';
    config.database.url = 'postgresql://u:p@monorail.proxy.rlwy.net:12345/railway';

    const anonymous = await post(path, {});
    expect(anonymous.status).toBe(403);
    expect(((await anonymous.json()) as { error: string }).error).toContain('not a local database');

    const signedIn = await post(path, VALID_COMPAT, 'better-auth.session_token=x');
    expect(signedIn.status).toBe(403);
  });

  test('an empty DATABASE_URL is refused too', async () => {
    config.env = 'development';
    config.database.url = '';
    expect((await post('/regenerate/daily', {})).status).toBe(403);
  });
});

describe('flightResultKey', () => {
  test('is the key GenerationSingleFlight replays a finished result from', async () => {
    const values = new Map<string, string>();
    const redis = {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => {
        values.set(key, value);
        return 'OK';
      },
      eval: async () => 1,
    };
    const key = generationKey('daily', 'profile-1', '2026-09-27');
    await new GenerationSingleFlight(redis as never).run({
      operation: 'daily',
      key,
      lockTtlMs: 1_000,
      waitTimeoutMs: 1_000,
      resultTtlSeconds: 60,
      run: async () => ({ reading: 'old' }),
    });

    expect(values.has(flightResultKey(key))).toBe(true);
  });
});
