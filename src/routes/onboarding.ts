import { Elysia, t } from 'elysia';
import { db } from '../lib/db';
import { user } from '../../lib/db/schema';
import { eq } from 'drizzle-orm';
import { validateSessionFromRequest } from '../lib/session';

/**
 * Onboarding Routes
 *
 * Handles marking users as having completed onboarding
 */
export const onboardingRoutes = new Elysia({ prefix: '/api/onboarding' })
  .post(
    '/complete',
    async ({ request, set }) => {
      try {
        // Validate session and get user ID
        const session = await validateSessionFromRequest(request);

        if (!session) {
          set.status = 401;
          return {
            error: 'Unauthorized - Invalid or expired session',
            code: 'UNAUTHORIZED',
          };
        }

        // Rate limiting (import at top of file)
        const { checkRateLimit, RATE_LIMITS } = await import('../lib/rate-limit');
        const rateLimitResult = await checkRateLimit(session.userId, RATE_LIMITS.onboardingComplete);

        if (rateLimitResult.limited) {
          set.status = 429;
          set.headers = {
            ...set.headers,
            'X-RateLimit-Limit': RATE_LIMITS.onboardingComplete.maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
            'Retry-After': Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000).toString(),
          };
          return {
            error: 'คำขอมากเกินไป กรุณาลองใหม่อีกครั้งในภายหลัง',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
            resetAt: new Date(rateLimitResult.resetAt).toISOString(),
          };
        }

        // Add rate limit headers (merge with existing CORS headers)
        set.headers = {
          ...set.headers,
          'X-RateLimit-Limit': RATE_LIMITS.onboardingComplete.maxRequests.toString(),
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
        };

        // Update user's onboarding status
        const [updatedUser] = await db
          .update(user)
          .set({
            onboardingCompleted: true,
            updatedAt: new Date(),
          })
          .where(eq(user.id, session.userId))
          .returning();

        if (!updatedUser) {
          set.status = 404;
          return {
            error: 'User not found',
            code: 'USER_NOT_FOUND',
          };
        }

        console.log(`[Onboarding] User ${session.userId} completed onboarding`);

        return {
          success: true,
          onboardingCompleted: true,
          userId: session.userId,
        };
      } catch (error) {
        console.error('[Onboarding] Error completing onboarding:', error);
        set.status = 500;
        return {
          error: error instanceof Error ? error.message : 'Failed to complete onboarding',
          code: 'INTERNAL_ERROR',
        };
      }
    },
    {
      body: t.Object({}),
    }
  );
