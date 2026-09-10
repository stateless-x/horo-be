import { describe, expect, test } from 'bun:test';
import { GenerationSingleFlight, generationKey } from '../src/lib/generation-singleflight';

class FakeRedis {
  private readonly values = new Map<string, { value: string; expiresAt: number }>();

  private read(key: string): string | null {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    return this.read(key);
  }

  async set(key: string, value: string, mode: string, ttl: number, condition?: string): Promise<'OK' | null> {
    if (condition === 'NX' && this.read(key) !== null) return null;
    const ttlMs = mode === 'EX' ? ttl * 1000 : ttl;
    this.values.set(key, { value, expiresAt: Date.now() + ttlMs });
    return 'OK';
  }

  async eval(_script: string, _keyCount: number, key: string, token: string): Promise<number> {
    if (this.read(key) !== token) return 0;
    this.values.delete(key);
    return 1;
  }
}

const options = (run: () => Promise<{ reading: string }>) => ({
  operation: 'teaser' as const,
  key: generationKey('teaser', 'same-profile'),
  lockTtlMs: 2_000,
  waitTimeoutMs: 2_000,
  resultTtlSeconds: 60,
  run,
});

describe('GenerationSingleFlight', () => {
  test('deduplicates concurrent work across coordinator instances', async () => {
    const redis = new FakeRedis();
    const firstInstance = new GenerationSingleFlight(redis as never);
    const secondInstance = new GenerationSingleFlight(redis as never);
    let calls = 0;
    const run = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { reading: 'shared' };
    };

    const [first, second] = await Promise.all([
      firstInstance.run(options(run)),
      secondInstance.run(options(run)),
    ]);

    expect(calls).toBe(1);
    expect(first.value).toEqual({ reading: 'shared' });
    expect(second.value).toEqual({ reading: 'shared' });
    expect([first.source, second.source].sort()).toEqual(['deduplicated', 'started']);
  });

  test('replays a completed result without running again', async () => {
    const redis = new FakeRedis();
    const firstInstance = new GenerationSingleFlight(redis as never);
    const secondInstance = new GenerationSingleFlight(redis as never);
    let calls = 0;
    const run = async () => ({ reading: `result-${++calls}` });

    await firstInstance.run(options(run));
    const replay = await secondInstance.run(options(run));

    expect(calls).toBe(1);
    expect(replay).toEqual({ value: { reading: 'result-1' }, source: 'replayed' });
  });

  test('uses an in-process guard when Redis is unavailable', async () => {
    const coordinator = new GenerationSingleFlight(null);
    let calls = 0;
    const run = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { reading: 'local' };
    };

    const [first, second] = await Promise.all([
      coordinator.run(options(run)),
      coordinator.run(options(run)),
    ]);

    expect(calls).toBe(1);
    expect(first.value).toEqual(second.value);
    expect(second.source).toBe('deduplicated');
  });

  test('shares a failure instead of starting the failed work again', async () => {
    const redis = new FakeRedis();
    const firstInstance = new GenerationSingleFlight(redis as never);
    const secondInstance = new GenerationSingleFlight(redis as never);
    let calls = 0;
    const run = async (): Promise<{ reading: string }> => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error('provider unavailable');
    };

    const outcomes = await Promise.allSettled([
      firstInstance.run(options(run)),
      secondInstance.run(options(run)),
    ]);

    expect(calls).toBe(1);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
  });
});
