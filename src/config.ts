// Log startup for debugging Railway deployments
console.log('[CONFIG] Loading configuration...');
console.log('[CONFIG] PORT:', process.env.PORT);
console.log('[CONFIG] NODE_ENV:', process.env.NODE_ENV);
console.log('[CONFIG] DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');
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

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
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
          const hostname = url.hostname;

          if (idnMappings[hostname]) {
            const alternateHostname = idnMappings[hostname];
            const alternateOrigin = `${url.protocol}//${alternateHostname}${url.port ? ':' + url.port : ''}`;
            allOrigins.add(alternateOrigin);
          }
        } catch {
          // If URL parsing fails, just use the original
        }
      });

      return Array.from(allOrigins);
    })(),
  },
};

// Validate required environment variables (non-blocking)
// Store validation errors but don't throw immediately
const required = [
  'DATABASE_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'TWITTER_CLIENT_ID',
  'TWITTER_CLIENT_SECRET',
  'GEMINI_API_KEY',
];

export const configErrors: string[] = [];

for (const key of required) {
  if (!process.env[key]) {
    const error = `Missing required environment variable: ${key}`;
    console.error(`[CONFIG ERROR] ${error}`);
    configErrors.push(error);
  }
}

// Warn if there are config errors but don't block startup
if (configErrors.length > 0) {
  console.warn('[CONFIG] Server will start but some features may not work due to missing env vars');
  console.warn('[CONFIG] Missing env vars:', configErrors.join(', '));
}
