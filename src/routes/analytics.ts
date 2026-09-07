import { Elysia, t } from 'elysia';
import { db } from '../lib/db';
import { surfaceViews } from '../../lib/db/schema';
import { validateSessionFromRequest } from '../lib/session';
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit';
import { getTodayBangkokString } from '../../lib/shared/utils/date';
import type { TrackedSurface } from '../../lib/shared/types/analytics';

/**
 * Analytics Routes
 *
 * Records which dashboard surface a user opened, at most one row per user per
 * surface per Bangkok day. The frontend also skips the call when it has already
 * pinged today, so this endpoint is the backstop rather than the only guard.
 *
 * Records no birth data, names, or generated prose — just (user, surface, day).
 */
export const analyticsRoutes = new Elysia({ prefix: '/api/analytics' })
  .post(
    '/view',
    async ({ request, set, body }) => {
      try {
        const session = await validateSessionFromRequest(request);

        if (!session) {
          set.status = 401;
          return {
            error: 'Unauthorized - Invalid or expired session',
            code: 'UNAUTHORIZED',
          };
        }

        const rateLimitResult = await checkRateLimit(session.userId, RATE_LIMITS.analyticsView);

        if (rateLimitResult.limited) {
          set.status = 429;
          return {
            error: 'คำขอมากเกินไป กรุณาลองใหม่อีกครั้งในภายหลัง',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
            resetAt: new Date(rateLimitResult.resetAt).toISOString(),
          };
        }

        // Bangkok day, so "today" matches the calendar day Thai users see and
        // matches the day boundary the daily reading already uses.
        const viewDate = getTodayBangkokString();

        // ON CONFLICT DO NOTHING ... RETURNING yields zero rows when the row
        // already exists, which is exactly the "already counted today" signal.
        const inserted = await db
          .insert(surfaceViews)
          .values({
            userId: session.userId,
            surface: body.surface satisfies TrackedSurface,
            viewDate,
          })
          .onConflictDoNothing({
            target: [surfaceViews.userId, surfaceViews.surface, surfaceViews.viewDate],
          })
          .returning({ id: surfaceViews.id });

        return { recorded: inserted.length > 0 };
      } catch (error) {
        console.error('[Analytics] Error recording surface view:', error);
        set.status = 500;
        return {
          error: error instanceof Error ? error.message : 'Failed to record surface view',
          code: 'INTERNAL_ERROR',
        };
      }
    },
    {
      body: t.Object({
        // Spelled out because Elysia's body typing needs literal members
        // rather than a mapped readonly tuple. The `satisfies TrackedSurface`
        // below fails type-check if a surface is ever dropped from
        // TRACKED_SURFACES while still accepted here. Adding a surface is not
        // caught by the compiler — add it in both places.
        surface: t.Union([t.Literal('today'), t.Literal('fortune')]),
      }),
    }
  );
