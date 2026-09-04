import { Elysia } from 'elysia';

/**
 * Tarot system: disabled skeleton proving the "new system = a folder +
 * a registry line" seam (see docs/architecture.md). No reading logic yet —
 * just a status endpoint the frontend registry can point at.
 */
export const tarotRoutes = new Elysia({ prefix: '/api/tarot' })

  .get('/status', () => {
    return { system: 'tarot', enabled: false };
  });
