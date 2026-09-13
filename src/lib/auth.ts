import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
import { config } from '../config';
import * as schema from '../../lib/db/schema';
import { providerUserFields } from './provider-identity';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  user: {
    additionalFields: {
      onboardingCompleted: { type: "boolean", defaultValue: false, input: false },
      displayName: { type: "string", required: false, input: false },
      providerEmail: { type: "string", required: false, input: false },
      authProvider: { type: "string", required: false, input: false },
    },
  },
  // Dev-only: lets /api/dev/login create and sign in a local dev user
  // without OAuth. Never enabled in production.
  emailAndPassword: {
    enabled: config.env !== 'production',
  },
  socialProviders: {
    google: {
      clientId: config.oauth.google.clientId,
      clientSecret: config.oauth.google.clientSecret,
      redirectURI: `${config.oauth.baseUrl}/api/auth/callback/google`,
      mapProfileToUser: (profile) => providerUserFields('google', profile.sub, profile.email),
    },
    twitter: {
      clientId: config.oauth.twitter.clientId,
      clientSecret: config.oauth.twitter.clientSecret,
      redirectURI: `${config.oauth.baseUrl}/api/auth/callback/twitter`,
      mapProfileToUser: (profile) => providerUserFields('twitter', profile.data.id, profile.data.email),
    },
  },
  baseURL: config.oauth.baseUrl,
  basePath: '/api/auth',
  trustedOrigins: [
    ...config.cors.allowedOrigins,
    ...(config.env === 'production'
      ? ['https://*.สายมู.com', 'https://*.xn--y3cbx6azb.com']
      : []
    ),
  ],
  advanced: {
    useSecureCookies: config.env === 'production',
    // SameSite=None required for OAuth cookies to survive provider redirect chain
    defaultCookieAttributes: {
      sameSite: 'none' as const,
      secure: true,
    },
    crossSubDomainCookies: {
      enabled: false,
      domain: 'xn--y3cbx6azb.com',
    },
  },
  account: {
    accountLinking: {
      enabled: false,
    },
    // Database strategy stores OAuth state in the 'verification' table
    // Cookie strategy was failing due to cross-domain cookie restrictions
    // (frontend on สายมู.com, API on api-horo.up.railway.app)
    storeStateStrategy: 'database',
    // Skip secondary signed-cookie check — fails cross-domain.
    // Database verification alone is sufficient CSRF protection.
    skipStateCookieCheck: true,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
    storeSessionInDatabase: true,
  },
});
