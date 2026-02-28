import { Elysia, t } from 'elysia';
import { db } from '../lib/db';
import { generateFortuneReading, generateStructuredFortuneReading } from '../lib/gemini';
import { calculateBazi, calculateEnrichedBazi, calculateElementProfile, calculatePillarInteractions, calculateThaiAstrology, calculateCompatibility } from '../../lib/astrology';
import { birthProfiles, baziCharts, thaiAstrologyData, dailyReadings, compatibility, chartNarratives, user } from '../../lib/db';
import { BirthProfileSchema, type BaziChart, type StructuredChartResponse } from '../../lib/shared';
import { eq, and } from 'drizzle-orm';
import {
  buildTeaserPrompt,
  buildDailyReadingPrompt,
  buildStructuredChartPrompt,
  buildCompatibilityPrompt,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_STRUCTURED,
} from '../lib/prompts';
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit';
import { cache, invalidateCache } from '../lib/redis';
import { validateSessionFromRequest } from '../lib/session';

/**
 * Helper function to extract client IP from request
 */
function getClientIP(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  return 'unknown';
}

/**
 * Get birth profile with Redis caching (1 hour TTL).
 * Invalidated when profile is created or updated.
 */
async function getCachedProfile(userId: string) {
  return cache(`profile:${userId}`, 3600, async () => {
    const [profile] = await db
      .select()
      .from(birthProfiles)
      .where(eq(birthProfiles.userId, userId))
      .limit(1);
    return profile ?? null;
  });
}

/**
 * Fortune calculation and reading routes
 * All LLM calls are handled server-side for security and consistency
 */
