import { createHash, randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { getRedisClient, reviveDates } from './redis';

export type GenerationOperation = 'teaser' | 'daily' | 'chart' | 'compatibility';
export type GenerationSource = 'started' | 'deduplicated' | 'replayed';

export interface GenerationFlightResult<T> {
  value: T;
  source: GenerationSource;
}

interface GenerationFlightOptions<T> {
  operation: GenerationOperation;
  key: string;
  lockTtlMs: number;
  waitTimeoutMs: number;
  resultTtlSeconds: number | ((value: T) => number);
  isFailure?: (value: T) => boolean;
  run: () => Promise<T>;
}

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const POLL_INTERVAL_MS = 250;

type StoredGenerationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

function logLifecycle(operation: GenerationOperation, event: 'started' | 'deduplicated' | 'completed' | 'failed'): void {
  console.log(JSON.stringify({ type: 'generation_lifecycle', operation, event }));
}

function flightKeys(key: string): { lockKey: string; resultKey: string } {
  const digest = createHash('sha256').update(key).digest('hex');
  return {
    lockKey: `generation:lock:${digest}`,
    resultKey: `generation:result:${digest}`,
  };
}

function readStoredResult<T>(raw: string): T {
  const stored = JSON.parse(raw, reviveDates) as StoredGenerationResult<T>;
  if (stored.ok) return stored.value;
  throw new Error(stored.message);
}

/** Stable logical identifier; Redis hashes it before storing any key. */
export function generationKey(operation: GenerationOperation, ...parts: unknown[]): string {
  return `${operation}:${JSON.stringify(parts)}`;
}

/**
 * Coordinates one logical generation across this process and every process
 * sharing Redis. The short-lived result key bridges the gap between the lock
 * owner finishing and durable DB/cache reads becoming visible.
 */
export class GenerationSingleFlight {
  private readonly localFlights = new Map<string, Promise<GenerationFlightResult<unknown>>>();

  constructor(private readonly redis: Redis | null = getRedisClient()) {}

  async run<T>(options: GenerationFlightOptions<T>): Promise<GenerationFlightResult<T>> {
    const existing = this.localFlights.get(options.key);
    if (existing) {
      logLifecycle(options.operation, 'deduplicated');
      const result = await existing;
      return { value: result.value as T, source: 'deduplicated' };
    }

    const flight = this.runDistributed(options);
    this.localFlights.set(options.key, flight as Promise<GenerationFlightResult<unknown>>);

    try {
      return await flight;
    } finally {
      if (this.localFlights.get(options.key) === flight) {
        this.localFlights.delete(options.key);
      }
    }
  }

  private async runDistributed<T>(options: GenerationFlightOptions<T>): Promise<GenerationFlightResult<T>> {
    if (!this.redis) {
      return this.runOwner(options, null, null, null);
    }

    const { lockKey, resultKey } = flightKeys(options.key);
    const replayed = await this.redis.get(resultKey);
    if (replayed !== null) {
      logLifecycle(options.operation, 'deduplicated');
      return { value: readStoredResult<T>(replayed), source: 'replayed' };
    }

    const token = randomUUID();
    const acquired = await this.redis.set(lockKey, token, 'PX', options.lockTtlMs, 'NX');
    if (acquired === 'OK') {
      return this.runOwner(options, lockKey, resultKey, token);
    }

    logLifecycle(options.operation, 'deduplicated');
    const deadline = Date.now() + options.waitTimeoutMs;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const shared = await this.redis.get(resultKey);
      if (shared !== null) {
        return { value: readStoredResult<T>(shared), source: 'deduplicated' };
      }

      const retryToken = randomUUID();
      const retryAcquired = await this.redis.set(lockKey, retryToken, 'PX', options.lockTtlMs, 'NX');
      if (retryAcquired === 'OK') {
        return this.runOwner(options, lockKey, resultKey, retryToken);
      }
    }

    throw new Error(`Timed out waiting for ${options.operation} generation`);
  }

  private async runOwner<T>(
    options: GenerationFlightOptions<T>,
    lockKey: string | null,
    resultKey: string | null,
    token: string | null,
  ): Promise<GenerationFlightResult<T>> {
    logLifecycle(options.operation, 'started');

    try {
      const value = await options.run();
      const failed = options.isFailure?.(value) === true;
      logLifecycle(options.operation, failed ? 'failed' : 'completed');

      if (this.redis && resultKey) {
        const ttl = typeof options.resultTtlSeconds === 'function'
          ? options.resultTtlSeconds(value)
          : options.resultTtlSeconds;
        if (ttl > 0) {
          await this.redis.set(resultKey, JSON.stringify({ ok: true, value }), 'EX', ttl);
        }
      }

      return { value, source: 'started' };
    } catch (error) {
      logLifecycle(options.operation, 'failed');
      if (this.redis && resultKey) {
        const message = error instanceof Error ? error.message : 'Generation failed';
        await this.redis
          .set(resultKey, JSON.stringify({ ok: false, message }), 'EX', 5)
          .catch((cacheError) => {
            console.error('[GenerationSingleFlight] Failed to publish failure:', cacheError);
          });
      }
      throw error;
    } finally {
      if (this.redis && lockKey && token) {
        await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token).catch((error) => {
          console.error('[GenerationSingleFlight] Failed to release lock:', error);
        });
      }
    }
  }
}

export const generationSingleFlight = new GenerationSingleFlight();
