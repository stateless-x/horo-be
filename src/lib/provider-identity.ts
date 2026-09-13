import { createHash } from 'node:crypto';

export type AuthProvider = 'google' | 'twitter';

export type ProviderUserFields = {
  email: string;
  providerEmail: string | undefined;
  authProvider: AuthProvider;
};

/**
 * Better Auth uses user.email as its cross-provider lookup key. Give each
 * provider account a stable internal email so Google and X identities never
 * collide even when the providers report the same real email address.
 */
export function providerIdentityEmail(provider: AuthProvider, accountId: string): string {
  if (!accountId.trim()) {
    throw new Error(`Missing ${provider} account ID`);
  }

  const digest = createHash('sha256')
    .update(`${provider}:${accountId}`)
    .digest('hex')
    .slice(0, 32);

  return `${provider}.${digest}@auth.saimu.invalid`;
}

export function normalizeProviderEmail(email?: string | null): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized || undefined;
}

export function providerUserFields(
  provider: AuthProvider,
  accountId: string,
  providerEmail?: string | null,
): ProviderUserFields {
  return {
    email: providerIdentityEmail(provider, accountId),
    providerEmail: normalizeProviderEmail(providerEmail),
    authProvider: provider,
  };
}
