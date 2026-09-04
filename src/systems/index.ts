import { Elysia } from 'elysia';
import { fusionRoutes } from './fusion/routes';
import { compatibilityRoutes } from './compatibility/routes';

/**
 * All fortune-telling systems, mounted together.
 * A new system = a new folder here (see docs/architecture.md) + an entry
 * in this list.
 */
export const systemsRoutes = new Elysia()
  .use(fusionRoutes)
  .use(compatibilityRoutes);
