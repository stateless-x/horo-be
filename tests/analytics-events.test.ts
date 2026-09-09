import { describe, test, expect } from 'bun:test';
import { buildProductEventRow, normalizeSignupSource } from '../src/lib/analytics-events';
import type { TrackedEvent } from '../lib/shared/types/analytics';

const USER = 'user_123';
const DATE = '2026-09-07';

describe('buildProductEventRow', () => {
  test('surface_viewed dedups on the surface', () => {
    expect(buildProductEventRow({ event: 'surface_viewed', surface: 'settings' }, USER, DATE)).toEqual({
      userId: USER,
      event: 'surface_viewed',
      surface: 'settings',
      category: null,
      detail: null,
      viewDate: DATE,
      dedupKey: 'settings',
    });
  });

  test('category_opened dedups on surface:category, so the same category on two surfaces both count', () => {
    const onToday = buildProductEventRow(
      { event: 'category_opened', surface: 'today', category: 'love' },
      USER,
      DATE,
    );
    const onFortune = buildProductEventRow(
      { event: 'category_opened', surface: 'fortune', category: 'love' },
      USER,
      DATE,
    );

    expect(onToday.dedupKey).toBe('today:love');
    expect(onFortune.dedupKey).toBe('fortune:love');
    expect(onToday.category).toBe('love');
  });

  test('cta_clicked lands the cta id in detail and never dedups', () => {
    const row = buildProductEventRow(
      { event: 'cta_clicked', surface: 'today', cta: 'today_monthly_chart' },
      USER,
      DATE,
    );

    expect(row).toEqual({
      userId: USER,
      event: 'cta_clicked',
      surface: 'today',
      category: null,
      detail: 'today_monthly_chart',
      viewDate: DATE,
      // Null so a reader who clicks the band twice in a day counts twice —
      // clicks are the metric, not "did they ever click".
      dedupKey: null,
    });
  });

  test('cta_clicked rejects a cta id outside the vocabulary', () => {
    expect(() =>
      buildProductEventRow(
        { event: 'cta_clicked', surface: 'today', cta: 'today_montly_chart' } as unknown as TrackedEvent,
        USER,
        DATE,
      ),
    ).toThrow(/Invalid cta/);
  });

  test('tab_opened dedups on the tab and pins the surface to fortune', () => {
    const row = buildProductEventRow({ event: 'tab_opened', surface: 'fortune', tab: 'readings' }, USER, DATE);

    expect(row.dedupKey).toBe('readings');
    expect(row.surface).toBe('fortune');
    expect(row.detail).toBe('readings');
  });

  test('compatibility_checked yields a null dedupKey so every check inserts', () => {
    const row = buildProductEventRow({ event: 'compatibility_checked', relationshipType: 'romantic' }, USER, DATE);

    expect(row.dedupKey).toBeNull();
    expect(row.surface).toBeNull();
    expect(row.detail).toBe('romantic');
  });

  test('compatibility lifecycle events map bounded context without personal input', () => {
    expect(buildProductEventRow(
      { event: 'relationship_selected', relationshipType: 'friend' },
      USER,
      DATE,
    )).toMatchObject({
      surface: 'compatibility',
      category: null,
      detail: 'friend',
      dedupKey: 'friend',
    });

    expect(buildProductEventRow(
      { event: 'calculation_failed', relationshipType: 'boss', failureClass: 'timeout' },
      USER,
      DATE,
    )).toMatchObject({
      surface: 'compatibility',
      category: 'timeout',
      detail: 'boss',
      dedupKey: null,
    });

    expect(buildProductEventRow(
      { event: 'result_opened', relationshipType: 'family', origin: 'history' },
      USER,
      DATE,
    )).toMatchObject({
      surface: 'compatibility',
      category: 'history',
      detail: 'family',
      dedupKey: null,
    });
  });

  test('guidance dedups daily per relationship type and share actions count every occurrence', () => {
    const guidance = buildProductEventRow(
      { event: 'guidance_opened', relationshipType: 'romantic' },
      USER,
      DATE,
    );
    const share = buildProductEventRow(
      { event: 'compatibility_share_initiated', relationshipType: 'romantic', platform: 'copy' },
      USER,
      DATE,
    );

    expect(guidance).toMatchObject({
      category: 'next_steps',
      detail: 'romantic',
      dedupKey: 'next_steps:romantic',
    });
    expect(share).toMatchObject({
      category: 'copy',
      detail: 'romantic',
      dedupKey: null,
    });
  });

  test('reading_shared yields a null dedupKey and keeps the surface', () => {
    const row = buildProductEventRow({ event: 'reading_shared', surface: 'today' }, USER, DATE);

    expect(row.dedupKey).toBeNull();
    expect(row.surface).toBe('today');
  });

  test('rejects a category outside the vocabulary', () => {
    const bad = { event: 'category_opened', surface: 'today', category: 'wealth' } as unknown as TrackedEvent;

    expect(() => buildProductEventRow(bad, USER, DATE)).toThrow(/Invalid category: wealth/);
  });

  test('rejects a relationshipType outside the vocabulary', () => {
    const bad = { event: 'compatibility_checked', relationshipType: 'nemesis' } as unknown as TrackedEvent;

    expect(() => buildProductEventRow(bad, USER, DATE)).toThrow(/Invalid relationshipType: nemesis/);
  });

  test('rejects failure, result origin, and share platform values outside the vocabulary', () => {
    const badFailure = {
      event: 'calculation_failed',
      relationshipType: 'friend',
      failureClass: 'raw-server-message',
    } as unknown as TrackedEvent;
    const badOrigin = {
      event: 'result_opened',
      relationshipType: 'friend',
      origin: 'somewhere',
    } as unknown as TrackedEvent;
    const badPlatform = {
      event: 'compatibility_share_initiated',
      relationshipType: 'friend',
      platform: 'email',
    } as unknown as TrackedEvent;

    expect(() => buildProductEventRow(badFailure, USER, DATE)).toThrow(/Invalid failureClass/);
    expect(() => buildProductEventRow(badOrigin, USER, DATE)).toThrow(/Invalid origin/);
    expect(() => buildProductEventRow(badPlatform, USER, DATE)).toThrow(/Invalid platform/);
  });
});

describe('normalizeSignupSource', () => {
  test('keeps a normal channel name', () => {
    expect(normalizeSignupSource('x')).toBe('x');
  });

  test('lowercases and trims, so X and x are one channel not two', () => {
    expect(normalizeSignupSource('  X_KhonKhui  ')).toBe('x_khonkhui');
  });

  test('drops a missing or blank value rather than storing an empty string', () => {
    expect(normalizeSignupSource(undefined)).toBeUndefined();
    expect(normalizeSignupSource('   ')).toBeUndefined();
  });

  test('drops an over-long value instead of letting it fail the profile save', () => {
    expect(normalizeSignupSource('a'.repeat(65))).toBeUndefined();
    expect(normalizeSignupSource('a'.repeat(64))).toBe('a'.repeat(64));
  });
});
