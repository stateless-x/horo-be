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
