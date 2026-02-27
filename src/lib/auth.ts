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
  // Base path where auth is mounted in the app
  basePath: '/api/auth',
  // Trust proxy headers (needed for production behind reverse proxy)
  trustedOrigins: config.cors.allowedOrigins,
  // Cookie configuration for subdomain OAuth
  // Using SameSite=lax now since we're on the same parent domain
  cookie: {
    name: 'better-auth',
    domain: config.env === 'production' ? '.สายมู.com' : undefined,
    sameSite: 'lax',
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
    // Use database for OAuth state storage instead of cookies
    // This is more reliable for cross-origin scenarios
    storeSessionInDatabase: true,
  },
});
