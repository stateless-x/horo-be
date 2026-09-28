import { Elysia } from 'elysia';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { config } from '../config';
import { normalizeMbtiType } from '../../lib/astrology';
import {
  BirthProfileSchema,
  DevCompatibilityRequestSchema,
  shapeCompatibilityView,
  type CompatibilityV4Content,
  type DevCompatibilityOutput,
  type DevCompatibilityRequest,
  type DevGenerateError,
  type DevGenerateResponse,
} from '../../lib/shared';
import { generateCompatibilityV4 } from '../lib/compatibility-generation';
import type { OnModelCall } from '../lib/llm';
import { validateSessionFromRequest } from '../lib/session';
import {
  DevRegenerateCompatibilitySchema,
  DevRelockCompatibilitySchema,
  DevRequestError,
  isLocalDatabaseUrl,
  regenerateChart,
  regenerateCompatibility,
  regenerateDaily,
  relockCompatibility,
} from '../lib/dev-regenerate';
import { generateTeaser } from '../systems/fortune/teaser';

// Dev-only login bypass. Mounted from index.ts only when NODE_ENV !== 'production'
// (and double-guarded here). Visit http://localhost:3001/api/dev/login in the
// browser: it signs in a fixed local dev user (creating it on first use via
// better-auth's email/password flow), sets the session cookie, and redirects to
// the frontend. First visit lands on the birth-profile setup like a real new user.
const DEV_EMAIL = 'dev@saimu.local';
const DEV_PASSWORD = 'saimu-dev-only-4242';
const DEV_NAME = 'Dev หมอดู';

const notFound = () => new Response('Not found', { status: 404 });

interface DevGeneration<TOutput, TContent> {
  output: TOutput;
  content: TContent;
  prompt: string;
  timings: { calcMs: number; llmMs: number };
}

/**
 * One dev generate endpoint: production 404 before anything else (the body is
 * validated here with zod, not by Elysia, so no validation step can answer
 * first), then parse, run, time, and return one envelope.
 *
 * Stateless by construction: `run` gets birth data and a call counter only.
 * No session, database, cache or rate limit, because the local .env points at
 * the production database.
 */
function devGenerator<TInput, TOutput, TContent>(
  schema: z.ZodType<TInput, z.ZodTypeDef, unknown>,
  run: (input: TInput, onModelCall: OnModelCall) => Promise<DevGeneration<TOutput, TContent>>,
) {
  return async ({ body, set }: { body: unknown; set: { status?: number | string } }) => {
    if (config.env === 'production') return notFound();

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: 'Invalid request', detail: parsed.error.message } satisfies DevGenerateError;
    }

    let modelCalls = 0;
    const started = performance.now();
    try {
      const result = await run(parsed.data, () => {
        modelCalls += 1;
      });
      return {
        output: result.output,
        content: result.content,
        prompt: result.prompt,
        promptChars: result.prompt.length,
        outputChars: JSON.stringify(result.content).length,
        modelCalls,
        timings: { ...result.timings, totalMs: Math.round(performance.now() - started) },
      } satisfies DevGenerateResponse<TOutput, TContent>;
    } catch (error) {
      console.error('[Dev] Generation failed:', error);
      set.status = 502;
      return {
        error: 'Generation failed',
        detail: error instanceof Error ? error.message : String(error),
      } satisfies DevGenerateError;
    }
  };
}

const NoBodySchema = z.object({}).passthrough();

/**
 * One dev regenerate endpoint: it WRITES the signed-in user's readings, so
 * the guards run in this order, each before anything else can answer:
 * production 404, then 403 unless DATABASE_URL points at this machine (the
 * local .env.local is the production database), then session 401, then body
 * 400. The database URL is read per request, never cached.
 */
