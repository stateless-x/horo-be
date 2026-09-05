import { Elysia } from 'elysia';
import { fortuneRoutes } from './fortune/routes';
import { compatibilityRoutes } from './compatibility/routes';
import { tarotRoutes } from './tarot/routes';
import { contentRoutes } from './content/routes';

/**
 * All fortune-telling systems, mounted together.
 * A new system = a new folder here (see docs/architecture.md) + an entry
 * in this list.
 */
export const systemsRoutes = new Elysia()
  .use(fortuneRoutes)
  .use(compatibilityRoutes)
  .use(tarotRoutes)
  .use(contentRoutes);
