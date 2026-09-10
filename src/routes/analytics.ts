import { Elysia, t } from 'elysia';
import { db } from '../lib/db';
import { surfaceViews, productEvents } from '../../lib/db/schema';
import { validateSessionFromRequest } from '../lib/session';
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit';
import { getTodayBangkokString } from '../../lib/shared/utils/date';
import type { TrackedSurface, TrackedEvent } from '../../lib/shared/types/analytics';
import { buildProductEventRow } from '../lib/analytics-events';

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
  )
  /**
   * Generic product event. Supersedes /view: `surface_viewed` events land here
   * with the same one-per-day guarantee, plus category/tab/share/compatibility
   * and affiliate actions. /view is kept working for clients that have not
   * reloaded yet.
   */
  .post(
    '/event',
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

        const rateLimitResult = await checkRateLimit(session.userId, RATE_LIMITS.analyticsEvent);

        if (rateLimitResult.limited) {
          set.status = 429;
          return {
            error: 'คำขอมากเกินไป กรุณาลองใหม่อีกครั้งในภายหลัง',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
            resetAt: new Date(rateLimitResult.resetAt).toISOString(),
          };
        }

        // Bangkok day, so a "once per day" event matches the calendar day Thai
        // users see and the day boundary the daily reading already uses.
        const viewDate = getTodayBangkokString();

        // Throws on a value outside the vocabulary, which the catch below turns
        // into a 500 rather than writing an unqueryable row.
        const row = buildProductEventRow(body as TrackedEvent, session.userId, viewDate);

        // ON CONFLICT DO NOTHING ... RETURNING yields zero rows only when a
        // deduped event already fired today. Rows with a NULL dedupKey never
        // conflict (Postgres NULLS DISTINCT), so those always report recorded.
        const inserted = await db
          .insert(productEvents)
          .values(row)
          .onConflictDoNothing({
            target: [
              productEvents.userId,
              productEvents.event,
              productEvents.dedupKey,
              productEvents.viewDate,
            ],
          })
          .returning({ id: productEvents.id });

        return { recorded: inserted.length > 0 };
      } catch (error) {
        console.error('[Analytics] Error recording product event:', error);
        set.status = 500;
        return {
          error: 'Failed to record product event',
          code: 'INTERNAL_ERROR',
        };
      }
    },
    {
      // Literals spelled out because Elysia's body typing needs literal members
      // rather than a mapped readonly tuple, same as /view above. The
      // `as TrackedEvent` cast is backed by buildProductEventRow re-validating
      // every enum member at runtime, so a drift between this schema and the
      // shared vocabulary fails the request instead of writing a bad row.
      body: t.Union([
        t.Object({
          event: t.Literal('surface_viewed'),
          surface: t.Union([
            t.Literal('today'),
            t.Literal('fortune'),
            t.Literal('compatibility'),
            t.Literal('settings'),
          ]),
        }),
        t.Object({
          event: t.Literal('category_opened'),
          surface: t.Union([t.Literal('today'), t.Literal('fortune')]),
          category: t.Union([
            t.Literal('life_overview'),
            t.Literal('love'),
            t.Literal('career'),
            t.Literal('finance'),
            t.Literal('health'),
            t.Literal('family'),
          ]),
        }),
        t.Object({
          event: t.Literal('tab_opened'),
          surface: t.Literal('fortune'),
          tab: t.Union([t.Literal('overview'), t.Literal('readings'), t.Literal('details')]),
        }),
        t.Object({
          event: t.Literal('cta_clicked'),
          surface: t.Union([
            t.Literal('today'),
            t.Literal('fortune'),
            t.Literal('compatibility'),
            t.Literal('settings'),
          ]),
          cta: t.Union([
            t.Literal('today_monthly_chart'),
            t.Literal('fortune_compatibility'),
            t.Literal('fortune_today'),
          ]),
        }),
        t.Object({
          event: t.Literal('affiliate_link_opened'),
          surface: t.Union([t.Literal('today'), t.Literal('fortune')]),
          placement: t.Union([
            t.Literal('donation_modal_close'),
            t.Literal('fortune_compatibility_cta'),
          ]),
          affiliateLinkId: t.String({ minLength: 1, maxLength: 20, pattern: '^[A-Za-z0-9]+$' }),
        }),
        t.Object({
          event: t.Literal('relationship_selected'),
          relationshipType: t.Union([
            t.Literal('romantic'),
            t.Literal('talking'),
            t.Literal('friend'),
            t.Literal('boss'),
            t.Literal('coworker'),
            t.Literal('family'),
          ]),
        }),
        t.Object({
          event: t.Literal('calculation_started'),
          relationshipType: t.Union([
            t.Literal('romantic'),
            t.Literal('talking'),
            t.Literal('friend'),
            t.Literal('boss'),
            t.Literal('coworker'),
            t.Literal('family'),
          ]),
        }),
        t.Object({
          event: t.Literal('calculation_failed'),
          relationshipType: t.Union([
            t.Literal('romantic'),
            t.Literal('talking'),
            t.Literal('friend'),
            t.Literal('boss'),
            t.Literal('coworker'),
            t.Literal('family'),
          ]),
          failureClass: t.Union([
            t.Literal('rate_limited'),
            t.Literal('timeout'),
            t.Literal('validation'),
            t.Literal('authentication'),
            t.Literal('profile_missing'),
            t.Literal('network'),
            t.Literal('server'),
            t.Literal('unknown'),
          ]),
        }),
        t.Object({
          event: t.Literal('compatibility_checked'),
          relationshipType: t.Union([
            t.Literal('romantic'),
            t.Literal('talking'),
            t.Literal('friend'),
            t.Literal('boss'),
            t.Literal('coworker'),
            t.Literal('family'),
          ]),
        }),
        t.Object({
          event: t.Literal('result_opened'),
          relationshipType: t.Union([
            t.Literal('romantic'),
            t.Literal('talking'),
            t.Literal('friend'),
            t.Literal('boss'),
            t.Literal('coworker'),
            t.Literal('family'),
          ]),
          origin: t.Union([
            t.Literal('fresh'),
            t.Literal('cache'),
            t.Literal('history'),
          ]),
        }),
        t.Object({
          event: t.Literal('guidance_opened'),
          relationshipType: t.Union([
            t.Literal('romantic'),
            t.Literal('talking'),
            t.Literal('friend'),
            t.Literal('boss'),
            t.Literal('coworker'),
            t.Literal('family'),
          ]),
        }),
        t.Object({
          event: t.Literal('compatibility_share_initiated'),
          relationshipType: t.Union([
            t.Literal('romantic'),
            t.Literal('talking'),
            t.Literal('friend'),
            t.Literal('boss'),
            t.Literal('coworker'),
            t.Literal('family'),
          ]),
          platform: t.Union([
            t.Literal('line'),
            t.Literal('facebook'),
            t.Literal('twitter'),
            t.Literal('copy'),
          ]),
        }),
        t.Object({
          event: t.Literal('reading_shared'),
          surface: t.Union([
            t.Literal('today'),
            t.Literal('fortune'),
            t.Literal('compatibility'),
          ]),
          platform: t.Optional(
            t.Union([
              t.Literal('line'),
              t.Literal('facebook'),
              t.Literal('twitter'),
              t.Literal('copy'),
            ])
          ),
        }),
      ]),
    }
  );
