import { Elysia, t } from 'elysia';
import { db } from '../../lib/db';
import { normalizeMbtiType } from '../../../lib/astrology';
import { compatibility, user } from '../../../lib/db';
import { MBTI_TYPES, RELATIONSHIP_TYPES, type RelationshipType } from '../../../lib/shared';
import { eq, and, desc, count } from 'drizzle-orm';
import { checkRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { cache } from '../../lib/redis';
import { validateSessionFromRequest } from '../../lib/session';
import { getCachedProfile } from '../shared';
import { generationKey, generationSingleFlight } from '../../lib/generation-singleflight';
import { COMPATIBILITY_V4_LIVE_BUDGET, generateCompatibilityV4Stored, readerGender } from '../../lib/compatibility-generation';
import { config } from '../../config';
import { historyItem, readingResponse, shareResponse } from './reading';
import { historyCursorBefore } from './history-cursor';
import { refundChecksOnFailure } from './check-limit';
import { compatCacheKey, unlockForUser } from './unlock';

function isGenerationError(value: unknown): value is { error: string; code?: string } {
  return typeof value === 'object' && value !== null && 'error' in value;
}


/**
 * Compatibility system: relationship-type-aware compatibility readings
 * between the user and a partner. Create/history/get/share endpoints.
 */
export const compatibilityRoutes = new Elysia({ prefix: '/api/fortune' })

  // Calculate compatibility between two people
  .post('/compatibility', async ({ body, set, request }) => {
    const requestStartedAt = Date.now();
    const session = await validateSessionFromRequest(request);
    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    try {
      const { partnerName, partnerBirthDate, relationshipType, partnerMbti } = body as {
        partnerName: string;
        partnerBirthDate: string;
        relationshipType: RelationshipType;
        partnerMbti?: string;
      };

      // Optional partner MBTI: empty/absent means not provided, otherwise must be one of the 16 codes
      const partnerMbtiType = partnerMbti?.trim().toUpperCase() || null;
      if (partnerMbtiType && !MBTI_TYPES.some(m => m.code === partnerMbtiType)) {
        set.status = 400;
        return { error: 'MBTI ไม่ถูกต้อง' };
      }

      const userId = session.userId;
      const userProfile = await getCachedProfile(userId);

      if (!userProfile) {
        set.status = 404;
        return { error: 'User profile not found' };
      }

      const [account] = await db
        .select({ name: user.name, displayName: user.displayName })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      const readerName = account?.displayName || account?.name || 'คุณ';

      // Convert partner birth date to Date object (frontend sends ISO string)
      const partnerBirthDateObj = new Date(partnerBirthDate);
      // Format as YYYY-MM-DD for DB storage
      const partnerBirthDateStr = partnerBirthDateObj.toISOString().split('T')[0];

      // Check for existing reading with same partner + relationship type
      const [existing] = await db
        .select()
        .from(compatibility)
        .where(
          and(
            eq(compatibility.profileAId, userProfile.id),
            eq(compatibility.partnerBirthDate, partnerBirthDateStr),
            eq(compatibility.relationshipType, relationshipType),
          )
        )
        .limit(1);

      if (existing) {
        // Return cached result without consuming rate limit
        return { ...readingResponse(existing), cached: true };
      }

      const flight = await generationSingleFlight.run({
        operation: 'compatibility',
        key: generationKey('compatibility', userProfile.id, partnerBirthDateStr, relationshipType),
        lockTtlMs: 300_000,
        waitTimeoutMs: 250_000,
        resultTtlSeconds: (value) => isGenerationError(value) ? 5 : 60,
        isFailure: isGenerationError,
        run: async () => {

      // Check both hourly burst limit AND daily limit (both must pass).
      // The identifier is the bare user id: the bucket name in each config
      // already separates these two counters, and every other limit, from one
      // another. Hand-written `compat:` / `compat-daily:` prefixes used to do
      // that job and would now double up in the key.
      const [hourlyResult, dailyResult] = await Promise.all([
        checkRateLimit(session.userId, RATE_LIMITS.compatibility),
        checkRateLimit(session.userId, RATE_LIMITS.compatibilityDaily),
      ]);

      // Use whichever limit is more restrictive
      const rateLimitResult = hourlyResult.limited ? hourlyResult : dailyResult.limited ? dailyResult : hourlyResult;
      const isLimited = hourlyResult.limited || dailyResult.limited;

      if (isLimited) {
        const limitConfig = hourlyResult.limited ? RATE_LIMITS.compatibility : RATE_LIMITS.compatibilityDaily;
        const retryAfter = Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000);
        set.status = 429;
        Object.assign(set.headers, {
          'X-RateLimit-Limit': limitConfig.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
          'Retry-After': retryAfter.toString(),
        });
        return {
          error: dailyResult.limited
            ? 'เจ้าส่องดวงครบ 5 คนในวันนี้แล้ว กลับมาใหม่พรุ่งนี้นะ'
            : 'พลังดวงดาวต้องการเวลาฟื้นฟู กรุณาลองใหม่อีกครั้งในภายหลัง',
          code: 'RATE_LIMIT_EXCEEDED',
          limitType: dailyResult.limited ? 'daily' : 'hourly',
          retryAfter,
          resetAt: new Date(rateLimitResult.resetAt).toISOString(),
        };
      }

      // Use the most restrictive remaining count
      const remaining = Math.min(hourlyResult.remaining, dailyResult.remaining);
      Object.assign(set.headers, {
        'X-RateLimit-Limit': RATE_LIMITS.compatibilityDaily.maxRequests.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': new Date(dailyResult.resetAt).toISOString(),
        'X-DailyLimit-Remaining': dailyResult.remaining.toString(),
      });

      // A check that fails after this point gives its hourly and daily counts back.
      return refundChecksOnFailure(session.userId, async () => {
        // Content v4: computed scores, archetype and calendar, then the report
        // written by the model within the live budget (one repair per call and a
        // deadline, so the synchronous response fits the socket and client
        // timeouts; see docs/compatibility-response-fix.md, "v4 live budget").
        // Locked mode writes only the free teaser; the detail is written on unlock.
        const generation = await generateCompatibilityV4Stored({
          reader: {
            name: readerName,
            birthDate: userProfile.birthDate,
            birthHour: userProfile.birthHour ?? undefined,
            gender: readerGender(userProfile.gender),
            mbtiType: normalizeMbtiType(userProfile.mbtiType),
          },
          partner: { name: partnerName, birthDate: partnerBirthDateObj, mbtiType: normalizeMbtiType(partnerMbtiType) },
          relationshipType,
          withDetail: !config.compat.lockEnabled,
          maxRepairs: COMPATIBILITY_V4_LIVE_BUDGET.maxRepairs,
          deadlineAt: requestStartedAt + COMPATIBILITY_V4_LIVE_BUDGET.llmMs,
        });
        if (generation.qualityFlags.length) {
          console.warn('[compatibility v4] quality flags', { flags: generation.qualityFlags });
        }
        console.log('[compatibility v4] generated', { withDetail: !config.compat.lockEnabled, timings: generation.timings });
        const { stored, charts } = generation;
        const userBaziChart = charts.readerBazi;
        const partnerBaziChart = charts.partnerBazi;
        const compatibilityScore = charts.score;
        const reading = JSON.stringify(stored);
        const shareToken = Math.random().toString(36).substring(2, 15);

        // Save to DB
        const [saved] = await db.insert(compatibility).values({
          profileAId: userProfile.id,
          partnerName,
          partnerBirthDate: partnerBirthDateStr,
          relationshipType,
          score: compatibilityScore.score,
          elementHarmony: compatibilityScore.elementHarmony,
          branchHarmony: compatibilityScore.branchHarmony,
          analysis: reading,
          strengths: JSON.stringify(compatibilityScore.strengths),
          challenges: JSON.stringify(compatibilityScore.challenges),
          userElement: userBaziChart.element,
          userDayMaster: userBaziChart.dayMaster,
          partnerElement: partnerBaziChart.element,
          partnerDayMaster: partnerBaziChart.dayMaster,
          shareToken,
        }).returning();

        // Cache the result
        await cache(compatCacheKey(userId, saved.id), 86400, async () => saved);

        return { ...readingResponse(saved), cached: false };
      });
        },
      });

      if (flight.source !== 'started' && isGenerationError(flight.value)) {
        set.status = flight.value.code === 'RATE_LIMIT_EXCEEDED' ? 429 : 500;
      }
      return flight.value;
    } catch (error: any) {
      // Handle unique constraint violation (race condition on double-submit)
      if (error?.code === '23505') {
        const { partnerBirthDate, relationshipType } = body as any;
        const userProfile = await getCachedProfile(session.userId);
        if (userProfile) {
          const partnerBirthDateStr = new Date(partnerBirthDate).toISOString().split('T')[0];
          const [existing] = await db
            .select()
            .from(compatibility)
            .where(
              and(
                eq(compatibility.profileAId, userProfile.id),
                eq(compatibility.partnerBirthDate, partnerBirthDateStr),
                eq(compatibility.relationshipType, relationshipType),
              )
            )
            .limit(1);
          if (existing) {
            return { ...readingResponse(existing), cached: true };
          }
        }
      }
      console.error('Compatibility error:', error);
      set.status = 500;
      return { error: 'ตอนนี้เขียนดวงคู่ไม่สำเร็จ ลองอีกครั้งนะ' };
    }
  }, {
    body: t.Object({
      partnerName: t.String({ minLength: 1, maxLength: 100 }),
      partnerBirthDate: t.String(),
      relationshipType: t.Union(
        RELATIONSHIP_TYPES.map(rt => t.Literal(rt))
      ),
      partnerMbti: t.Optional(t.String()),
    }),
  })

  // Get compatibility reading history (paginated)
  .get('/compatibility/history', async ({ query, set, request }) => {
    const session = await validateSessionFromRequest(request);
    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    try {
      const userProfile = await getCachedProfile(session.userId);
      if (!userProfile) {
        set.status = 404;
        return { error: 'User profile not found' };
      }

      const limit = Math.min(Math.max(parseInt(query.limit || '20'), 1), 50);
      const cursor = query.cursor || null;
      const typeFilter = query.relationshipType || null;

      // Build conditions
      const conditions = [eq(compatibility.profileAId, userProfile.id)];

      if (typeFilter && RELATIONSHIP_TYPES.includes(typeFilter as any)) {
        conditions.push(eq(compatibility.relationshipType, typeFilter));
      }

      // Decode cursor
      if (cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
          conditions.push(historyCursorBefore(decoded));
        } catch {
          // Invalid cursor, ignore
        }
      }

      // Fetch items
      const items = await db
        .select({
          id: compatibility.id,
          partnerName: compatibility.partnerName,
          partnerBirthDate: compatibility.partnerBirthDate,
          relationshipType: compatibility.relationshipType,
          score: compatibility.score,
          userElement: compatibility.userElement,
          partnerElement: compatibility.partnerElement,
          analysis: compatibility.analysis,
          createdAt: compatibility.createdAt,
        })
        .from(compatibility)
        .where(and(...conditions))
        .orderBy(desc(compatibility.createdAt), desc(compatibility.id))
        .limit(limit + 1); // Fetch one extra to determine if there are more

      const hasMore = items.length > limit;
      const data = items.slice(0, limit);

      // Build next cursor
      let nextCursor: string | null = null;
      if (hasMore && data.length > 0) {
        const lastItem = data[data.length - 1];
        nextCursor = Buffer.from(JSON.stringify({
          createdAt: lastItem.createdAt.toISOString(),
          id: lastItem.id,
        })).toString('base64');
      }

      // Get total count (only on first page for efficiency)
      let total = 0;
      if (!cursor) {
        const countConditions = [eq(compatibility.profileAId, userProfile.id)];
        if (typeFilter && RELATIONSHIP_TYPES.includes(typeFilter as any)) {
          countConditions.push(eq(compatibility.relationshipType, typeFilter));
        }
        const [countResult] = await db
          .select({ count: count() })
          .from(compatibility)
          .where(and(...countConditions));
        total = countResult?.count || 0;
      }

      return {
        data: data.map(historyItem),
        nextCursor,
        total,
        // The page reads it before a new check, so the wait screen can say
        // what the POST will write: the teaser alone (lock on) or the full report.
        lockEnabled: config.compat.lockEnabled,
      };
    } catch (error) {
      console.error('Compatibility history error:', error);
      set.status = 500;
      return { error: 'Failed to fetch compatibility history' };
    }
  })

  // Get single compatibility reading by ID
  .get('/compatibility/:id', async ({ params, set, request }) => {
    const session = await validateSessionFromRequest(request);
    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    try {
      const userProfile = await getCachedProfile(session.userId);
      if (!userProfile) {
        set.status = 404;
        return { error: 'User profile not found' };
      }

      const readingId = params.id;

      // Try Redis cache first
      const cached = await cache(compatCacheKey(session.userId, readingId), 86400, async () => {
        const [record] = await db
          .select()
          .from(compatibility)
          .where(
            and(
              eq(compatibility.id, readingId),
              eq(compatibility.profileAId, userProfile.id),
            )
          )
          .limit(1);
        return record ?? null;
      });

      if (!cached) {
        set.status = 404;
        return { error: 'Compatibility reading not found' };
      }

      return readingResponse(cached);
    } catch (error) {
      console.error('Compatibility detail error:', error);
      set.status = 500;
      return { error: 'Failed to fetch compatibility reading' };
    }
  })

  // Unlock a locked v4 report: write its detail and patch it into the row (owner only, idempotent)
  .post('/compatibility/:id/unlock', async ({ params, set, request }) => {
    const requestStartedAt = Date.now();
    const session = await validateSessionFromRequest(request);
    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    try {
      const result = await unlockForUser(session.userId, params.id, requestStartedAt);
      set.status = result.status;
      return result.body;
    } catch (error) {
      console.error('Compatibility unlock error:', error);
      set.status = 500;
      return { error: 'ตอนนี้เขียนฉบับเต็มไม่สำเร็จ ลองอีกครั้งนะ' };
    }
  })

  // Public share endpoint for compatibility results (NO AUTH required)
  .get('/compatibility/share/:token', async ({ params, set }) => {
    try {
      const { token } = params;

      const [result] = await db
        .select()
        .from(compatibility)
        .where(eq(compatibility.shareToken, token))
        .limit(1);

      if (!result) {
        set.status = 404;
        return { error: 'ไม่พบผลดวงที่ต้องการ' };
      }

      return shareResponse(result);
    } catch (error) {
      console.error('Compatibility share error:', error);
      set.status = 500;
      return { error: 'Failed to fetch shared compatibility result' };
    }
  });
