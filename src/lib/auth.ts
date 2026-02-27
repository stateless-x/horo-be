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
    },
    twitter: {
      clientId: config.oauth.twitter.clientId,
      clientSecret: config.oauth.twitter.clientSecret,
    },
  },
  // Base URL for OAuth callbacks (backend)
  baseURL: config.oauth.baseUrl,
  // Trust proxy headers (needed for production behind reverse proxy)
  trustedOrigins: config.cors.allowedOrigins,
  // Cookie configuration for cross-origin OAuth
  // CRITICAL: SameSite=None required for cross-origin auth between domains
  cookie: {
    name: 'better-auth',
    sameSite: config.env === 'production' ? 'none' : 'lax',
    secure: config.env === 'production',
    httpOnly: true,
    path: '/',
  },
  // Cookie security settings
  advanced: {
    useSecureCookies: config.env === 'production',
  },
  // Session configuration
  session: {
    // Store session state in database for cross-origin OAuth
    // This prevents state_mismatch errors
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
});
