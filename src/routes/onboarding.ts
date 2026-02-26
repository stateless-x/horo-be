import { Elysia, t } from 'elysia';
import { db } from '../lib/db';
import { user } from '../../lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Onboarding Routes
 *
 * Handles marking users as having completed onboarding
 */
export const onboardingRoutes = new Elysia({ prefix: '/api/onboarding' })
  .post(
    '/complete',
    async ({ request }) => {
      try {
        // Get session from Better Auth headers
        const sessionToken = request.headers.get('cookie')?.match(/better-auth\.session_token=([^;]+)/)?.[1];

        if (!sessionToken) {
          return {
            error: 'Unauthorized - No session token',
            code: 'UNAUTHORIZED',
          };
        }

        // TODO: Validate session with Better Auth and get user ID
        // For now, we'll extract user ID from the session
        // This is a simplified version - Better Auth handles this automatically
        // when using their session helpers

        // Get user ID from session (you'll need to query the session table)
        // For now, we need the actual Better Auth session validation
        // This is a placeholder that needs to be replaced with actual auth check

        return {
          error: 'Not implemented - Use Better Auth session validation',
          code: 'NOT_IMPLEMENTED',
        };
      } catch (error) {
        console.error('[Onboarding] Error completing onboarding:', error);
        return {
          error: 'Failed to complete onboarding',
          code: 'INTERNAL_ERROR',
        };
      }
    },
    {
      body: t.Object({}),
    }
  );
