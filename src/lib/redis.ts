/**
 * Redis Client for Rate Limiting
 *
 * Provides distributed rate limiting across multiple server instances
 * Falls back to null if Redis is not available (local development)
 */

import Redis from 'ioredis';

let redis: Redis | null = null;

/**
 * Initialize Redis connection
 * Returns null if REDIS_URL is not set (local development)
 */
export function getRedisClient(): Redis | null {
  // If already initialized, return existing client
  if (redis !== undefined) {
    return redis;
  }

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    console.log('[Redis] REDIS_URL not set, using in-memory rate limiting');
    redis = null;
    return null;
  }

  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError(err) {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
        if (targetErrors.some(targetError => err.message.includes(targetError))) {
          return true;
        }
        return false;
      },
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });

    redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redis.on('close', () => {
      console.log('[Redis] Connection closed');
    });

    return redis;
  } catch (error) {
    console.error('[Redis] Failed to initialize:', error);
    redis = null;
    return null;
  }
}

/**
 * Close Redis connection gracefully
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    console.log('[Redis] Connection closed gracefully');
  }
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return redis !== null && redis.status === 'ready';
}

/**
 * Get-or-set cache with TTL.
 * If Redis has the key, return it. Otherwise call fetcher, cache the result, return it.
 * Falls back to calling fetcher directly when Redis is unavailable.
 * Does NOT cache null/undefined results.
 */
export async function cache<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
  const client = getRedisClient();

  if (client) {
    try {
      const cached = await client.get(key);
      if (cached !== null) {
        return JSON.parse(cached) as T;
      }
    } catch (err) {
      console.error('[Redis Cache] Get error:', err);
    }
  }

  const result = await fetcher();

  if (client && result !== null && result !== undefined) {
    try {
      await client.set(key, JSON.stringify(result), 'EX', ttlSeconds);
    } catch (err) {
      console.error('[Redis Cache] Set error:', err);
    }
  }

  return result;
}

/**
 * Delete one or more cache keys.
 */
export async function invalidateCache(...keys: string[]): Promise<void> {
  const client = getRedisClient();
  if (!client || keys.length === 0) return;

  try {
    await client.del(...keys);
  } catch (err) {
    console.error('[Redis Cache] Invalidate error:', err);
  }
}
