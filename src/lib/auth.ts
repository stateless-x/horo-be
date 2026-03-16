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
 * - Uses cookie strategy for OAuth state persistence (storeStateStrategy: "cookie")
 * - The OAuth state (callbackURL, codeVerifier, etc.) is AES-256 encrypted and stored
 *   in an "oauth_state" cookie on the backend domain during sign-in initiation.
 * - When Google/Twitter redirects back to the callback URL, the browser sends this
 *   cookie automatically and better-auth decrypts + validates it.
 *
 * Why cookie strategy (not database):
 * - The database strategy depends on drizzle-orm for verification table reads/writes.
 *   Our installed drizzle-orm@0.37 is below better-auth 1.4.x's required >=0.41, which
 *   caused silent failures where the verification row was written but could not be found
 *   on callback, producing "State mismatch: verification not found" errors.
 * - The cookie strategy has zero database dependency during the OAuth flow.
 * - With sameSite: 'none' + secure: true, the oauth_state cookie is sent back on both
 *   GET callbacks (Google) and POST callbacks (Twitter/X), satisfying both providers.
 * - The state data is encrypted with the BETTER_AUTH_SECRET, so it cannot be forged.
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
  // Advanced configuration for cross-origin cookie handling
  advanced: {
    useSecureCookies: config.env === 'production',
    // CRITICAL: SameSite=None is required for OAuth state cookies to survive the
    // provider redirect chain. Without it:
    // - Google (GET callback): SameSite=Lax would work, but Twitter/X would not
    // - Twitter/X (POST callback): SameSite=Lax blocks the cookie entirely
    //
    // SameSite=None allows the oauth_state cookie (set on backend domain during sign-in)
    // to be sent back when the provider redirects the browser to the backend callback URL.
    //
    // SameSite=None requires Secure=true (enforced by useSecureCookies in production).
    //
    // References:
    // - https://github.com/better-auth/better-auth/issues/5243
    // - https://github.com/better-auth/better-auth/issues/7023
    defaultCookieAttributes: {
      sameSite: 'none' as const,
      secure: true,
    },
    // crossSubDomainCookies disabled: frontend and backend are on different domains entirely
    // (สายมู.com vs Railway), not subdomains of the same parent domain.
    // Enabling this would require matching domains and would not help here.
    crossSubDomainCookies: {
      enabled: false,
      domain: 'xn--y3cbx6azb.com',
    },
  },
  // Account configuration for OAuth state management
  account: {
    // Use cookie strategy for OAuth state storage.
    //
    // The "cookie" strategy encrypts the full OAuth state (callbackURL, codeVerifier,
    // expiresAt, etc.) with AES-256 using BETTER_AUTH_SECRET and stores it in an
    // "oauth_state" cookie on the backend domain. No database reads/writes are needed
    // during the OAuth flow itself.
    //
    // The "database" strategy was previously used but caused intermittent
    // "State mismatch: verification not found" failures. Root cause: drizzle-orm@0.37
    // does not meet the >=0.41 peer dependency required by better-auth 1.4.x, which
    // caused silent DB write/read failures for the verification table.
    //
    // The cookie strategy is fully sufficient for CSRF protection: the state is encrypted
    // and signed, and cannot be forged without the server secret.
    storeStateStrategy: 'cookie',
  },
  // Session configuration
  session: {
    // Cache session data in a cookie to reduce database round-trips on every request.
    // This is for SESSION data only — not related to OAuth state above.
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
    // Persist sessions in the database (survives server restarts)
    storeSessionInDatabase: true,
  },
});
