import { db } from '../lib/db';
import { birthProfiles } from '../../lib/db';
import { eq } from 'drizzle-orm';
import { cache } from '../lib/redis';

/**
 * Get birth profile with Redis caching (1 hour TTL).
 * Invalidated when profile is created or updated.
 *
 * Used by both the fusion system (daily/chart/user-profile/update-profile)
 * and the compatibility system (compatibility create/history/get) — the
 * only helper genuinely shared across systems.
 */
export async function getCachedProfile(userId: string) {
  return cache(`profile:${userId}`, 3600, async () => {
    const [profile] = await db
      .select()
      .from(birthProfiles)
      .where(eq(birthProfiles.userId, userId))
      .limit(1);
    return profile ?? null;
  });
}
