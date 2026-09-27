import type { compatibility } from '../../../lib/db';
import { RelationshipTypeSchema, shapeCompatibilityView, shareCompatibilityV4, type CompatibilityV4Stored } from '../../../lib/shared';
import { parseCompatibilityContent } from '../../lib/compatibility-content';
import { COMPATIBILITY_V4_LIVE_BUDGET, generateCompatibilityV4Detail } from '../../lib/compatibility-generation';
import { assertCanUnlock } from '../../lib/entitlements';
import type { InsufficientBalanceBody } from '../../../lib/shared/types/wallet';
import { generationKey, type GenerationSingleFlight } from '../../lib/generation-singleflight';

/**
 * What a client may see of a stored compatibility row, and the unlock of a
 * locked v4 report. Every response that carries a reading is built here, so a
 * locked report's detail, its insight plan and its input snapshot never leave
 * through one route and not another.
 */

export type CompatibilityRow = typeof compatibility.$inferSelect;

/** A v4 row whose detail is not written yet. Locked is a property of the row, not of the flag. */
function lockedStored(analysis: string): CompatibilityV4Stored | null {
  const content = parseCompatibilityContent(analysis);
  return content?.contentVersion === 4 && 'inputs' in content && content.detail === null ? content : null;
}

/** The owner's view of one reading (POST, GET :id, unlock). */
export function readingResponse(row: CompatibilityRow) {
  const content = parseCompatibilityContent(row.analysis);
  const base = {
    id: row.id,
    profileAId: row.profileAId,
    partnerName: row.partnerName,
    partnerBirthDate: row.partnerBirthDate,
    relationshipType: row.relationshipType,
    score: row.score,
    elementHarmony: row.elementHarmony,
    branchHarmony: row.branchHarmony,
    strengths: row.strengths ? (JSON.parse(row.strengths) as string[]) : [],
    challenges: row.challenges ? (JSON.parse(row.challenges) as string[]) : [],
    userElement: row.userElement,
    userDayMaster: row.userDayMaster,
    partnerElement: row.partnerElement,
    partnerDayMaster: row.partnerDayMaster,
    shareToken: row.shareToken,
    createdAt: row.createdAt.toISOString(),
  };
  if (content?.contentVersion === 4) {
    // No `analysis` for v4: the stored JSON holds the insight plan and the input snapshot.
    const locked = 'inputs' in content && content.detail === null;
    return { ...base, contentVersion: 4, locked, structuredContent: shapeCompatibilityView(content, locked ? 'teaser' : 'full') };
  }
  return { ...base, analysis: row.analysis, contentVersion: content?.contentVersion ?? 1, structuredContent: content, locked: false };
}

/** The public share link: no session. v4 shows the free fields only, locked or not. */
export function shareResponse(row: CompatibilityRow) {
  const content = parseCompatibilityContent(row.analysis);
  if (content?.contentVersion === 4) {
    return {
      partnerName: row.partnerName,
      relationshipType: row.relationshipType,
      score: row.score,
      contentVersion: 4,
      structuredContent: shareCompatibilityV4('inputs' in content ? content.teaser : content),
      userElement: row.userElement,
      partnerElement: row.partnerElement,
      createdAt: row.createdAt.toISOString(),
    };
  }
  // v2 rows keep today's response (their text was never paid). No profileAId for privacy.
  return {
    partnerName: row.partnerName,
    relationshipType: row.relationshipType,
    score: row.score,
    analysis: row.analysis,
    contentVersion: content?.contentVersion ?? 1,
    structuredContent: content,
    strengths: row.strengths ? (JSON.parse(row.strengths) as string[]) : [],
    challenges: row.challenges ? (JSON.parse(row.challenges) as string[]) : [],
    userElement: row.userElement,
    partnerElement: row.partnerElement,
    userDayMaster: row.userDayMaster,
    partnerDayMaster: row.partnerDayMaster,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One history list entry: names, score and elements, never reading text. */
export function historyItem(row: Pick<CompatibilityRow, 'id' | 'partnerName' | 'partnerBirthDate' | 'relationshipType' | 'score' | 'userElement' | 'partnerElement' | 'createdAt'>) {
  return {
    id: row.id,
    partnerName: row.partnerName,
    partnerBirthDate: row.partnerBirthDate,
    relationshipType: row.relationshipType,
    score: row.score,
    userElement: row.userElement,
    partnerElement: row.partnerElement,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface UnlockStore {
  load(id: string): Promise<CompatibilityRow | null>;
  /** Writes the row's analysis (and drops its cached copy); returns the updated row. */
  saveAnalysis(id: string, analysis: string): Promise<CompatibilityRow>;
}

export type UnlockResult =
  | { status: 200; body: ReturnType<typeof readingResponse> }
  | { status: 402; body: InsufficientBalanceBody }
  | { status: 404; body: { error: string } };

/**
 * Unlock a locked v4 report: write its detail from the stored insight plan and
 * patch it into the same row. Owner only. Idempotent: an unlocked row (or any
 * row that is not a locked v4 report) comes back as it is, with no model call
 * and no entitlement check. One generation per row across concurrent taps and
 * processes (the single-flight lock; a waiter gets the owner's result).
 *
 * Deadline: the same arithmetic as the POST route (docs/compatibility-response-fix.md,
 * "v4 live budget"): every model call ends by requestStartedAt + 220 s, so the
 * response fits the 255 s server idle and 270 s client timeouts.
 */
export async function unlockReading(args: {
  userId: string;
  profileId: string;
  id: string;
  requestStartedAt: number;
  store: UnlockStore;
  flight: GenerationSingleFlight;
}): Promise<UnlockResult> {
  const { userId, profileId, id, store } = args;
  const notFound = { status: 404, body: { error: 'Compatibility reading not found' } } as const;
  const row = await store.load(id);
  if (!row || row.profileAId !== profileId) return notFound;
  if (!lockedStored(row.analysis)) return { status: 200, body: readingResponse(row) };

  const decision = await assertCanUnlock(userId, id);
  if (!decision.ok) return { status: 402, body: decision.body };

  const flight = await args.flight.run({
    operation: 'compatibility',
    key: generationKey('compatibility', 'unlock', id),
    lockTtlMs: 300_000,
    waitTimeoutMs: 250_000,
    resultTtlSeconds: 60,
    run: async () => {
      // Re-read inside the lock: another process may have written the detail since.
      const current = await store.load(id);
      if (!current) throw new Error(`Compatibility ${id} disappeared during unlock`);
      const stored = lockedStored(current.analysis);
      if (!stored) return readingResponse(current);
      const generation = await generateCompatibilityV4Detail(stored, {
        partner: { name: current.partnerName },
        relationshipType: RelationshipTypeSchema.parse(current.relationshipType),
        maxRepairs: COMPATIBILITY_V4_LIVE_BUDGET.maxRepairs,
        deadlineAt: args.requestStartedAt + COMPATIBILITY_V4_LIVE_BUDGET.llmMs,
      });
      if (generation.qualityFlags.length) {
        console.warn('[compatibility v4] quality flags', { flags: generation.qualityFlags });
      }
      console.log('[compatibility v4] detail written', { id, timings: generation.timings });
      const unlocked: CompatibilityV4Stored = { ...stored, detail: generation.detail, detailGeneratedAt: new Date().toISOString() };
      return readingResponse(await store.saveAnalysis(id, JSON.stringify(unlocked)));
    },
  });
  return { status: 200, body: flight.value };
}
