import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  getLoadingLines,
  isLoadingSurface,
  LOADING_SURFACES,
  type LoadingSurface,
} from '../lib/content/loading-lines';

// REDIS_URL is cleared for the whole file so the route test exercises the
// null-client path in cache(). getRedisClient() is memoized process-wide, and a
// live connection would leave an open handle behind.
const originalRedisUrl = process.env.REDIS_URL;

beforeAll(() => {
  delete process.env.REDIS_URL;
});

afterAll(() => {
  if (originalRedisUrl !== undefined) {
    process.env.REDIS_URL = originalRedisUrl;
  }
});

const EXPECTED_COUNTS: Record<LoadingSurface, number> = {
  today: 14,
  fortune: 21,
  compatibility: 10,
};

const EM_DASH = '—';
const EN_DASH = '–';

describe('loading-line content', () => {
  test('every surface returns its full pool of lines', () => {
    for (const surface of LOADING_SURFACES) {
      const { lines } = getLoadingLines(surface);

      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBe(EXPECTED_COUNTS[surface]);
    }
  });

  test('every surface carries the same sponsored slots', () => {
    for (const surface of LOADING_SURFACES) {
      const { sponsored } = getLoadingLines(surface);

      expect(sponsored.length).toBe(7);
      for (const line of sponsored) {
        expect(line.text.trim().length).toBeGreaterThan(0);
        expect(line.label.trim().length).toBeGreaterThan(0);
        expect(line.sponsor.trim().length).toBeGreaterThan(0);
        expect(line.url).toStartWith('https://');
      }
    }
  });

  test('no line is empty or whitespace only', () => {
    for (const surface of LOADING_SURFACES) {
      for (const line of getLoadingLines(surface).lines) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('no line uses an em dash or en dash', () => {
    for (const surface of LOADING_SURFACES) {
      const { lines, sponsored } = getLoadingLines(surface);
      const texts = [...lines, ...sponsored.map((s) => s.text)];

      for (const text of texts) {
        expect(text).not.toInclude(EM_DASH);
        expect(text).not.toInclude(EN_DASH);
      }
    }
  });

  test('version is a stable short hash across calls', () => {
    const first = getLoadingLines('today').version;
    const second = getLoadingLines('today').version;

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}$/);
    // The hash covers all four pools, so it is the same on every surface.
    expect(getLoadingLines('fortune').version).toBe(first);
  });

  test('isLoadingSurface accepts the three surfaces and nothing else', () => {
    expect(isLoadingSurface('today')).toBe(true);
    expect(isLoadingSurface('fortune')).toBe(true);
    expect(isLoadingSurface('compatibility')).toBe(true);
    expect(isLoadingSurface('tarot')).toBe(false);
    expect(isLoadingSurface('')).toBe(false);
  });

  test('mutating a returned payload does not corrupt the module constants', () => {
    const first = getLoadingLines('today');
    first.lines.push('injected');
    first.sponsored[0]!.text = 'injected';

    expect(getLoadingLines('today').lines.length).toBe(EXPECTED_COUNTS.today);
    expect(getLoadingLines('today').sponsored[0]!.text).not.toBe('injected');
  });
});

describe('GET /api/loading-lines/:surface', () => {
  // Imported lazily so the REDIS_URL deletion above lands first.
  async function request(surface: string): Promise<Response> {
    const { contentRoutes } = await import('../src/systems/content/routes');
    return contentRoutes.handle(
      new Request(`http://localhost/api/loading-lines/${surface}`)
    );
  }

  test('serves each valid surface with the public cache header', async () => {
    for (const surface of LOADING_SURFACES) {
      const res = await request(surface);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe(
        'public, max-age=3600, stale-while-revalidate=86400'
      );

      const body = (await res.json()) as {
        lines: string[];
        sponsored: unknown[];
        version: string;
      };
      expect(body.lines.length).toBe(EXPECTED_COUNTS[surface]);
      expect(body.sponsored.length).toBe(7);
      expect(body.version).toBe(getLoadingLines(surface).version);
    }
  });

  test('rejects an unknown surface with 404', async () => {
    const res = await request('tarot');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Unknown loading surface' });
  });
});
