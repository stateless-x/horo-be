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
