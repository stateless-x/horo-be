import { describe, test, expect } from 'bun:test';
import { buildProductEventRow } from '../src/lib/analytics-events';
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
});
