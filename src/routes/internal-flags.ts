import { Elysia, t } from 'elysia';
import { adminSecretMatches } from '../lib/admin-secret';
import { FlagRefused, listFlags, setFlag } from '../lib/feature-flags';

/**
 * Feature flags for horo-admin (src/lib/feature-flags.ts). Service to service:
 * the shared secret proves the caller is horo-admin, which has already checked
 * the human is an admin and passes their email as `actor` for the audit trail.
 * Mounted only when ADMIN_API_SECRET is set (index.ts).
 */
export const internalFlagRoutes = new Elysia({ prefix: '/internal/flags' })
  .onBeforeHandle(({ request, set }) => {
    if (!adminSecretMatches(request.headers.get('x-admin-secret'))) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
  })

  .get('/', async () => ({ flags: await listFlags() }))

  .put(
    '/:key',
    async ({ params, body, set }) => {
      try {
        await setFlag(params.key, body.enabled, body.actor);
      } catch (error) {
        if (!(error instanceof FlagRefused)) throw error;
        set.status = 409;
        return { error: error.message };
      }
      return { flags: await listFlags() };
    },
    { body: t.Object({ enabled: t.Boolean(), actor: t.String({ minLength: 1, maxLength: 255 }) }) },
  );
