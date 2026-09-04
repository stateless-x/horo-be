import { Elysia, t } from 'elysia';
import { db } from '../../lib/db';
import { generateFortuneReading } from '../../lib/gemini';
import { calculateBazi, calculateThaiAstrology, calculateCompatibility } from '../../../lib/astrology';
import { compatibility } from '../../../lib/db';
import { RELATIONSHIP_TYPES, TOKEN_LIMITS, type RelationshipType } from '../../../lib/shared';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { buildCompatibilityPrompt } from '../../lib/prompts';
import { checkRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { cache } from '../../lib/redis';
import { validateSessionFromRequest } from '../../lib/session';
import { getCachedProfile } from '../shared';

/**
 * Compatibility system: relationship-type-aware compatibility readings
 * between the user and a partner. Create/history/get/share endpoints.
 */
export const compatibilityRoutes = new Elysia({ prefix: '/api/fortune' })

  // Calculate compatibility between two people
  .post('/compatibility', async ({ body, set, request }) => {
    const session = await validateSessionFromRequest(request);
    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    try {
      const { partnerName, partnerBirthDate, relationshipType } = body as {
        partnerName: string;
        partnerBirthDate: string;
        relationshipType: RelationshipType;
      };

      const userId = session.userId;
      const userProfile = await getCachedProfile(userId);

      if (!userProfile) {
        set.status = 404;
        return { error: 'User profile not found' };
      }

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
        return {
          id: existing.id,
          profileAId: existing.profileAId,
          partnerName: existing.partnerName,
          partnerBirthDate: existing.partnerBirthDate,
          relationshipType: existing.relationshipType,
          score: existing.score,
          analysis: existing.analysis,
          strengths: existing.strengths ? JSON.parse(existing.strengths) : [],
          challenges: existing.challenges ? JSON.parse(existing.challenges) : [],
          userElement: existing.userElement,
          userDayMaster: existing.userDayMaster,
          partnerElement: existing.partnerElement,
          partnerDayMaster: existing.partnerDayMaster,
          shareToken: existing.shareToken,
          cached: true,
          createdAt: existing.createdAt.toISOString(),
        };
      }

      // Check both hourly burst limit AND daily limit (both must pass)
      const [hourlyResult, dailyResult] = await Promise.all([
        checkRateLimit(`compat:${session.userId}`, RATE_LIMITS.compatibility),
        checkRateLimit(`compat-daily:${session.userId}`, RATE_LIMITS.compatibilityDaily),
      ]);

      // Use whichever limit is more restrictive
      const rateLimitResult = hourlyResult.limited ? hourlyResult : dailyResult.limited ? dailyResult : hourlyResult;
      const isLimited = hourlyResult.limited || dailyResult.limited;

      if (isLimited) {
        const limitConfig = hourlyResult.limited ? RATE_LIMITS.compatibility : RATE_LIMITS.compatibilityDaily;
        const retryAfter = Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000);
        set.status = 429;
        set.headers = {
          ...set.headers,
          'X-RateLimit-Limit': limitConfig.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
          'Retry-After': retryAfter.toString(),
        };
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
      set.headers = {
        ...set.headers,
        'X-RateLimit-Limit': RATE_LIMITS.compatibilityDaily.maxRequests.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': new Date(dailyResult.resetAt).toISOString(),
        'X-DailyLimit-Remaining': dailyResult.remaining.toString(),
      };

      // Calculate charts for both people
      const userBaziChart = calculateBazi(
        userProfile.birthDate,
        userProfile.birthHour || undefined,
        userProfile.gender as 'male' | 'female'
      );
      const userThaiAstrology = calculateThaiAstrology(userProfile.birthDate);

      const partnerBaziChart = calculateBazi(
        partnerBirthDateObj,
        undefined,
        'female' // default, not critical for compatibility
      );
      const partnerThaiAstrology = calculateThaiAstrology(partnerBirthDateObj);

      // Calculate compatibility score
      const compatibilityScore = calculateCompatibility(userBaziChart, partnerBaziChart);

      // Generate LLM reading with relationship-type-aware prompt
      const tokenLimit = TOKEN_LIMITS[relationshipType] || 1000;
      const prompt = buildCompatibilityPrompt(
        {
          name: 'เจ้า',
          birthDate: userProfile.birthDate,
          baziChart: userBaziChart,
          thaiAstrology: userThaiAstrology,
          mbtiType: userProfile.mbtiType,
        },
        {
          name: partnerName,
          birthDate: partnerBirthDateObj,
          baziChart: partnerBaziChart,
          thaiAstrology: partnerThaiAstrology,
        },
        relationshipType,
      );

      const reading = await generateFortuneReading(prompt, tokenLimit);
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
      const resultKey = `compat:${userId}:${saved.id}`;
      await cache(resultKey, 86400, async () => saved);

      return {
        id: saved.id,
        profileAId: saved.profileAId,
        partnerName: saved.partnerName,
        partnerBirthDate: saved.partnerBirthDate,
        relationshipType: saved.relationshipType,
        score: saved.score,
        analysis: saved.analysis,
        strengths: compatibilityScore.strengths,
        challenges: compatibilityScore.challenges,
        userElement: saved.userElement,
        userDayMaster: saved.userDayMaster,
        partnerElement: saved.partnerElement,
        partnerDayMaster: saved.partnerDayMaster,
        shareToken: saved.shareToken,
        cached: false,
        createdAt: saved.createdAt.toISOString(),
      };
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
            return {
              id: existing.id,
              profileAId: existing.profileAId,
              partnerName: existing.partnerName,
              partnerBirthDate: existing.partnerBirthDate,
              relationshipType: existing.relationshipType,
              score: existing.score,
              analysis: existing.analysis,
              strengths: existing.strengths ? JSON.parse(existing.strengths) : [],
              challenges: existing.challenges ? JSON.parse(existing.challenges) : [],
              userElement: existing.userElement,
              userDayMaster: existing.userDayMaster,
              partnerElement: existing.partnerElement,
              partnerDayMaster: existing.partnerDayMaster,
              shareToken: existing.shareToken,
              cached: true,
              createdAt: existing.createdAt.toISOString(),
            };
          }
        }
      }
      console.error('Compatibility error:', error);
      set.status = 500;
      return { error: 'Failed to calculate compatibility' };
    }
  }, {
    body: t.Object({
      partnerName: t.String({ minLength: 1, maxLength: 100 }),
      partnerBirthDate: t.String(),
      relationshipType: t.Union(
        RELATIONSHIP_TYPES.map(rt => t.Literal(rt))
      ),
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
          conditions.push(
            sql`(${compatibility.createdAt}, ${compatibility.id}) < (${new Date(decoded.createdAt)}, ${decoded.id})`
          );
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
        data: data.map(item => ({
          id: item.id,
          partnerName: item.partnerName,
          partnerBirthDate: item.partnerBirthDate,
          relationshipType: item.relationshipType,
          score: item.score,
          userElement: item.userElement,
          partnerElement: item.partnerElement,
          createdAt: item.createdAt.toISOString(),
        })),
        nextCursor,
        total,
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
      const cached = await cache(`compat:${session.userId}:${readingId}`, 86400, async () => {
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

      return {
        id: cached.id,
        profileAId: cached.profileAId,
        partnerName: cached.partnerName,
        partnerBirthDate: cached.partnerBirthDate,
        relationshipType: cached.relationshipType,
        score: cached.score,
        elementHarmony: cached.elementHarmony,
        branchHarmony: cached.branchHarmony,
        analysis: cached.analysis,
        strengths: cached.strengths ? JSON.parse(cached.strengths) : [],
        challenges: cached.challenges ? JSON.parse(cached.challenges) : [],
        userElement: cached.userElement,
        userDayMaster: cached.userDayMaster,
        partnerElement: cached.partnerElement,
        partnerDayMaster: cached.partnerDayMaster,
        shareToken: cached.shareToken,
        createdAt: cached.createdAt.toISOString(),
      };
    } catch (error) {
      console.error('Compatibility detail error:', error);
      set.status = 500;
      return { error: 'Failed to fetch compatibility reading' };
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

      // Return sanitized result (no profileAId for privacy)
      return {
        partnerName: result.partnerName,
        relationshipType: result.relationshipType,
        score: result.score,
        analysis: result.analysis,
        strengths: result.strengths ? JSON.parse(result.strengths) : [],
        challenges: result.challenges ? JSON.parse(result.challenges) : [],
        userElement: result.userElement,
        partnerElement: result.partnerElement,
        userDayMaster: result.userDayMaster,
        partnerDayMaster: result.partnerDayMaster,
        createdAt: result.createdAt.toISOString(),
      };
    } catch (error) {
      console.error('Compatibility share error:', error);
      set.status = 500;
      return { error: 'Failed to fetch shared compatibility result' };
    }
  });
