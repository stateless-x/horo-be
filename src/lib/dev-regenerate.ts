import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { invalidateCache } from './redis';
import { RATE_LIMITS, resetRateLimit } from './rate-limit';
import { generationKey } from './generation-singleflight';
import { parseCompatibilityContent } from './compatibility-content';
import {
  COMPATIBILITY_V4_LIVE_BUDGET,
  generateCompatibilityV4Stored,
  readerGender,
} from './compatibility-generation';
import { config } from '../config';
import { getCachedProfile } from '../systems/shared';
import { normalizeMbtiType } from '../../lib/astrology';
import { birthProfiles, chartNarratives, compatibility, dailyReadings, user } from '../../lib/db';
import { CompatibilityV4StoredSchema, RelationshipTypeSchema, type RelationshipType } from '../../lib/shared';
import { getTodayBangkokString } from '../../lib/shared/utils/date';

/**
 * Dev-only "regenerate for the logged-in user": rewrites one reading of the
 * signed-in dev user in the database, so the real page shows it. Used by the
 * POST /api/dev/regenerate/* routes in src/routes/dev.ts, which refuse to run
 * unless the database is on this machine (see isLocalDatabaseUrl).
 */

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True only for a parseable URL whose host is this machine. Fails closed on anything else. */
export function isLocalDatabaseUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  return LOCAL_DB_HOSTS.has(new URL(url).hostname);
}

/** A failure with the status the dev route should answer. */
export class DevRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The Redis key GenerationSingleFlight replays a finished generation from for
 * 60s. Mirrors its private flightKeys(); tests/dev-regenerate.test.ts pins the
 * two together. Deleted before a regeneration, or a second click within a
 * minute would replay the old reading and never write the new one.
 */
export function flightResultKey(key: string): string {
  return `generation:result:${createHash('sha256').update(key).digest('hex')}`;
}

/**
 * Clears one rate-limit bucket for one user, in memory and in Redis. The Redis
 * key mirrors rate-limit.ts's private rateLimitKey(), the same format the
 * /api/debug/reset-rate-limit route deletes.
 */
async function resetUserRateLimit(userId: string, limit: Parameters<typeof resetRateLimit>[1]): Promise<void> {
  resetRateLimit(userId, limit);
  await invalidateCache(`ratelimit:${limit.name}:${userId}`);
}

async function requireProfile(userId: string) {
  const profile = await getCachedProfile(userId);
  if (!profile) throw new DevRequestError(404, 'ผู้ใช้นี้ยังไม่มีข้อมูลวันเกิด (ทำ onboarding ก่อน)');
  return profile;
}

/**
 * Calls a real GET route as the same user (their cookie), so it generates and
 * stores the reading exactly as it does for a visitor. Any error becomes a 502
 * that says which route failed and why.
 */
async function triggerRoute(path: string, request: Request): Promise<void> {
  const response = await fetch(new URL(path, request.url), {
    headers: { cookie: request.headers.get('cookie') ?? '' },
  });
  const text = await response.text();
  let failure: string | null = response.ok ? null : `HTTP ${response.status}`;
  if (!failure) {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && 'error' in body) failure = 'error in body';
  }
  if (failure) throw new DevRequestError(502, `${path} ตอบ ${failure}: ${text.slice(0, 300)}`);
}

/** Deletes today's daily reading, then lets GET /api/fortune/daily write a new one. */
export async function regenerateDaily(userId: string, request: Request) {
  const profile = await requireProfile(userId);
  const today = getTodayBangkokString();
  await db.delete(dailyReadings).where(and(eq(dailyReadings.profileId, profile.id), eq(dailyReadings.date, today)));
  await resetUserRateLimit(userId, RATE_LIMITS.daily);
  await invalidateCache(flightResultKey(generationKey('daily', profile.id, today)));
  await triggerRoute('/api/fortune/daily', request);
  return { date: today };
}

/**
 * Clears this month's chart narrative the same way DELETE /chart/regenerate
 * does (bumping the profile's updatedAt gives the generation a new flight key),
 * then lets GET /api/fortune/chart write a new one.
 */
