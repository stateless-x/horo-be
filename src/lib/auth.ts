import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
import { config } from '../config';
import * as schema from '../../lib/db/schema';

/**
 * Better Auth Configuration
 *
 * Replaces Supabase Auth with Better Auth for simpler architecture.
 * Uses Drizzle adapter to work seamlessly with our existing database.
 *
 * Features:
 * - Google OAuth 2.0
 * - Twitter/X OAuth 2.0
 * - Built-in session management
 * - Automatic database schema generation
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  socialProviders: {
    google: {
      clientId: config.oauth.google.clientId,
      clientSecret: config.oauth.google.clientSecret,
      // Explicit redirect URI for OAuth provider console
      redirectURI: `${config.oauth.baseUrl}/api/auth/callback/google`,
    },
    twitter: {
      clientId: config.oauth.twitter.clientId,
      clientSecret: config.oauth.twitter.clientSecret,
      // Explicit redirect URI for OAuth provider console
      redirectURI: `${config.oauth.baseUrl}/api/auth/callback/twitter`,
    },
  },
  // Base URL for OAuth callbacks (backend)
  baseURL: config.oauth.baseUrl,
  // Base path where auth is mounted in the app
  basePath: '/api/auth',
  // Trust proxy headers (needed for production behind reverse proxy)
  // Include wildcard patterns for subdomain support
  trustedOrigins: [
    ...config.cors.allowedOrigins,
    // Support all subdomains in production
    ...(config.env === 'production'
      ? ['https://*.สายมู.com', 'https://*.xn--y3cbx6azb.com']
      : []
    ),
  ],
  // Advanced configuration for cross-subdomain cookie sharing
  advanced: {
    useSecureCookies: config.env === 'production',
    // Enable cross-subdomain cookies for proper session sharing
    // between api.สายมู.com and สายมู.com
    crossSubDomainCookies: {
      enabled: config.env === 'production',
      // Domain without leading dot (Better Auth adds it automatically)
      domain: 'สายมู.com',
    },
  },
  // Session configuration
  session: {
    // Store session state in database for cross-origin OAuth
    // This prevents state_mismatch errors
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
    // Use database for OAuth state storage instead of cookies
    // This is more reliable for cross-origin scenarios
    storeSessionInDatabase: true,
  },
});
