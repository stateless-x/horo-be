/**
 * Rate Limiting Middleware
 *
 * Prevents spam and abuse of LLM endpoints by limiting requests per user/IP
 * - IP-based rate limiting for guest users
 * - User ID-based rate limiting for authenticated users
 * - Different limits for different endpoint types
 * - Uses Redis for distributed rate limiting when available
 * - Falls back to in-memory for local development
 */

import { getRedisClient } from './redis';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RateLimitEntry {
  count: number;
  resetAt: number; // Timestamp when the window resets
}

// In-memory storage for rate limiting (fallback when Redis unavailable)
// Format: Map<identifier, RateLimitEntry>
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Rate limit configurations for different endpoint types
 */
export const RATE_LIMITS = {
  // Public teaser endpoint (most restrictive)
  teaser: {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    maxRequests: 3, // 3 teasers per day per IP
  },
  // Daily reading (once per day, but allow retries)
  daily: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5, // 5 requests per hour per user
  },
  // Full chart reading (expensive, but allows refreshing cached results)
  chart: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10, // 10 views per hour per user (cached + regenerated)
  },
  // Compatibility reading (expensive)
  compatibility: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5, // 5 compatibility checks per hour per user
  },
  // Profile save (prevent spam, generous for users correcting mistakes)
  profileSave: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20, // 20 profile saves per hour (allows users to edit/correct data)
  },
  // Onboarding completion (prevent runaway bugs, generous for edge cases)
  onboardingComplete: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20, // 20 completions per hour (accommodates retries + manual refreshes)
  },
  // Invite creation (prevent spam)
  inviteCreate: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10, // 10 invites per hour per user
  },
} as const;

/**
 * Extract client IP from request headers
 */
function getClientIP(request: Request): string {
  // Try various headers that might contain the real IP
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwardedFor.split(',')[0].trim();
  }

  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  // Fallback to a default if we can't determine IP
  // In production, this should rarely happen with proper proxy setup
  return 'unknown';
}

/**
 * Check rate limit using Redis (distributed)
 */
async function checkRateLimitRedis(
  identifier: string,
  config: RateLimitConfig
): Promise<{ limited: boolean; remaining: number; resetAt: number } | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const key = `ratelimit:${identifier}`;
    const now = Date.now();
    const windowSeconds = Math.ceil(config.windowMs / 1000);

    // Use Lua script for fully atomic incr + expire
    const luaScript = `
      local count = redis.call('incr', KEYS[1])
      local ttl = redis.call('ttl', KEYS[1])
      if ttl == -1 then
        redis.call('expire', KEYS[1], ARGV[1])
        ttl = tonumber(ARGV[1])
      end
      return {count, ttl}
    `;
    const [count, ttl] = await redis.eval(luaScript, 1, key, windowSeconds) as [number, number];

    const resetAt = now + (ttl * 1000);
    const limited = count > config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - count);

    return {
      limited,
      remaining,
      resetAt,
    };
  } catch (error) {
    console.error('[RateLimit] Redis error:', error);
    return null; // Fall back to in-memory
  }
}

/**
 * Check rate limit using in-memory storage (fallback)
 */
function checkRateLimitMemory(
  identifier: string,
  config: RateLimitConfig
): { limited: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const key = identifier;

  let entry = rateLimitStore.get(key);

  // If no entry exists or the window has expired, create a new one
  if (!entry || entry.resetAt <= now) {
    entry = {
      count: 1,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);

    return {
      limited: false,
      remaining: config.maxRequests - 1,
      resetAt: entry.resetAt,
    };
  }

  // Increment the count
  entry.count += 1;

  // Check if limit exceeded
  if (entry.count > config.maxRequests) {
    return {
      limited: true,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  return {
    limited: false,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Check if a request should be rate limited
 * Uses Redis when available, falls back to in-memory
 */
export async function checkRateLimit(
  identifier: string, // IP address or user ID
  config: RateLimitConfig
): Promise<{ limited: boolean; remaining: number; resetAt: number }> {
  // Try Redis first
  const redisResult = await checkRateLimitRedis(identifier, config);
  if (redisResult) {
    return redisResult;
  }

  // Fall back to in-memory
  return checkRateLimitMemory(identifier, config);
}

/**
 * Elysia plugin for IP-based rate limiting (for guest users)
 */
export function rateLimitByIP(config: RateLimitConfig) {
  return async ({ request, set }: { request: Request; set: any }) => {
    const clientIP = getClientIP(request);
    const result = await checkRateLimit(clientIP, config);

    if (result.limited) {
      set.status = 429;
      return {
        error: 'Too many requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000), // seconds
        resetAt: new Date(result.resetAt).toISOString(),
      };
    }

    // Add rate limit headers
    set.headers = {
      'X-RateLimit-Limit': config.maxRequests.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': new Date(result.resetAt).toISOString(),
    };
  };
}

/**
 * Elysia plugin for user-based rate limiting (for authenticated users)
 */
export function rateLimitByUser(config: RateLimitConfig) {
  return async ({ userId, set }: { userId: string; set: any }) => {
    if (!userId) {
      // If no user ID provided, skip rate limiting
      // (auth check should happen before this)
      return;
    }

    const result = await checkRateLimit(userId, config);

    if (result.limited) {
      set.status = 429;
      return {
        error: 'Too many requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000), // seconds
        resetAt: new Date(result.resetAt).toISOString(),
      };
    }

    // Add rate limit headers
    set.headers = {
      'X-RateLimit-Limit': config.maxRequests.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': new Date(result.resetAt).toISOString(),
    };
  };
}

/**
 * Clean up expired entries from the rate limit store
 * Should be called periodically to prevent memory leaks
 */
export function cleanupRateLimitStore() {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[RateLimit] Cleaned up ${cleaned} expired entries`);
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupRateLimitStore, 5 * 60 * 1000);

/**
 * Get current rate limit status for debugging
 */
export function getRateLimitStatus(identifier: string): RateLimitEntry | null {
  return rateLimitStore.get(identifier) || null;
}

/**
 * Manually reset rate limit for an identifier (for admin purposes)
 */
export function resetRateLimit(identifier: string): boolean {
  return rateLimitStore.delete(identifier);
}