export async function regenerateChart(userId: string, request: Request) {
  const profile = await requireProfile(userId);
  await db.update(birthProfiles).set({ updatedAt: new Date() }).where(eq(birthProfiles.id, profile.id));
  await db.delete(chartNarratives).where(eq(chartNarratives.profileId, profile.id));
  await invalidateCache(`profile:${userId}`, `chart:narrative:${profile.id}`);
  await resetUserRateLimit(userId, RATE_LIMITS.chart);
  await triggerRoute('/api/fortune/chart', request);
  return {};
}

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const DevRegenerateCompatibilitySchema = z.object({
  target: z.discriminatedUnion('type', [
    z.object({ type: z.literal('row'), id: z.string().uuid() }),
    z.object({
      type: z.literal('new'),
      name: z.string().trim().min(1).max(100),
      birthDate: IsoDateSchema,
      mbti: z.string().regex(/^[IE][NS][TF][JP]$/).optional(),
      relationshipType: RelationshipTypeSchema,
    }),
  ]),
});
export type DevRegenerateCompatibility = z.infer<typeof DevRegenerateCompatibilitySchema>;

/** MBTI sits in a full v4 report's people, or in a locked report's input snapshot. */
const StoredPartnerMbtiSchema = z.union([
  z.object({ people: z.object({ partner: z.object({ mbti: z.string().nullable() }) }) }).transform((v) => v.people.partner.mbti),
  z.object({ inputs: z.object({ partner: z.object({ mbti: z.string().nullable() }) }) }).transform((v) => v.inputs.partner.mbti),
]);

/** The partner MBTI a stored reading was written with; null for v1/v2 rows, which never kept it. */
function storedPartnerMbti(analysis: string): string | null {
  if (parseCompatibilityContent(analysis)?.contentVersion !== 4) return null;
  const parsed = StoredPartnerMbtiSchema.safeParse(JSON.parse(analysis));
  return parsed.success ? parsed.data : null;
}

/**
 * Writes a new compatibility reading for the user with the same generation
 * functions and inputs as the live POST /api/fortune/compatibility, then
 * upserts it on (profile, partner birth date, relationship type), so an
 * existing row keeps its id and share token.
 *
 * "full" writes what the live route writes: generateCompatibilityV4Stored with
 * the live budget, the detail included unless locked mode is on
 * (config.compat.lockEnabled), so a locked row can be made from the panel.
 *
 * Partner MBTI is not a column: for an existing row it comes from a stored
 * current report and is unknown for a historical row. A "new" target
 * with the same birth date and relationship replaces that row with any MBTI.
 */
