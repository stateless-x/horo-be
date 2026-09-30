import type { compatibility } from '../../../lib/db';
import { RelationshipTypeSchema, shapeCompatibilityView, shareCompatibilityV4, spaceLatinNames, type CompatibilityV4Stored } from '../../../lib/shared';
import { isCurrentCompatibility, parseCompatibilityContent } from '../../lib/compatibility-content';
import { COMPATIBILITY_V4_LIVE_BUDGET, generateCompatibilityV4Detail } from '../../lib/compatibility-generation';
import { mapStrings } from '../../lib/compatibility-text';
import { chargeUnlockWithin, checkUnlock, type UnlockDecision, type UnlockWallet } from '../../lib/entitlements';
import type { WalletTx } from '../../lib/wallet';
import type { InsufficientBalanceBody } from '../../../lib/shared/types/wallet';
import { generationKey, type GenerationSingleFlight } from '../../lib/generation-singleflight';

/**
 * What a client may see of a stored compatibility row, and the unlock of a
 * locked report. Every response that carries a reading is built here, so a
 * locked report's detail, its insight plan and its input snapshot never leave
 * through one route and not another.
 */

export type CompatibilityRow = typeof compatibility.$inferSelect;

/** A current row whose detail is not written yet. Locked is a property of the row, not of the flag. */
function lockedStored(row: Pick<CompatibilityRow, 'id' | 'analysis' | 'contentVersion'>): CompatibilityV4Stored | null {
  const content = parseCompatibilityContent(row);
  return content.detail === null ? content : null;
}

/**
 * Report text with a Latin or digit name spaced from the Thai around it. New rows
 * are stored spaced (polish in compatibility-generation); this covers rows
 * written before that, and is a no-op on the rest.
 */
function spaceNames<T>(value: T, row: CompatibilityRow, readerName: string | undefined): T {
  return mapStrings(value, (text) => spaceLatinNames(text, [row.partnerName, readerName]));
}

/**
 * The owner's view of one reading (POST, GET :id, unlock). Only current rows
 * reach here: every query filters on content_version 4, so a legacy row is a 404
 * before this runs. No `analysis`: the stored JSON holds the insight plan and
 * the input snapshot, MBTI included, and none of it leaves the server.
 */
export function readingResponse(row: CompatibilityRow) {
  const content = parseCompatibilityContent(row);
  const locked = content.detail === null;
  return {
    id: row.id,
    profileAId: row.profileAId,
    partnerName: row.partnerName,
    partnerBirthDate: row.partnerBirthDate,
    relationshipType: row.relationshipType,
    score: row.score,
    userElement: row.userElement,
    userDayMaster: row.userDayMaster,
    partnerElement: row.partnerElement,
    partnerDayMaster: row.partnerDayMaster,
    shareToken: row.shareToken,
    createdAt: row.createdAt.toISOString(),
    contentVersion: 4 as const,
    locked,
    structuredContent: spaceNames(shapeCompatibilityView(content, locked ? 'teaser' : 'full'), row, content.inputs.reader.name),
  };
}

/** The public share link: no session, the free fields only, locked or not. No profileAId for privacy. */
export function shareResponse(row: CompatibilityRow) {
  const content = parseCompatibilityContent(row);
  return {
    partnerName: row.partnerName,
    relationshipType: row.relationshipType,
    score: row.score,
    contentVersion: 4 as const,
    structuredContent: spaceNames(shareCompatibilityV4(content.teaser), row, content.inputs.reader.name),
    userElement: row.userElement,
    partnerElement: row.partnerElement,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One history list entry: names, score and elements, never reading text. */
export function historyItem(row: Pick<CompatibilityRow, 'id' | 'partnerName' | 'partnerBirthDate' | 'relationshipType' | 'score' | 'userElement' | 'partnerElement' | 'createdAt' | 'analysis' | 'contentVersion'>) {
  return {
    id: row.id,
    partnerName: row.partnerName,
    partnerBirthDate: row.partnerBirthDate,
    relationshipType: row.relationshipType,
    score: row.score,
    userElement: row.userElement,
    partnerElement: row.partnerElement,
    locked: lockedStored(row) !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface UnlockStore {
  load(id: string): Promise<CompatibilityRow | null>;
  /**
   * One transaction: `charge(tx)` first, then the row's analysis, written only
   * if the charge went through. Returns the updated row (its cached copy
   * dropped after commit), or the refusal, with nothing written or charged.
   */
  saveDetailPaid(
    id: string,
    analysis: string,
    charge: (tx: WalletTx) => Promise<UnlockDecision>,
  ): Promise<{ ok: true; row: CompatibilityRow } | Extract<UnlockDecision, { ok: false }>>;
}

export type UnlockResult =
  | { status: 200; body: ReturnType<typeof readingResponse> }
  | { status: 402; body: InsufficientBalanceBody }
  | { status: 404; body: { error: string } };

/**
 * Unlock a locked report: write its detail from the stored insight plan and
 * patch it into the same row. Owner only. Idempotent: an unlocked row (or any
 * row that is not locked) comes back as it is, with no model call
 * and no wallet access. One generation per row across concurrent taps and
 * processes (the single-flight lock; a waiter gets the owner's result).
 *
 * Paid with delivery (docs/wallet.md): checkUnlock (read-only) → 402 before any
 * model call; then the detail is generated; then one transaction charges the
 * row once and patches the detail. A generation that throws has charged
 * nothing. A balance spent elsewhere meanwhile makes the charge refuse: the
 * detail is discarded and the answer is 402.
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
  /** The app wallet unless a test passes its own. */
  wallet?: UnlockWallet;
}): Promise<UnlockResult> {
  const { userId, profileId, id, store } = args;
  const notFound = { status: 404, body: { error: 'Compatibility reading not found' } } as const;
  const row = await store.load(id);
  if (!row || row.profileAId !== profileId || !isCurrentCompatibility(row)) return notFound;
  if (!lockedStored(row)) return { status: 200, body: readingResponse(row) };

  const decision = await checkUnlock(userId, id, args.wallet);
  if (!decision.ok) return { status: 402, body: decision.body };

  const flight = await args.flight.run<UnlockResult>({
    operation: 'compatibility',
    key: generationKey('compatibility', 'unlock', id),
    lockTtlMs: 300_000,
    waitTimeoutMs: 250_000,
    // A refusal is not replayed for long: the reader may top up and tap again.
    resultTtlSeconds: (value) => (value.status === 200 ? 60 : 1),
    run: async () => {
      // Re-read inside the lock: another process may have written the detail since.
      const current = await store.load(id);
      if (!current) throw new Error(`Compatibility ${id} disappeared during unlock`);
      const stored = lockedStored(current);
      if (!stored) return { status: 200, body: readingResponse(current) };
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
      const saved = await store.saveDetailPaid(id, JSON.stringify(unlocked), (tx) => chargeUnlockWithin(tx, userId, id, args.wallet));
      if (!saved.ok) {
        console.warn('[compatibility v4] unlock refused at charge; detail discarded', { id, body: saved.body });
        return { status: 402, body: saved.body };
      }
      return { status: 200, body: readingResponse(saved.row) };
    },
  });
  return flight.value;
}