export const fortuneRoutes = new Elysia({ prefix: '/api/fortune' })

  // Generate teaser result (BEFORE auth)
  .post('/teaser', async ({ body, set, request }) => {
    // Rate limiting for guest users (by IP)
    const clientIP = getClientIP(request);
    const rateLimitResult = await checkRateLimit(clientIP, RATE_LIMITS.teaser);

    if (rateLimitResult.limited) {
      set.status = 429;
      set.headers = {
        ...set.headers,  // Preserve existing headers (including CORS)
        'X-RateLimit-Limit': RATE_LIMITS.teaser.maxRequests.toString(),
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

    // Add rate limit headers to successful requests
    set.headers = {
      ...set.headers,  // Preserve existing headers (including CORS)
      'X-RateLimit-Limit': RATE_LIMITS.teaser.maxRequests.toString(),
      'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
      'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
    };

    try {
      const profile = BirthProfileSchema.parse(body);

      const birthDate = new Date(profile.birthDate);
      const birthHour = profile.birthTime?.isUnknown ? undefined : profile.birthTime?.chineseHour;

      // Calculate astrology
      const baziChart = calculateBazi(birthDate, birthHour, profile.gender);
      const thaiAstrology = calculateThaiAstrology(birthDate);

      // Generate AI reading using comprehensive prompt
      const prompt = buildTeaserPrompt(
        profile.name || 'ผู้มาเยือน',
        birthDate,
        baziChart,
        thaiAstrology
      );

      const reading = await generateFortuneReading(prompt, 300);

      return {
        elementType: baziChart.element,
        personality: thaiAstrology.personality,
        todaySnippet: reading,
        luckyColor: thaiAstrology.color,
        luckyNumber: thaiAstrology.luckyNumber,
      };
    } catch (error) {
      console.error('Teaser generation error:', error);
      set.status = 500;
      return { error: 'Failed to generate teaser' };
    }
  }, {
    body: BirthProfileSchema,
  })

  // Save birth profile (AFTER auth, in onboarding)
  .post('/profile', async ({ body, cookie, set, request }) => {
    // Validate session
    const session = await validateSessionFromRequest(request);

    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    // Rate limiting for profile saves
    const rateLimitResult = await checkRateLimit(session.userId, RATE_LIMITS.profileSave);

    if (rateLimitResult.limited) {
      set.status = 429;
      set.headers = {
        ...set.headers,  // Preserve existing headers (including CORS)
        'X-RateLimit-Limit': RATE_LIMITS.profileSave.maxRequests.toString(),
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

    // Add rate limit headers
    set.headers = {
      ...set.headers,  // Preserve existing headers (including CORS)
      'X-RateLimit-Limit': RATE_LIMITS.profileSave.maxRequests.toString(),
      'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
      'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
    };

    try {
      const profile = BirthProfileSchema.parse(body);
      const birthDate = new Date(profile.birthDate);
      const birthHour = profile.birthTime?.isUnknown ? undefined : profile.birthTime?.chineseHour;

      const userId = session.userId;

      console.log('[Fortune] POST /profile - Saving profile for user:', userId);
      console.log('[Fortune] Profile data:', { birthDate, birthHour, gender: profile.gender });

      // Check if user already has a profile
      const [existingProfile] = await db
        .select()
        .from(birthProfiles)
        .where(eq(birthProfiles.userId, userId))
        .limit(1);

      // Save display name to user table if provided
      if (profile.name) {
        console.log('[Fortune] Updating user displayName:', profile.name);
        await db
          .update(user)
          .set({
            displayName: profile.name,
            updatedAt: new Date(),
          })
          .where(eq(user.id, userId));
      }

      let savedProfile;

      if (existingProfile) {
        console.log('[Fortune] Profile already exists, updating...');
        // Update existing profile instead of inserting
        [savedProfile] = await db
          .update(birthProfiles)
          .set({
            birthDate,
            birthHour,
            birthTimePeriod: profile.birthTime?.period,
            gender: profile.gender,
            isTimeUnknown: profile.birthTime?.isUnknown || false,
            updatedAt: new Date(),
          })
          .where(eq(birthProfiles.userId, userId))
          .returning();
      } else {
        console.log('[Fortune] Creating new profile...');
        // Save new birth profile
        [savedProfile] = await db.insert(birthProfiles).values({
          userId,
          birthDate,
          birthHour,
          birthTimePeriod: profile.birthTime?.period,
          gender: profile.gender,
          isTimeUnknown: profile.birthTime?.isUnknown || false,
        }).returning();
      }

      // Calculate and save/update Bazi chart
      const baziChart = calculateBazi(birthDate, birthHour, profile.gender);

      // Check if chart exists
      const [existingChart] = await db
        .select()
        .from(baziCharts)
        .where(eq(baziCharts.profileId, savedProfile.id))
        .limit(1);

      if (existingChart) {
        // Update existing chart
        await db
          .update(baziCharts)
          .set({
            yearPillar: JSON.stringify(baziChart.yearPillar),
            monthPillar: JSON.stringify(baziChart.monthPillar),
            dayPillar: JSON.stringify(baziChart.dayPillar),
            hourPillar: baziChart.hourPillar ? JSON.stringify(baziChart.hourPillar) : null,
            dayMaster: baziChart.dayMaster,
            primaryElement: baziChart.element,
            elementStrength: JSON.stringify({}),
          })
          .where(eq(baziCharts.profileId, savedProfile.id));
      } else {
        // Insert new chart
        await db.insert(baziCharts).values({
          profileId: savedProfile.id,
          yearPillar: JSON.stringify(baziChart.yearPillar),
          monthPillar: JSON.stringify(baziChart.monthPillar),
          dayPillar: JSON.stringify(baziChart.dayPillar),
          hourPillar: baziChart.hourPillar ? JSON.stringify(baziChart.hourPillar) : null,
          dayMaster: baziChart.dayMaster,
          primaryElement: baziChart.element,
          elementStrength: JSON.stringify({}),
        });
      }

      // Calculate and save/update Thai astrology
      const thaiAstro = calculateThaiAstrology(birthDate);

      // Check if Thai astrology data exists
      const [existingThaiAstro] = await db
        .select()
        .from(thaiAstrologyData)
        .where(eq(thaiAstrologyData.profileId, savedProfile.id))
        .limit(1);

      if (existingThaiAstro) {
        // Update existing Thai astrology data
        await db
          .update(thaiAstrologyData)
          .set({
            day: thaiAstro.day,
            color: thaiAstro.color,
            planet: thaiAstro.planet,
            buddhaPosition: thaiAstro.buddhaPosition,
            personality: thaiAstro.personality,
            luckyNumber: thaiAstro.luckyNumber,
            luckyDirection: thaiAstro.luckyDirection,
          })
          .where(eq(thaiAstrologyData.profileId, savedProfile.id));
      } else {
        // Insert new Thai astrology data
        await db.insert(thaiAstrologyData).values({
          profileId: savedProfile.id,
          day: thaiAstro.day,
          color: thaiAstro.color,
          planet: thaiAstro.planet,
          buddhaPosition: thaiAstro.buddhaPosition,
          personality: thaiAstro.personality,
          luckyNumber: thaiAstro.luckyNumber,
          luckyDirection: thaiAstro.luckyDirection,
        });
      }

      await invalidateCache(`profile:${userId}`);
      console.log('[Fortune] Profile saved successfully:', savedProfile.id);
      return { success: true, profileId: savedProfile.id };
    } catch (error) {
      console.error('Profile save error:', error);
      set.status = 500;
      return { error: 'Failed to save profile' };
    }
  }, {
    body: BirthProfileSchema,
  })

  // Get daily reading (requires auth)
  .get('/daily', async ({ cookie, set, query, request }) => {
    // Validate session
    const session = await validateSessionFromRequest(request);

    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    try {
      const userId = session.userId;

      // Get user's birth profile (Redis-cached)
      const profile = await getCachedProfile(userId);

      if (!profile) {
        set.status = 404;
        return { error: 'Birth profile not found' };
      }

      // Check if we already have today's reading FIRST (before rate limiting)
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

      const [existingReading] = await db
        .select()
        .from(dailyReadings)
        .where(
          and(
            eq(dailyReadings.profileId, profile.id),
            eq(dailyReadings.date, todayStr)
          )
        )
        .limit(1);

      if (existingReading) {
        console.log('[Fortune] Returning cached daily reading for', todayStr);
        return existingReading;
      }

      // Only apply rate limiting if we need to generate NEW content
      console.log('[Fortune] No cached reading found, checking rate limit before generating');
      const rateLimitResult = await checkRateLimit(session.userId, RATE_LIMITS.daily);

      if (rateLimitResult.limited) {
        set.status = 429;
        set.headers = {
          ...set.headers,  // Preserve existing headers (including CORS)
          'X-RateLimit-Limit': RATE_LIMITS.daily.maxRequests.toString(),
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

      // Add rate limit headers
      set.headers = {
        ...set.headers,  // Preserve existing headers (including CORS)
        'X-RateLimit-Limit': RATE_LIMITS.daily.maxRequests.toString(),
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
      };

      // Generate new daily reading
      const baziChart = calculateBazi(
        profile.birthDate,
        profile.birthHour || undefined,
        profile.gender as 'male' | 'female'
      );
      const thaiAstrology = calculateThaiAstrology(profile.birthDate);

      // Get user's display name from the user table (prefer displayName over OAuth name)
      const [userData] = await db
        .select({ name: user.name, displayName: user.displayName })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      const userName = userData?.displayName || userData?.name || 'ผู้มาเยือน';

      const prompt = buildDailyReadingPrompt(
        userName,
        profile.birthDate,
        new Date(),
        baziChart,
        thaiAstrology
      );

      const content = await generateFortuneReading(prompt, 800);

      // Save to database
      const [newReading] = await db
        .insert(dailyReadings)
        .values({
          profileId: profile.id,
          date: todayStr, // Use YYYY-MM-DD string format
          content,
          luckyColor: thaiAstrology.color,
          luckyNumber: thaiAstrology.luckyNumber,
          luckyDirection: thaiAstrology.luckyDirection,
          elementEnergy: baziChart.element,
        })
        .returning();

      return newReading;
    } catch (error) {
      console.error('Daily reading error:', error);
      set.status = 500;
      return { error: 'Failed to generate daily reading' };
    }
  })

  // Regenerate chart reading (clear cache) - requires auth
  .delete('/chart/regenerate', async ({ request, set }) => {
    // Validate session
    const session = await validateSessionFromRequest(request);

    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    try {
      // Get user's profile
      const [profile] = await db
        .select()
        .from(birthProfiles)
        .where(eq(birthProfiles.userId, session.userId))
        .limit(1);

      if (!profile) {
        set.status = 404;
        return { error: 'Profile not found' };
      }

      // Delete cached narrative to force regeneration
      await db
        .delete(chartNarratives)
        .where(eq(chartNarratives.profileId, profile.id));
      await invalidateCache(`chart:narrative:${profile.id}`);

      console.log('[Fortune] DELETE /chart/regenerate - Cleared cache for profile:', profile.id);

      return {
        success: true,
        message: 'Fortune cache cleared. Next request will regenerate.'
      };
    } catch (error) {
      console.error('[Fortune] Regenerate error:', error);
      set.status = 500;
      return { error: 'Failed to clear fortune cache' };
    }
  })

  // Get full chart reading (requires auth)
  // Returns structured response with 6 fortune categories, element profile,
  // enriched pillars, birth star details, and recommendations.
  .get('/chart', async ({ cookie, set, request }) => {
    // Validate session
    const session = await validateSessionFromRequest(request);

    if (!session) {
      console.log('[Fortune] GET /chart - 401 Unauthorized: No valid session found');
      set.status = 401;
      return { error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    console.log('[Fortune] GET /chart - Authenticated user:', session.userId);

    // Rate limiting - applies to ALL requests (cached and uncached)
    // This prevents users from abusing refresh
    const rateLimitResult = await checkRateLimit(session.userId, RATE_LIMITS.chart);

    if (rateLimitResult.limited) {
      set.status = 429;
      set.headers = {
        ...set.headers,
        'X-RateLimit-Limit': RATE_LIMITS.chart.maxRequests.toString(),
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

    // Add rate limit headers to successful requests
    set.headers = {
      ...set.headers,
      'X-RateLimit-Limit': RATE_LIMITS.chart.maxRequests.toString(),
      'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
      'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
    };

    try {
      const userId = session.userId;

      // Get user's birth profile (Redis-cached)
      const profile = await getCachedProfile(userId);

      if (!profile) {
        set.status = 404;
        return { error: 'Birth profile not found' };
      }

      // Check Redis L1 cache, then DB for cached structured reading
      const chartCacheKey = `chart:narrative:${profile.id}`;
      const cachedChart = await cache<StructuredChartResponse | null>(chartCacheKey, 86400, async () => {
        const [dbCached] = await db
          .select()
          .from(chartNarratives)
          .where(eq(chartNarratives.profileId, profile.id))
          .limit(1);
        return dbCached?.structuredReading ? JSON.parse(dbCached.structuredReading) : null;
      });

      if (cachedChart) {
        console.log('[Fortune] GET /chart - Cache hit (still counted toward rate limit) for profile:', profile.id);
        return cachedChart;
      }

      // ---- Step 1: Deterministic calculation ----
      const birthHour = profile.birthHour ?? undefined;
      const gender = profile.gender as 'male' | 'female';

      const enrichedPillars = calculateEnrichedBazi(profile.birthDate, birthHour, gender);
      const elementProfile = calculateElementProfile(enrichedPillars.day);
      const pillarInteractions = calculatePillarInteractions(enrichedPillars);
      const thaiAstrology = calculateThaiAstrology(profile.birthDate);

      const now = new Date();
      const birthDate = new Date(profile.birthDate);
      // Use UTC year since birthDate is stored as UTC midnight
      const currentAge = now.getUTCFullYear() - birthDate.getUTCFullYear();

      // Get user's display name from the user table (prefer displayName over OAuth name)
      const [userData] = await db
        .select({ name: user.name, displayName: user.displayName })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      const userName = userData?.displayName || userData?.name || 'ผู้มาเยือน';

      // ---- Step 2: LLM synthesis ----
      console.log('[Fortune] GET /chart - Generating structured reading for profile:', profile.id);

      const prompt = buildStructuredChartPrompt(
        userName,
        profile.birthDate,
        enrichedPillars,
        elementProfile,
        pillarInteractions,
        thaiAstrology,
        currentAge,
      );

      const llmResult = await generateStructuredFortuneReading(prompt, SYSTEM_PROMPT_STRUCTURED);

      // ---- Merge deterministic + LLM data ----
      // Use UTC timezone to ensure date displays correctly (birthDate is stored as UTC midnight)
      const birthDateFormatted = profile.birthDate.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      });

      const response: StructuredChartResponse = {
        // Section 1: Hero
        personalityTraits: llmResult.personalityTraits as string[],
        birthDateFormatted,
        currentAge,

        // Section 2: Element Profile
        elementProfile,

        // Section 3: Four Pillars
        pillars: enrichedPillars,
        pillarInterpretations: llmResult.pillarInterpretations as StructuredChartResponse['pillarInterpretations'],
        pillarInteractions,

        // Section 4: Birth Star & Lucky Attributes
        birthStar: {
          planet: thaiAstrology.planet,
          planetDescription: (llmResult.birthStarDetails as any).planetDescription,
          luckyColor: thaiAstrology.color,
          luckyColorTooltip: (llmResult.birthStarDetails as any).luckyColorTooltip,
          luckyNumber: thaiAstrology.luckyNumber,
          luckyNumberTooltip: (llmResult.birthStarDetails as any).luckyNumberTooltip,
          luckyDirection: thaiAstrology.luckyDirection,
          luckyDirectionTooltip: (llmResult.birthStarDetails as any).luckyDirectionTooltip,
          luckyDay: thaiAstrology.day,
          luckyDayTooltip: (llmResult.birthStarDetails as any).luckyDayTooltip,
        },

        // Section 5: Fortune Readings
        fortuneReadings: llmResult.fortuneReadings as StructuredChartResponse['fortuneReadings'],

        // Section 6: Recommendations
        recommendations: llmResult.recommendations as StructuredChartResponse['recommendations'],
      };

      // ---- Cache the structured response (DB + Redis) ----
      await db
        .delete(chartNarratives)
        .where(eq(chartNarratives.profileId, profile.id));
      await db.insert(chartNarratives).values({
        profileId: profile.id,
        structuredReading: JSON.stringify(response),
      });
      await invalidateCache(chartCacheKey);

      console.log('[Fortune] GET /chart - Structured reading cached for profile:', profile.id);

      return response;
    } catch (error) {
      console.error('Chart reading error:', error);
      set.status = 500;
      return { error: 'Failed to generate chart reading' };
    }
  })

  // Calculate compatibility between two people
  .post('/compatibility', async ({ body, cookie, set, request }) => {
    // Validate session
    const session = await validateSessionFromRequest(request);

    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    // Rate limiting for authenticated users (by user ID)
    const rateLimitResult = await checkRateLimit(session.userId, RATE_LIMITS.compatibility);

    if (rateLimitResult.limited) {
      set.status = 429;
      set.headers = {
        ...set.headers,  // Preserve existing headers (including CORS)
        'X-RateLimit-Limit': RATE_LIMITS.compatibility.maxRequests.toString(),
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

    // Add rate limit headers
    set.headers = {
      ...set.headers,  // Preserve existing headers (including CORS)
      'X-RateLimit-Limit': RATE_LIMITS.compatibility.maxRequests.toString(),
      'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
      'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
    };

    try {
      const { partnerBirthDate, partnerGender, partnerBirthTime } = body as {
        partnerBirthDate: string;
        partnerGender: 'male' | 'female';
        partnerBirthTime?: {
          chineseHour?: number;
          isUnknown?: boolean;
        };
      };

      const userId = session.userId;
      const userProfile = await getCachedProfile(userId);

      if (!userProfile) {
        set.status = 404;
        return { error: 'User profile not found' };
      }

      // Calculate charts for both people
      const userBaziChart = calculateBazi(
        userProfile.birthDate,
        userProfile.birthHour || undefined,
        userProfile.gender as 'male' | 'female'
      );
      const userThaiAstrology = calculateThaiAstrology(userProfile.birthDate);

      const partnerBirthDateObj = new Date(partnerBirthDate);
      const partnerBirthHour = partnerBirthTime?.isUnknown ? undefined : partnerBirthTime?.chineseHour;

      const partnerBaziChart = calculateBazi(
        partnerBirthDateObj,
        partnerBirthHour,
        partnerGender as 'male' | 'female'
      );
      const partnerThaiAstrology = calculateThaiAstrology(partnerBirthDateObj);

      // Calculate compatibility score
      const compatibilityScore = calculateCompatibility(userBaziChart, partnerBaziChart);

      // Generate LLM reading
      const prompt = buildCompatibilityPrompt(
        {
          name: 'เจ้า',
          birthDate: userProfile.birthDate,
          baziChart: userBaziChart,
          thaiAstrology: userThaiAstrology,
        },
        {
          name: 'คู่ของเจ้า',
          birthDate: partnerBirthDateObj,
          baziChart: partnerBaziChart,
          thaiAstrology: partnerThaiAstrology,
        }
      );

      const reading = await generateFortuneReading(prompt, 1200);

      // Generate unique share token
      const shareToken = Math.random().toString(36).substring(2, 15);

      // TODO: Create a temporary profile for partner or handle differently
      // For now, return the result without saving to DB if partner has no profile
      return {
        score: compatibilityScore,
        reading,
        user: {
          element: userBaziChart.element,
          dayMaster: userBaziChart.dayMaster,
          thaiDay: userThaiAstrology.day,
        },
        partner: {
          element: partnerBaziChart.element,
          dayMaster: partnerBaziChart.dayMaster,
          thaiDay: partnerThaiAstrology.day,
        },
        shareToken,
      };
    } catch (error) {
      console.error('Compatibility error:', error);
      set.status = 500;
      return { error: 'Failed to calculate compatibility' };
    }
  }, {
    body: t.Object({
      partnerBirthDate: t.String(),
      partnerGender: t.Union([t.Literal('male'), t.Literal('female')]),
      partnerBirthTime: t.Optional(t.Object({
        chineseHour: t.Optional(t.Number()),
        isUnknown: t.Optional(t.Boolean()),
      })),
    }),
  })

  // Get user profile data (for settings page)
  .get('/user-profile', async ({ request, set }) => {
    // Validate session
    const session = await validateSessionFromRequest(request);

    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    try {
      const userId = session.userId;

      // Get user data
      const [userData] = await db
        .select({
          name: user.name,
          displayName: user.displayName,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);

      if (!userData) {
        set.status = 404;
        return { error: 'User not found' };
      }

      // Get birth profile (Redis-cached)
      const profile = await getCachedProfile(userId);

      return {
        user: userData,
        profile: profile || null,
      };
    } catch (error) {
      console.error('[Fortune] GET /user-profile error:', error);
      set.status = 500;
      return { error: 'Failed to fetch user profile' };
    }
  })

  // Update user profile (for settings page)
  .post('/update-profile', async ({ body, request, set }) => {
    // Validate session
    const session = await validateSessionFromRequest(request);

    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }

    try {
      const profile = BirthProfileSchema.parse(body);
      const birthDate = new Date(profile.birthDate);
      const birthHour = profile.birthTime?.isUnknown ? undefined : profile.birthTime?.chineseHour;
      const userId = session.userId;

      console.log('[Fortune] POST /update-profile - Updating profile for user:', userId);

      // Update display name in user table
      if (profile.name) {
        await db
          .update(user)
          .set({
            displayName: profile.name,
            updatedAt: new Date(),
          })
          .where(eq(user.id, userId));
      }

      // Check if birth profile exists
      const [existingProfile] = await db
        .select()
        .from(birthProfiles)
        .where(eq(birthProfiles.userId, userId))
        .limit(1);

      let savedProfile;

      if (existingProfile) {
        // Update existing profile
        [savedProfile] = await db
          .update(birthProfiles)
          .set({
            birthDate,
            birthHour,
            birthTimePeriod: profile.birthTime?.period,
            gender: profile.gender,
            isTimeUnknown: profile.birthTime?.isUnknown || false,
            updatedAt: new Date(),
          })
          .where(eq(birthProfiles.userId, userId))
          .returning();
      } else {
        // Create new profile
        [savedProfile] = await db.insert(birthProfiles).values({
          userId,
          birthDate,
          birthHour,
          birthTimePeriod: profile.birthTime?.period,
          gender: profile.gender,
          isTimeUnknown: profile.birthTime?.isUnknown || false,
        }).returning();
      }

      // Recalculate and update Bazi chart
      const baziChart = calculateBazi(birthDate, birthHour, profile.gender);

      const [existingChart] = await db
        .select()
        .from(baziCharts)
        .where(eq(baziCharts.profileId, savedProfile.id))
        .limit(1);

      if (existingChart) {
        await db
          .update(baziCharts)
          .set({
            yearPillar: JSON.stringify(baziChart.yearPillar),
            monthPillar: JSON.stringify(baziChart.monthPillar),
            dayPillar: JSON.stringify(baziChart.dayPillar),
            hourPillar: baziChart.hourPillar ? JSON.stringify(baziChart.hourPillar) : null,
            dayMaster: baziChart.dayMaster,
            primaryElement: baziChart.element,
            elementStrength: JSON.stringify({}),
          })
          .where(eq(baziCharts.profileId, savedProfile.id));
      } else {
        await db.insert(baziCharts).values({
          profileId: savedProfile.id,
          yearPillar: JSON.stringify(baziChart.yearPillar),
          monthPillar: JSON.stringify(baziChart.monthPillar),
          dayPillar: JSON.stringify(baziChart.dayPillar),
          hourPillar: baziChart.hourPillar ? JSON.stringify(baziChart.hourPillar) : null,
          dayMaster: baziChart.dayMaster,
          primaryElement: baziChart.element,
          elementStrength: JSON.stringify({}),
        });
      }

      // Recalculate and update Thai astrology
      const thaiAstro = calculateThaiAstrology(birthDate);

      const [existingThaiAstro] = await db
        .select()
        .from(thaiAstrologyData)
        .where(eq(thaiAstrologyData.profileId, savedProfile.id))
        .limit(1);

      if (existingThaiAstro) {
        await db
          .update(thaiAstrologyData)
          .set({
            day: thaiAstro.day,
            color: thaiAstro.color,
            planet: thaiAstro.planet,
            buddhaPosition: thaiAstro.buddhaPosition,
            personality: thaiAstro.personality,
            luckyNumber: thaiAstro.luckyNumber,
            luckyDirection: thaiAstro.luckyDirection,
          })
          .where(eq(thaiAstrologyData.profileId, savedProfile.id));
      } else {
        await db.insert(thaiAstrologyData).values({
          profileId: savedProfile.id,
          day: thaiAstro.day,
          color: thaiAstro.color,
          planet: thaiAstro.planet,
          buddhaPosition: thaiAstro.buddhaPosition,
          personality: thaiAstro.personality,
          luckyNumber: thaiAstro.luckyNumber,
          luckyDirection: thaiAstro.luckyDirection,
        });
      }

      // Clear cached chart narrative to force regeneration on next view
      await db
        .delete(chartNarratives)
        .where(eq(chartNarratives.profileId, savedProfile.id));
      await invalidateCache(`profile:${userId}`, `chart:narrative:${savedProfile.id}`);

      console.log('[Fortune] Profile updated successfully:', savedProfile.id);
      return { success: true, profileId: savedProfile.id };
    } catch (error) {
      console.error('[Fortune] POST /update-profile error:', error);
      set.status = 500;
      return { error: 'Failed to update profile' };
    }
  }, {
    body: BirthProfileSchema,
  });
