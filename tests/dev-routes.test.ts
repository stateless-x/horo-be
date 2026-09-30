import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { config } from '../src/config';

/**
 * The dev generator routes call DeepSeek with no session and no rate limit,
 * so they must never answer in production. index.ts only mounts them outside
 * production; these tests cover the second guard inside the routes, including
 * that it answers before body validation can.
 */
const originalFetch = globalThis.fetch;
const REAL_ENV = config.env;

async function post(path: string, body: unknown) {
  const { devRoutes } = await import('../src/routes/dev');
  return devRoutes.handle(
    new Request(`http://localhost/api/dev${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  config.env = REAL_ENV;
  globalThis.fetch = originalFetch;
});

describe('dev routes in production', () => {
  beforeEach(() => {
    config.env = 'production';
  });

  test.each(['/generate/compatibility', '/generate/teaser'])('%s is a 404, even for a malformed body', async (path) => {
    expect((await post(path, {})).status).toBe(404);
    expect((await post(path, { nonsense: true })).status).toBe(404);
  });

  test('a valid body is still a 404 and never reaches the model', async () => {
    let modelCalled = false;
    globalThis.fetch = (async () => {
      modelCalled = true;
      throw new Error('must not be called');
    }) as unknown as typeof fetch;

    const res = await post('/generate/compatibility', {
      reader: { birthDate: '1996-03-14', gender: 'female' },
      partner: { name: 'ต้น', birthDate: '1993-11-02' },
      relationshipType: 'romantic',
      version: 'v3',
      view: 'full',
    });

    expect(res.status).toBe(404);
    expect(modelCalled).toBe(false);
  });

  test('the dev login is a 404 too', async () => {
    const { devRoutes } = await import('../src/routes/dev');
    const res = await devRoutes.handle(new Request('http://localhost/api/dev/login'));
    expect(res.status).toBe(404);
  });
});

describe('dev routes outside production', () => {
  beforeEach(() => {
    config.env = 'development';
  });

  test('an invalid body is a 400 with the zod message', async () => {
    const res = await post('/generate/compatibility', { reader: { birthDate: '14/03/1996' } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe('Invalid request');
  });

  test('a model failure is a 502 that says why', async () => {
    globalThis.fetch = (async () => new Response('upstream down', { status: 401 })) as unknown as typeof fetch;
    const res = await post('/generate/compatibility', {
      reader: { birthDate: '1996-03-14', gender: 'female' },
      partner: { name: 'ต้น', birthDate: '1993-11-02' },
      relationshipType: 'romantic',
      version: 'v2',
      view: 'full',
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.detail).toContain('401');
  });
});
