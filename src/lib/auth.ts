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
 *
 * OAuth State Management:
 * - Uses database for OAuth state persistence (storeStateStrategy: "database")
 * - This prevents state_mismatch errors in cross-origin OAuth flows
 * - OAuth state is stored in the database during the authorization phase
 * - State is validated and cleaned up during the callback phase
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
    // IMPORTANT: Use punycode domain (xn--y3cbx6azb.com) instead of Thai (สายมู.com)
    // Browsers automatically convert Thai domains to punycode, so cookies must use punycode
    // Otherwise, cookie domain won't match and authentication will fail with 401 errors
    //
    // NOTE: crossSubDomainCookies is only needed if frontend and backend are on different subdomains
    // If both are on the same domain (e.g., both on xn--y3cbx6azb.com), this should be disabled
    // to allow browser default cookie behavior (cookies set without explicit domain work better)
    crossSubDomainCookies: {
      enabled: false, // Disabled for now - enable only if using different subdomains
      // Domain in punycode format without leading dot (Better Auth adds it automatically)
      domain: 'xn--y3cbx6azb.com',
    },
  },
  // Account configuration for OAuth
  // CRITICAL: OAuth state management moved to account options in Better Auth v1.4+
  account: {
    // Store OAuth state in database for reliable cross-origin flows
    // Options: "database" | "cookie"
    // - "database": More reliable for cross-origin scenarios, uses database to store state
    // - "cookie": Stores state in cookies, can fail with strict cookie policies
    // We use "database" because:
    // 1. More reliable for production environments with HTTPS
    // 2. Not affected by third-party cookie blocking
    // 3. Works consistently across different browsers and devices
    storeStateStrategy: 'database',
  },
  // Session configuration
  session: {
    // Enable cookie caching for better performance
    // This caches session data in cookies to reduce database queries
    // Note: This is for SESSION data, not OAuth state (which is handled by account.storeStateStrategy)
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
    // Store sessions in database for persistence
    storeSessionInDatabase: true,
  },
});
