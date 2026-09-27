import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { compatibility } from '../../../lib/db';
import { invalidateCache } from '../../lib/redis';
import { generationSingleFlight } from '../../lib/generation-singleflight';
import { getCachedProfile } from '../shared';
import { unlockReading, type UnlockResult, type UnlockStore } from './reading';

/** The cache entry GET /compatibility/:id serves a row from. */
export const compatCacheKey = (userId: string, id: string) => `compat:${userId}:${id}`;

/** The unlock's database side: load a row; charge and patch the detail in one transaction. */
export function dbUnlockStore(userId: string): UnlockStore {
  return {
    load: async (id) => {
      const [row] = await db.select().from(compatibility).where(eq(compatibility.id, id)).limit(1);
      return row ?? null;
    },
    saveDetailPaid: async (id, analysis, charge) => {
      const outcome = await db.transaction(async (tx) => {
        const decision = await charge(tx);
        if (!decision.ok) return decision;
        const [row] = await tx.update(compatibility).set({ analysis }).where(eq(compatibility.id, id)).returning();
        return { ok: true as const, row };
      });
      if (outcome.ok) await invalidateCache(compatCacheKey(userId, id));
      return outcome;
    },
  };
}

/**
 * The same atomic unlock the route runs, for a user who is not on the other
 * end of a request: a paid one-flow order unlocks its row this way
 * (src/lib/order-fulfilment.ts). Owner only, idempotent.
 */
export async function unlockForUser(userId: string, rowId: string, requestStartedAt = Date.now()): Promise<UnlockResult> {
  const profile = await getCachedProfile(userId);
  if (!profile) return { status: 404, body: { error: 'User profile not found' } };
  return unlockReading({
    userId,
    profileId: profile.id,
    id: rowId,
    requestStartedAt,
    flight: generationSingleFlight,
    store: dbUnlockStore(userId),
  });
}
