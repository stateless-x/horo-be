import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { config } from '../src/config';
import { isLocalDatabaseUrl } from '../src/lib/dev-regenerate';

/**
 * The admin-set flags (src/lib/feature-flags.ts) and their route. The auth
 * checks need no database; the flag rules run on a local Postgres only, with
 * DATABASE_URL and WALLET_TEST_DATABASE_URL both pointed at it.
 */

const SECRET = 'correct-horse-battery-staple';
async function call(path: string, init: { method?: string; secret?: string; body?: unknown } = {}) {
  const { internalFlagRoutes } = await import('../src/routes/internal-flags');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.secret !== undefined) headers['x-admin-secret'] = init.secret;
  const res = await internalFlagRoutes.handle(
    new Request(`http://localhost/internal/flags${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

describe('internal flag routes: auth', () => {
  const REAL = config.adminApi.secret;
  beforeEach(() => {
    config.adminApi.secret = SECRET;
  });
  afterEach(() => {
    config.adminApi.secret = REAL;
  });

  test('no secret, a wrong secret, or no secret configured: 401 on read and write', async () => {
    expect((await call('/')).status).toBe(401);
    expect((await call('/', { secret: 'wrong' })).status).toBe(401);
    expect((await call('/compat_lock', { method: 'PUT', secret: 'wrong', body: { enabled: true, actor: 'x' } })).status).toBe(401);
    config.adminApi.secret = '';
    expect((await call('/', { secret: '' })).status).toBe(401);
  });
});

const TEST_DB_URL = process.env.WALLET_TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('feature flags on a local Postgres', () => {
  const REAL = config.adminApi.secret;
  let flags: typeof import('../src/lib/feature-flags');
  let db: typeof import('../src/lib/db').db;
  let table: typeof import('../lib/db/schema').featureFlags;

  beforeEach(async () => {
    if (!isLocalDatabaseUrl(config.database.url) || config.database.url !== TEST_DB_URL) {
      throw new Error('Set DATABASE_URL to the same local database as WALLET_TEST_DATABASE_URL');
    }
    config.adminApi.secret = SECRET;
    flags = await import('../src/lib/feature-flags');
    db = (await import('../src/lib/db')).db;
    table = (await import('../lib/db/schema')).featureFlags;
    await db.delete(table);
    flags.overrideFlags(null);
  });
  afterAll(async () => {
    config.adminApi.secret = REAL;
    await db?.delete(table);
  });

  test('no rows: every flag is off', async () => {
    expect(await flags.readFlags()).toEqual({ compat_lock: false, compat_unlock_free: false });
  });

  test('a sub-flag cannot be turned on while its parent is off', async () => {
    const res = await call('/compat_unlock_free', { method: 'PUT', secret: SECRET, body: { enabled: true, actor: 'owner@test' } });
    expect(res.status).toBe(409);
    expect(await flags.readFlags()).toEqual({ compat_lock: false, compat_unlock_free: false });
  });

  test('parent then sub: both apply; turning the parent off turns the sub off too, and it stays off', async () => {
    await call('/compat_lock', { method: 'PUT', secret: SECRET, body: { enabled: true, actor: 'owner@test' } });
    const on = await call('/compat_unlock_free', { method: 'PUT', secret: SECRET, body: { enabled: true, actor: 'owner@test' } });
    expect(on.status).toBe(200);
    expect(await flags.readFlags()).toEqual({ compat_lock: true, compat_unlock_free: true });

    await call('/compat_lock', { method: 'PUT', secret: SECRET, body: { enabled: false, actor: 'owner@test' } });
    expect(await flags.readFlags()).toEqual({ compat_lock: false, compat_unlock_free: false });

    // The parent back on does not bring free unlocks back with it.
    await call('/compat_lock', { method: 'PUT', secret: SECRET, body: { enabled: true, actor: 'owner@test' } });
    expect(await flags.readFlags()).toEqual({ compat_lock: true, compat_unlock_free: false });
  });

  test('the admin list carries meaning, parent, stored and effective values, and who changed it', async () => {
    await call('/compat_lock', { method: 'PUT', secret: SECRET, body: { enabled: true, actor: 'owner@test' } });
    const res = await call('/', { secret: SECRET });
    const list = (res.body as { flags: Array<Record<string, unknown>> }).flags;
    expect(list.map((f) => f.key)).toEqual(['compat_lock', 'compat_unlock_free']);
    expect(list[0]).toMatchObject({ enabled: true, effective: true, parent: null, updatedBy: 'owner@test' });
    expect(list[1]).toMatchObject({ enabled: false, effective: false, parent: 'compat_lock', updatedBy: null });
  });

  test('an unknown key is refused', async () => {
    expect((await call('/nope', { method: 'PUT', secret: SECRET, body: { enabled: true, actor: 'x' } })).status).toBe(409);
  });
});
