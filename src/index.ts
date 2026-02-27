import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { config, configErrors } from './config';
import { getRedisClient } from './lib/redis';

console.log('[STARTUP] Starting Horo API...');
console.log('[STARTUP] Attempting to listen on port:', config.port);
console.log('[STARTUP] CORS allowed origins:');
config.cors.allowedOrigins.forEach(origin => console.log('[STARTUP]   -', origin));

// Initialize Redis for distributed rate limiting
console.log('[STARTUP] Initializing Redis...');
const redis = getRedisClient();
if (redis) {
  console.log('[STARTUP] ✓ Redis initialized for distributed rate limiting');
} else {
  console.log('[STARTUP] ⚠ Redis not available, using in-memory rate limiting');
}

// Import auth and routes lazily to avoid blocking on database connection
let auth: any;
let fortuneRoutes: any;
let inviteRoutes: any;
let onboardingRoutes: any;

const app = new Elysia()
  .use(cors({
    origin: config.cors.allowedOrigins,
    credentials: true,
  }))
  // NOTE: Cookie middleware removed - Better Auth manages its own cookies
  // The Elysia cookie middleware was interfering with Better Auth's cookie settings,
  // causing authentication failures due to domain mismatch
  .get('/', () => ({
    message: 'Horo API',
    version: '0.1.0',
    status: configErrors.length > 0 ? 'degraded' : 'ok',
    configErrors: configErrors.length > 0 ? configErrors : undefined,
  }))
  .get('/health', () => {
    // Health check always returns 200 to pass Railway checks
    // but indicates if there are configuration issues
    const isHealthy = configErrors.length === 0;
    return {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      port: config.port,
      issues: configErrors.length > 0 ? configErrors : undefined,
    };
  })
  .onError(({ error, code }) => {
    console.error('[ERROR]', code, error);
    return {
      error: error instanceof Error ? error.message : 'Internal server error',
      code,
    };
  });

// Only load auth and routes if config is valid
if (configErrors.length === 0) {
  console.log('[STARTUP] Loading auth and routes...');
  try {
    const authModule = await import('./lib/auth');
    auth = authModule.auth;

    const fortuneModule = await import('./routes/fortune');
    fortuneRoutes = fortuneModule.fortuneRoutes;

    const inviteModule = await import('./routes/invite');
    inviteRoutes = inviteModule.inviteRoutes;

    const onboardingModule = await import('./routes/onboarding');
    onboardingRoutes = onboardingModule.onboardingRoutes;

    app
      .all('/api/auth/*', async ({ request, set }) => {
        // Debug logging for OAuth requests
        const url = new URL(request.url);
        console.log('[AUTH]', request.method, url.pathname);
        console.log('[AUTH] Headers:', Object.fromEntries(request.headers.entries()));

        const response = await auth.handler(request);

        // Debug logging for OAuth responses
        console.log('[AUTH] Response status:', response.status);
        console.log('[AUTH] Response headers:', Object.fromEntries(response.headers.entries()));

        return response;
      })
      // Debug endpoint to test session validation
      .get('/api/debug/session', async ({ request, set }) => {
        const { validateSessionFromRequest } = await import('./lib/session');
        const session = await validateSessionFromRequest(request);

        if (!session) {
          set.status = 401;
          return {
            authenticated: false,
            message: 'No valid session found',
            cookieHeader: request.headers.get('cookie')?.substring(0, 50) + '...' || 'No cookie header'
          };
        }

        return {
          authenticated: true,
          userId: session.userId,
          expiresAt: session.expiresAt,
        };
      })
      .use(fortuneRoutes)
      .use(inviteRoutes)
      .use(onboardingRoutes);

    console.log('[STARTUP] Auth and routes loaded successfully');
  } catch (error) {
    console.error('[STARTUP ERROR] Failed to load auth/routes:', error);
    console.error('[STARTUP] Server will run in degraded mode (health check only)');
  }
} else {
  console.warn('[STARTUP] Skipping auth/routes due to config errors');
  console.warn('[STARTUP] Server running in degraded mode (health check only)');
}

try {
  app.listen(config.port);
  console.log('[STARTUP] ✓ Server started successfully');
  console.log(`[STARTUP] 🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
  console.log('[STARTUP] Health check endpoint: /health');
} catch (error) {
  console.error('[STARTUP ERROR] Failed to start server:', error);
  process.exit(1);
}

export type App = typeof app;