function devWrite<TInput, TResult extends object>(
  schema: z.ZodType<TInput, z.ZodTypeDef, unknown>,
  run: (input: TInput, context: { userId: string; request: Request; startedAt: number }) => Promise<TResult>,
) {
  return async ({ body, request, set }: { body: unknown; request: Request; set: { status?: number | string } }) => {
    if (config.env === 'production') return notFound();

    if (!isLocalDatabaseUrl(config.database.url)) {
      set.status = 403;
      return {
        error: 'Refused: DATABASE_URL is not a local database',
        detail: 'Regenerate writes to the database. Start horo-be with the horo-be-dev-localdb launch config.',
      } satisfies DevGenerateError;
    }

    const session = await validateSessionFromRequest(request);
    if (!session) {
      set.status = 401;
      return { error: 'Not signed in', detail: 'Open /api/dev/login first.' } satisfies DevGenerateError;
    }

    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) {
      set.status = 400;
      return { error: 'Invalid request', detail: parsed.error.message } satisfies DevGenerateError;
    }

    const startedAt = Date.now();
    try {
      const result = await run(parsed.data, { userId: session.userId, request, startedAt });
      return { ...result, totalMs: Date.now() - startedAt };
    } catch (error) {
      console.error('[Dev] Regenerate failed:', error);
      set.status = error instanceof DevRequestError ? error.status : 502;
      return {
        error: 'Regenerate failed',
        detail: error instanceof Error ? error.message : String(error),
      } satisfies DevGenerateError;
    }
  };
}

export const devRoutes = new Elysia({ prefix: '/api/dev' })
  .get('/login', async () => {
    if (config.env === 'production') return notFound();

    const frontend = config.cors.allowedOrigins[0] ?? 'http://localhost:3000';

    const signIn = () =>
      auth.api.signInEmail({
        body: { email: DEV_EMAIL, password: DEV_PASSWORD },
        returnHeaders: true,
      });

    let result;
    try {
      result = await signIn();
    } catch {
      await auth.api.signUpEmail({
        body: { email: DEV_EMAIL, password: DEV_PASSWORD, name: DEV_NAME },
      });
      result = await signIn();
    }

    const headers = new Headers(result.headers);
    headers.set('Location', `${frontend}/dashboard`);
    return new Response(null, { status: 302, headers });
  })

  .post(
    '/generate/compatibility',
    devGenerator<
      DevCompatibilityRequest,
      DevCompatibilityOutput,
      CompatibilityV4Content
    >(
      DevCompatibilityRequestSchema,
      async (request, onModelCall) => {
        const input = {
          reader: {
            name: request.reader.name ?? 'คุณ',
            birthDate: new Date(request.reader.birthDate),
            birthHour: request.reader.birthHour,
            gender: request.reader.gender,
            mbtiType: normalizeMbtiType(request.reader.mbti),
          },
          partner: {
            name: request.partner.name,
            birthDate: new Date(request.partner.birthDate),
            mbtiType: normalizeMbtiType(request.partner.mbti),
          },
          relationshipType: request.relationshipType,
          onModelCall,
        };

        const names = { readerName: request.reader.name ?? null, partnerName: request.partner.name };

        const { content, charts, prompt, timings, qualityFlags } = await generateCompatibilityV4(input);
        const output: DevCompatibilityOutput = {
          score: charts.score.score,
          relationshipType: request.relationshipType,
          ...names,
          structuredContent: shapeCompatibilityView(content, request.view),
          qualityFlags,
        };
        return { output, content, prompt, timings };
      },
    ),
  )

  .post(
    '/generate/teaser',
    devGenerator(BirthProfileSchema, async (profile, onModelCall) => {
      const { result, prompt, timings } = await generateTeaser(profile, onModelCall);
      return { output: result, content: result, prompt, timings };
    }),
  )
  .post(
    '/regenerate/compatibility',
    devWrite(DevRegenerateCompatibilitySchema, (input, { userId, startedAt }) =>
      regenerateCompatibility(userId, input, startedAt),
    ),
  )
  .post(
    '/relock/compatibility',
    devWrite(DevRelockCompatibilitySchema, (input, { userId }) => relockCompatibility(userId, input)),
  )
  .post('/regenerate/daily', devWrite(NoBodySchema, (_input, { userId, request }) => regenerateDaily(userId, request)))
  .post('/regenerate/chart', devWrite(NoBodySchema, (_input, { userId, request }) => regenerateChart(userId, request)));
