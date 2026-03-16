import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
import { config } from '../config';
import * as schema from '../../lib/db/schema';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  socialProviders: {
    google: {
      clientId: config.oauth.google.clientId,
      clientSecret: config.oauth.google.clientSecret,
      redirectURI: `${config.oauth.baseUrl}/api/auth/callback/google`,
    },
    twitter: {
      clientId: config.oauth.twitter.clientId,
      clientSecret: config.oauth.twitter.clientSecret,
      redirectURI: `${config.oauth.baseUrl}/api/auth/callback/twitter`,
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
    // Cookie strategy avoids DB dependency during OAuth flow (database strategy had state_mismatch issues with drizzle-orm@0.37)
    storeStateStrategy: 'cookie',
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
    storeSessionInDatabase: true,
  },
});
