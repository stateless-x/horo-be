// Log startup for debugging Railway deployments
console.log('[CONFIG] Loading configuration...');
console.log('[CONFIG] PORT:', process.env.PORT);
console.log('[CONFIG] NODE_ENV:', process.env.NODE_ENV);
console.log('[CONFIG] DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');
console.log('[CONFIG] OAUTH_BASE_URL:', process.env.OAUTH_BASE_URL || 'NOT SET (using default)');
console.log('[CONFIG] CORS_ALLOWED_ORIGINS:', process.env.CORS_ALLOWED_ORIGINS || 'NOT SET (using default)');

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  env: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL || '',
  },

  oauth: {
    baseUrl: process.env.OAUTH_BASE_URL || 'http://localhost:3001',
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    },
    twitter: {
      clientId: process.env.TWITTER_CLIENT_ID || '',
      clientSecret: process.env.TWITTER_CLIENT_SECRET || '',
    },
  },

  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },

  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:3000',
  },

  cors: {
    allowedOrigins: (() => {
      const origins = process.env.CORS_ALLOWED_ORIGINS
        ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
        : ['http://localhost:3000'];

      // Expand origins to include punycode versions
      // Browsers convert international domain names (IDN) to punycode in Origin headers
      // E.g., https://สายมู.com becomes https://xn--y3cbx6azb.com
      const allOrigins = new Set<string>();

      // Known IDN mappings (add more as needed)
      const idnMappings: Record<string, string> = {
        'สายมู.com': 'xn--y3cbx6azb.com',
        'xn--y3cbx6azb.com': 'สายมู.com',
      };

      origins.forEach(origin => {
        allOrigins.add(origin);

        // Extract hostname and check if it has an IDN mapping
        try {
          const url = new URL(origin);
          const hostname = url.hostname; // This is already in punycode

          // Check mapping for the parsed hostname (which is punycode)
          if (idnMappings[hostname]) {
            const alternateHostname = idnMappings[hostname];
            const alternateOrigin = `${url.protocol}//${alternateHostname}${url.port ? ':' + url.port : ''}`;
            allOrigins.add(alternateOrigin);
          }

          // Also check if the original origin string contains Thai characters
          // If it does, the URL parser converted it to punycode, so we need to add the Thai version
          const originalHostnameMatch = origin.match(/:\/\/([^/:]+)/);
          if (originalHostnameMatch) {
            const originalHostname = originalHostnameMatch[1];
            // If original hostname has non-ASCII chars and differs from parsed hostname
            if (originalHostname !== hostname && /[^\x00-\x7F]/.test(originalHostname)) {
              // Original had Thai chars, parsed version is punycode
              // Add the Thai version since it's not already there
              allOrigins.add(origin);
              // And add the punycode version explicitly
              const punycodeOrigin = `${url.protocol}//${hostname}${url.port ? ':' + url.port : ''}`;
              allOrigins.add(punycodeOrigin);
            }
          }
        } catch {
          // If URL parsing fails, just use the original
        }
      });

      return Array.from(allOrigins);
    })(),
  },

  /**
   * Rate Limiting Configuration
   *
   * Protects LLM endpoints from spam and abuse
   * - IP-based limits for public endpoints (e.g., /fortune/teaser)
   * - User-based limits for authenticated endpoints
   * - Configurable via environment variables for production tuning
   *
   * Current limits (per hour):
   * - Teaser (public): 3 requests per IP
   * - Daily reading: 5 requests per user
   * - Chart reading: 3 requests per user
   * - Compatibility: 5 requests per user
   */
  rateLimit: {
    teaser: {
      windowMs: parseInt(process.env.RATE_LIMIT_TEASER_WINDOW_MS || '3600000'), // 1 hour
      maxRequests: parseInt(process.env.RATE_LIMIT_TEASER_MAX || '3'),
    },
    daily: {
      windowMs: parseInt(process.env.RATE_LIMIT_DAILY_WINDOW_MS || '3600000'), // 1 hour
      maxRequests: parseInt(process.env.RATE_LIMIT_DAILY_MAX || '5'),
    },
    chart: {
      windowMs: parseInt(process.env.RATE_LIMIT_CHART_WINDOW_MS || '3600000'), // 1 hour
      maxRequests: parseInt(process.env.RATE_LIMIT_CHART_MAX || '3'),
    },
    compatibility: {
      windowMs: parseInt(process.env.RATE_LIMIT_COMPAT_WINDOW_MS || '3600000'), // 1 hour
      maxRequests: parseInt(process.env.RATE_LIMIT_COMPAT_MAX || '5'),
    },
  },
};

// Validate required environment variables (non-blocking)
// Store validation errors but don't throw immediately
//
// IMPORTANT: `configErrors` gates whether auth + all routes mount at all
// (see src/index.ts). A var for an unrelated feature (e.g. the LLM
// provider key) must NOT be added here — doing so once already took down
// the entire /api/auth/* mount in production (missing GEMINI_API_KEY
// silently 404'd sign-in, tarot/status, and every other route) because the
// LLM key and the auth-mount gate were coupled through this one list.
// Feature-specific requirements (e.g. DEEPSEEK_API_KEY) belong in their
// own list below (`llmRequired`) and must never contribute to
// `configErrors`.
//
// NOTE — this only decouples the LLM key. The vars below are still one
// list gating one all-or-nothing mount: e.g. a missing TWITTER_CLIENT_ID
// alone still unmounts Google login, onboarding, and every fortune route
// too, not just Twitter sign-in. Fixing that would mean mounting auth
// whenever DATABASE_URL is present and letting better-auth's own
// per-provider check handle a missing OAuth pair — a larger change to the
// mount gate in src/index.ts that's out of scope here.
const authRequired = [
  'DATABASE_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'TWITTER_CLIENT_ID',
  'TWITTER_CLIENT_SECRET',
];

// Vars required only for LLM-backed fortune-reading routes (src/lib/llm.ts).
// Missing these must degrade that feature only — never take down auth.
const llmRequired = [
  'DEEPSEEK_API_KEY',
];

export const configErrors: string[] = [];

for (const key of authRequired) {
  if (!process.env[key]) {
    const error = `Missing required environment variable: ${key}`;
    console.error(`[CONFIG ERROR] ${error}`);
    configErrors.push(error);
  }
}

// Fail loudly: these vars gate the entire auth + route mount (see
// src/index.ts). This must never be a silent console.warn again — a
// missing var here means login is completely broken in production.
if (configErrors.length > 0) {
  console.error('[CONFIG ERROR] ==========================================');
  console.error('[CONFIG ERROR] AUTH AND ALL API ROUTES WILL NOT MOUNT.');
  console.error('[CONFIG ERROR] Missing env vars:', configErrors.join(', '));
  console.error('[CONFIG ERROR] Set these in Railway and redeploy.');
  console.error('[CONFIG ERROR] ==========================================');
}

export const llmConfigErrors: string[] = [];

for (const key of llmRequired) {
  if (!process.env[key]) {
    const error = `Missing required environment variable: ${key}`;
    console.error(`[CONFIG ERROR] ${error}`);
    llmConfigErrors.push(error);
  }
}

if (llmConfigErrors.length > 0) {
  console.warn('[CONFIG] LLM-backed fortune-reading routes will fail: missing', llmConfigErrors.join(', '));
}
