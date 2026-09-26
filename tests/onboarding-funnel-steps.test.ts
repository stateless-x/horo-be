import { describe, expect, test } from 'bun:test';
import { ONBOARDING_FUNNEL_STEPS, isOnboardingFunnelStep } from '../lib/shared/types/analytics';

describe('ONBOARDING_FUNNEL_STEPS', () => {
  test('has the exact steps and order the frontend copy must match', () => {
    expect(ONBOARDING_FUNNEL_STEPS).toEqual([
      'welcome',
      'name',
      'birthDate',
      'gender',
      'birthTime',
      'mbti',
      'teaser_shown',
      'teaser_failed',
      'teaser_rate_limited',
      'cta_full',
      'cta_compat',
      'share_opened',
      'auth_google',
      'auth_x',
    ]);
  });

  test('has no duplicate steps', () => {
    expect(new Set(ONBOARDING_FUNNEL_STEPS).size).toBe(ONBOARDING_FUNNEL_STEPS.length);
  });
});

describe('isOnboardingFunnelStep', () => {
  test('accepts every declared step', () => {
    for (const step of ONBOARDING_FUNNEL_STEPS) {
      expect(isOnboardingFunnelStep(step)).toBe(true);
    }
  });

  test('rejects an unknown step', () => {
    expect(isOnboardingFunnelStep('not_a_real_step')).toBe(false);
  });

  test('rejects a near-miss (case or typo)', () => {
    expect(isOnboardingFunnelStep('Welcome')).toBe(false);
    expect(isOnboardingFunnelStep('teaser_shwon')).toBe(false);
  });

  test('rejects an empty string', () => {
    expect(isOnboardingFunnelStep('')).toBe(false);
  });
});
