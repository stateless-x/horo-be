import { Elysia, t } from 'elysia';
import { db } from '../lib/db';
import { generateFortuneReading, generateFortuneReadingStream } from '../lib/gemini';
import { calculateBazi, calculateThaiAstrology, calculateCompatibility } from '../../lib/astrology';
import { birthProfiles, baziCharts, thaiAstrologyData, dailyReadings, compatibility } from '../../lib/db';
import { BirthProfileSchema, type BaziChart } from '../../lib/shared';
import { eq, and } from 'drizzle-orm';
import {
  buildTeaserPrompt,
  buildDailyReadingPrompt,
  buildFullChartPrompt,
  buildCompatibilityPrompt,
  SYSTEM_PROMPT
} from '../lib/prompts';
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit';
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
 * Fortune calculation and reading routes
 * All LLM calls are handled server-side for security and consistency
 */
export const fortuneRoutes = new Elysia({ prefix: '/fortune' })

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

    // Rate limiting for authenticated users (by user ID)
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

    try {
      const userId = session.userId;

      // Get user's birth profile
      const [profile] = await db
        .select()
        .from(birthProfiles)
        .where(eq(birthProfiles.userId, userId))
        .limit(1);

      if (!profile) {
        set.status = 404;
        return { error: 'Birth profile not found' };
      }

      // Check if we already have today's reading
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
        return existingReading;
      }

      // Generate new daily reading
      const baziChart = calculateBazi(
        profile.birthDate,
        profile.birthHour || undefined,
        profile.gender as 'male' | 'female'
      );
      const thaiAstrology = calculateThaiAstrology(profile.birthDate);

      const prompt = buildDailyReadingPrompt(
        'ผู้ใช้', // TODO: Get actual name from users table
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

  // Get full chart reading (requires auth)
  .get('/chart', async ({ cookie, set, request }) => {
    // Validate session
    const session = await validateSessionFromRequest(request);

    if (!session) {
      console.log('[Fortune] GET /chart - 401 Unauthorized: No valid session found');
      set.status = 401;
      return { error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    console.log('[Fortune] GET /chart - Authenticated user:', session.userId);

    // NOTE: No rate limiting on GET - this endpoint returns cached data
    // Rate limiting is applied on POST /fortune/profile which triggers LLM generation

    try {
      const userId = session.userId;

      // Get user's birth profile
      const [profile] = await db
        .select()
        .from(birthProfiles)
        .where(eq(birthProfiles.userId, userId))
        .limit(1);

      if (!profile) {
        set.status = 404;
        return { error: 'Birth profile not found' };
      }

      // Get or calculate Bazi chart
      let [baziChartRecord] = await db
        .select()
        .from(baziCharts)
        .where(eq(baziCharts.profileId, profile.id))
        .limit(1);

      if (!baziChartRecord) {
        // Calculate and save
        const baziChart = calculateBazi(
          profile.birthDate,
          profile.birthHour || undefined,
          profile.gender as 'male' | 'female'
        );

        [baziChartRecord] = await db
          .insert(baziCharts)
          .values({
            profileId: profile.id,
            yearPillar: JSON.stringify(baziChart.yearPillar),
            monthPillar: JSON.stringify(baziChart.monthPillar),
            dayPillar: JSON.stringify(baziChart.dayPillar),
            hourPillar: baziChart.hourPillar ? JSON.stringify(baziChart.hourPillar) : null,
            dayMaster: baziChart.dayMaster,
            primaryElement: baziChart.element,
            elementStrength: JSON.stringify({}),
          })
          .returning();
      }

      // Parse chart data
      const baziChart: BaziChart = {
        yearPillar: JSON.parse(baziChartRecord.yearPillar),
        monthPillar: JSON.parse(baziChartRecord.monthPillar),
        dayPillar: JSON.parse(baziChartRecord.dayPillar),
        hourPillar: baziChartRecord.hourPillar ? JSON.parse(baziChartRecord.hourPillar) : undefined,
        dayMaster: baziChartRecord.dayMaster as any,
        element: baziChartRecord.primaryElement as any,
      };

      // Get Thai astrology
      const thaiAstrology = calculateThaiAstrology(profile.birthDate);

      // Calculate current age
      const now = new Date();
      const birthDate = new Date(profile.birthDate);
      const currentAge = now.getFullYear() - birthDate.getFullYear();

      // Generate comprehensive reading with LLM
      const prompt = buildFullChartPrompt(
        'ผู้ใช้', // TODO: Get actual name
        profile.birthDate,
        baziChart,
        thaiAstrology,
        currentAge
      );

      const narrative = await generateFortuneReading(prompt, 1500);

      return {
        baziChart,
        thaiAstrology,
        narrative,
        currentAge,
      };
    } catch (error) {
      console.error('Chart reading error:', error);
      set.status = 500;
      return { error: 'Failed to generate chart reading' };
    }
  })

  // Get full chart reading with streaming (requires auth)
  .get('/chart/stream', async ({ cookie, set, request }) => {
    // Validate session
    const session = await validateSessionFromRequest(request);

    if (!session) {
      set.status = 401;
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Rate limiting for authenticated users (by user ID)
    const rateLimitResult = await checkRateLimit(session.userId, RATE_LIMITS.chart);

    if (rateLimitResult.limited) {
      return new Response(
        JSON.stringify({
          error: 'คำขอมากเกินไป กรุณาลองใหม่อีกครั้งในภายหลัง',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': RATE_LIMITS.chart.maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
            'Retry-After': Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    try {
      const userId = session.userId;

      // Get user's birth profile
      const [profile] = await db
        .select()
        .from(birthProfiles)
        .where(eq(birthProfiles.userId, userId))
        .limit(1);

      if (!profile) {
        return new Response(JSON.stringify({ error: 'Birth profile not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Get or calculate Bazi chart
      let [baziChartRecord] = await db
        .select()
        .from(baziCharts)
        .where(eq(baziCharts.profileId, profile.id))
        .limit(1);

      if (!baziChartRecord) {
        // Calculate and save
        const baziChart = calculateBazi(
          profile.birthDate,
          profile.birthHour || undefined,
          profile.gender as 'male' | 'female'
        );

        [baziChartRecord] = await db
          .insert(baziCharts)
          .values({
            profileId: profile.id,
            yearPillar: JSON.stringify(baziChart.yearPillar),
            monthPillar: JSON.stringify(baziChart.monthPillar),
            dayPillar: JSON.stringify(baziChart.dayPillar),
            hourPillar: baziChart.hourPillar ? JSON.stringify(baziChart.hourPillar) : null,
            dayMaster: baziChart.dayMaster,
            primaryElement: baziChart.element,
            elementStrength: JSON.stringify({}),
          })
          .returning();
      }

      // Parse chart data
      const baziChart: BaziChart = {
        yearPillar: JSON.parse(baziChartRecord.yearPillar),
        monthPillar: JSON.parse(baziChartRecord.monthPillar),
        dayPillar: JSON.parse(baziChartRecord.dayPillar),
        hourPillar: baziChartRecord.hourPillar ? JSON.parse(baziChartRecord.hourPillar) : undefined,
        dayMaster: baziChartRecord.dayMaster as any,
        element: baziChartRecord.primaryElement as any,
      };

      // Get Thai astrology
      const thaiAstrology = calculateThaiAstrology(profile.birthDate);

      // Calculate current age
      const now = new Date();
      const birthDate = new Date(profile.birthDate);
      const currentAge = now.getFullYear() - birthDate.getFullYear();

      // Create a readable stream for Server-Sent Events
      const stream = new ReadableStream({
        async start(controller) {
          try {
            // Send initial data with chart information
            const initialData = {
              type: 'chart',
              data: {
                baziChart,
                thaiAstrology,
                currentAge,
              },
            };
            controller.enqueue(`data: ${JSON.stringify(initialData)}\n\n`);

            // Generate and stream narrative
            const prompt = buildFullChartPrompt(
              'ผู้ใช้',
              profile.birthDate,
              baziChart,
              thaiAstrology,
              currentAge
            );

            for await (const chunk of generateFortuneReadingStream(prompt, 1500)) {
              const chunkData = {
                type: 'narrative',
                data: chunk,
              };
              controller.enqueue(`data: ${JSON.stringify(chunkData)}\n\n`);
            }

            // Send completion event
            controller.enqueue(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            controller.close();
          } catch (error) {
            console.error('Stream error:', error);
            const errorData = {
              type: 'error',
              data: 'Failed to generate fortune reading',
            };
            controller.enqueue(`data: ${JSON.stringify(errorData)}\n\n`);
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-RateLimit-Limit': RATE_LIMITS.chart.maxRequests.toString(),
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
        },
      });
    } catch (error) {
      console.error('Chart stream error:', error);
      return new Response(JSON.stringify({ error: 'Failed to generate chart reading' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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
      const [userProfile] = await db
        .select()
        .from(birthProfiles)
        .where(eq(birthProfiles.userId, userId))
        .limit(1);

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
  });