export async function regenerateCompatibility(userId: string, input: DevRegenerateCompatibility, startedAt: number) {
  const profile = await requireProfile(userId);
  const [account] = await db
    .select({ name: user.name, displayName: user.displayName })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const readerName = account?.displayName || account?.name || 'คุณ';

  let partner: { name: string; birthDate: string; mbti: string | null };
  let relationshipType: RelationshipType;
  if (input.target.type === 'row') {
    const [row] = await db
      .select()
      .from(compatibility)
      .where(and(eq(compatibility.id, input.target.id), eq(compatibility.profileAId, profile.id)))
      .limit(1);
    if (!row) throw new DevRequestError(404, 'ไม่พบดวงคู่นี้ในประวัติของผู้ใช้นี้');
    partner = { name: row.partnerName, birthDate: row.partnerBirthDate, mbti: storedPartnerMbti(row.analysis) };
    relationshipType = RelationshipTypeSchema.parse(row.relationshipType);
  } else {
    partner = { name: input.target.name, birthDate: input.target.birthDate, mbti: input.target.mbti ?? null };
    relationshipType = input.target.relationshipType;
  }

  // The live route's inputs, field for field.
  const generationInput = {
    reader: {
      name: readerName,
      birthDate: profile.birthDate,
      birthHour: profile.birthHour ?? undefined,
      gender: readerGender(profile.gender),
      mbtiType: normalizeMbtiType(profile.mbtiType),
    },
    partner: { name: partner.name, birthDate: new Date(partner.birthDate), mbtiType: normalizeMbtiType(partner.mbti) },
    relationshipType,
  };
  const { stored: content, charts, qualityFlags } = await generateCompatibilityV4Stored({
    ...generationInput,
    withDetail: !config.compat.lockEnabled,
    maxRepairs: COMPATIBILITY_V4_LIVE_BUDGET.maxRepairs,
    deadlineAt: startedAt + COMPATIBILITY_V4_LIVE_BUDGET.llmMs,
  });

  const values = {
    partnerName: partner.name,
    score: charts.score.score,
    elementHarmony: charts.score.elementHarmony,
    branchHarmony: charts.score.branchHarmony,
    analysis: JSON.stringify(content),
    strengths: JSON.stringify(charts.score.strengths),
    challenges: JSON.stringify(charts.score.challenges),
    userElement: charts.readerBazi.element,
    userDayMaster: charts.readerBazi.dayMaster,
    partnerElement: charts.partnerBazi.element,
    partnerDayMaster: charts.partnerBazi.dayMaster,
  };
  const [saved] = await db
    .insert(compatibility)
    .values({
      ...values,
      profileAId: profile.id,
      partnerBirthDate: partner.birthDate,
      relationshipType,
      shareToken: Math.random().toString(36).substring(2, 15),
    })
    .onConflictDoUpdate({
      target: [compatibility.profileAId, compatibility.partnerBirthDate, compatibility.relationshipType],
      set: values,
    })
    .returning({ id: compatibility.id });

  await forgetCompatibilityRow(userId, saved.id);

  const locked = content.contentVersion === 4 && content.detail === null;
  return { id: saved.id, partnerName: partner.name, relationshipType, score: values.score, partnerMbti: partner.mbti, locked, qualityFlags };
}

/**
 * Drops what could serve a row's old content: the 24h `compat:` cache of
 * GET /compatibility/:id, and the unlock's 60s single-flight replay, which
 * would otherwise answer an unlock right after a rewrite with the old report
 * and never write the new detail.
 */
async function forgetCompatibilityRow(userId: string, rowId: string): Promise<void> {
  await invalidateCache(`compat:${userId}:${rowId}`, flightResultKey(generationKey('compatibility', 'unlock', rowId)));
}

export const DevRelockCompatibilitySchema = z.object({ id: z.string().uuid() });

/**
 * "ล็อกใหม่": sets a stored v4 row's detail back to null, so the lock and the
 * unlock can be tried again without a new check. Only the two-part stored
 * form can be locked; it keeps the plan and inputs the unlock writes from.
 */
export async function relockCompatibility(userId: string, input: z.infer<typeof DevRelockCompatibilitySchema>) {
  const profile = await requireProfile(userId);
  const [row] = await db
    .select({ id: compatibility.id, analysis: compatibility.analysis })
    .from(compatibility)
    .where(and(eq(compatibility.id, input.id), eq(compatibility.profileAId, profile.id)))
    .limit(1);
  if (!row) throw new DevRequestError(404, 'ไม่พบดวงคู่นี้ในประวัติของผู้ใช้นี้');
  const stored = CompatibilityV4StoredSchema.safeParse(JSON.parse(row.analysis));
  if (!stored.success) {
    throw new DevRequestError(409, 'แถวนี้ไม่ใช่ฉบับเต็มแบบสองส่วน (ไม่มี plan กับ inputs ให้ปลดล็อก) กดสร้างใหม่แบบฉบับเต็มก่อน');
  }
  const { detailGeneratedAt: _dropped, ...rest } = stored.data;
  await db
    .update(compatibility)
    .set({ analysis: JSON.stringify({ ...rest, detail: null }) })
    .where(eq(compatibility.id, row.id));
  await forgetCompatibilityRow(userId, row.id);
  return { id: row.id };
}
