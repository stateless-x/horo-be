import { describe, expect, test } from 'bun:test';
import {
  normalizeProviderEmail,
  providerIdentityEmail,
  providerUserFields,
} from '../src/lib/provider-identity';

describe('provider-scoped identities', () => {
  test('the same provider account always receives the same internal email', () => {
    expect(providerIdentityEmail('google', '123')).toBe(providerIdentityEmail('google', '123'));
  });

  test('Google and X accounts remain separate even when their provider IDs match', () => {
    expect(providerIdentityEmail('google', '123')).not.toBe(providerIdentityEmail('twitter', '123'));
  });

  test('internal identity emails do not expose the provider account ID', () => {
    const identityEmail = providerIdentityEmail('twitter', 'sensitive-provider-id');

    expect(identityEmail).toMatch(/^twitter\.[a-f0-9]{32}@auth\.saimu\.invalid$/);
    expect(identityEmail).not.toContain('sensitive-provider-id');
  });

  test('real provider email is normalized separately for reporting', () => {
    expect(normalizeProviderEmail('  Person@Example.COM ')).toBe('person@example.com');
    expect(normalizeProviderEmail(null)).toBeUndefined();
  });

  test('the same real email maps to independent Google and X users', () => {
    const google = providerUserFields('google', 'google-account', 'Same@Example.com');
    const twitter = providerUserFields('twitter', 'x-account', 'same@example.com');

    expect(google.email).not.toBe(twitter.email);
    expect(google.providerEmail).toBe('same@example.com');
    expect(twitter.providerEmail).toBe('same@example.com');
    expect(google.authProvider).toBe('google');
    expect(twitter.authProvider).toBe('twitter');
  });

  test('a provider without a real email still receives a stable identity', () => {
    expect(providerUserFields('twitter', 'x-without-email', null)).toEqual({
      email: providerIdentityEmail('twitter', 'x-without-email'),
      providerEmail: undefined,
      authProvider: 'twitter',
    });
  });

  test('missing provider account IDs fail instead of collapsing users together', () => {
    expect(() => providerIdentityEmail('google', '')).toThrow('Missing google account ID');
    expect(() => providerIdentityEmail('twitter', '   ')).toThrow('Missing twitter account ID');
  });
});
