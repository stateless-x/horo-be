import { Elysia } from 'elysia';
import { getLoadingLines, isLoadingSurface, LOADING_SURFACES } from '../../../lib/content/loading-lines';
import { cache, invalidateCache } from '../../lib/redis';
import type { LoadingLinesResponse } from '../../../lib/content/loading-lines';

/**
 * Static content served to loading screens.
 *
 * Deliberately unauthenticated: a loading screen renders before or while the
 * session resolves, so an auth round trip here would defeat the point of the
 * feature. The payload is identical for every user, which is why the cache key
 * carries no user id.
 */

const CACHE_TTL_SECONDS = 86_400;

function cacheKey(surface: string): string {
  return `loading-lines:v1:${surface}`;
}

/**
 * Drop every cached surface. Call this after editing lib/content/loading-lines.ts
 * if a running instance must pick the new copy up before the TTL expires.
 */
export async function invalidateLoadingLines(): Promise<void> {
  await invalidateCache(...LOADING_SURFACES.map(cacheKey));
}

export const contentRoutes = new Elysia({ prefix: '/api/loading-lines' })

  .get('/:surface', async ({ params: { surface }, set }) => {
    if (!isLoadingSurface(surface)) {
      set.status = 404;
      return { error: 'Unknown loading surface' };
    }

    // Redis is not protecting an expensive read here (the source is a static
    // module). It gives a multi-instance deploy one shared copy and one place
    // to invalidate when the content module changes.
    const payload = await cache<LoadingLinesResponse>(
      cacheKey(surface),
      CACHE_TTL_SECONDS,
      async () => getLoadingLines(surface)
    );

    // Assigned one key at a time rather than spread over set.headers: spreading
    // re-widens 'set-cookie' to string | string[], which does not fit Elysia's
    // HTTPHeaders index signature. Mutating in place also leaves CORS untouched.
    set.headers['Cache-Control'] = 'public, max-age=3600, stale-while-revalidate=86400';

    return payload;
  });
