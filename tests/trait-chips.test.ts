import { describe, expect, test } from 'bun:test';
import { buildTraitChips, normalizeMbtiType, TRAIT_CHIP_TABLES } from '../lib/astrology/trait-chips';
import { ThaiDaySchema, ElementSchema } from '../lib/shared';
import { MBTI_TYPES } from '../lib/shared/constants/mbti';

const THAI_DAYS = ThaiDaySchema.options;
const ELEMENTS = ElementSchema.options;
const MBTI_CODES = MBTI_TYPES.map((t) => t.code);

// Generic praise banned by the product spec — chips must be specific, not
// something any reader would nod along to regardless of their actual chart.
const BANNED_SUBSTRINGS = ['ใจดี', 'เก่ง'];

describe('trait chip tables — completeness', () => {
  test('every ThaiDay (all 8, including both wednesday variants) has a trait', () => {
    for (const day of THAI_DAYS) {
      expect(TRAIT_CHIP_TABLES.thaiDayTraits[day]).toBeTruthy();
    }
    expect(THAI_DAYS.length).toBe(8);
  });

  test('every Element has a trait', () => {
    for (const element of ELEMENTS) {
      expect(TRAIT_CHIP_TABLES.baziElementTraits[element]).toBeTruthy();
    }
    expect(ELEMENTS.length).toBe(5);
  });

  test('every MbtiType (all 16) has a trait', () => {
    for (const code of MBTI_CODES) {
      expect(TRAIT_CHIP_TABLES.mbtiTraits[code]).toBeTruthy();
    }
    expect(MBTI_CODES.length).toBe(16);
  });
});

describe('trait chip tables — length and content rules', () => {
  test('every trait is at most 16 characters', () => {
    const allTraits = [
      ...Object.values(TRAIT_CHIP_TABLES.thaiDayTraits),
      ...Object.values(TRAIT_CHIP_TABLES.baziElementTraits),
      ...Object.values(TRAIT_CHIP_TABLES.mbtiTraits),
    ];
    for (const trait of allTraits) {
      expect(trait.length).toBeLessThanOrEqual(16);
    }
  });

  test('no trait contains a banned generic-praise substring', () => {
    const allTraits = [
      ...Object.values(TRAIT_CHIP_TABLES.thaiDayTraits),
      ...Object.values(TRAIT_CHIP_TABLES.baziElementTraits),
      ...Object.values(TRAIT_CHIP_TABLES.mbtiTraits),
    ];
    for (const trait of allTraits) {
      for (const banned of BANNED_SUBSTRINGS) {
        expect(trait.includes(banned)).toBe(false);
      }
    }
  });

  test('no duplicate trait text within a single table', () => {
    for (const table of [
      TRAIT_CHIP_TABLES.thaiDayTraits,
      TRAIT_CHIP_TABLES.baziElementTraits,
      TRAIT_CHIP_TABLES.mbtiTraits,
    ]) {
      const values = Object.values(table);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe('normalizeMbtiType', () => {
  test('undefined and empty string yield null', () => {
    expect(normalizeMbtiType(undefined)).toBeNull();
    expect(normalizeMbtiType(null)).toBeNull();
    expect(normalizeMbtiType('')).toBeNull();
  });

  test('an invalid 4-character code yields null', () => {
    expect(normalizeMbtiType('xxxx')).toBeNull();
  });

  test('lowercase input is normalized to the uppercase type', () => {
    expect(normalizeMbtiType('intp')).toBe('INTP');
  });

  test('already-uppercase input passes through', () => {
    expect(normalizeMbtiType('INTP')).toBe('INTP');
  });

  test('whitespace is trimmed', () => {
    expect(normalizeMbtiType('  intp  ')).toBe('INTP');
  });
});

describe('buildTraitChips', () => {
  test('omits the mbti chip entirely when mbtiType is null', () => {
    const chips = buildTraitChips('monday', 'fire', null);
    expect(chips).toHaveLength(2);
    expect(chips.some((c) => c.system === 'mbti')).toBe(false);
  });

  test('includes all three chips when a valid mbtiType is given', () => {
    const chips = buildTraitChips('monday', 'fire', 'INTP');
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.system)).toEqual(['thai', 'bazi', 'mbti']);
    const mbtiChip = chips.find((c) => c.system === 'mbti');
    expect(mbtiChip?.label).toBe('INTP');
  });

  test('wednesday_day and wednesday_night produce distinct chips', () => {
    const dayChip = buildTraitChips('wednesday_day', 'wood', null)[0];
    const nightChip = buildTraitChips('wednesday_night', 'wood', null)[0];
    expect(dayChip.trait).not.toBe(nightChip.trait);
    expect(dayChip.label).not.toBe(nightChip.label);
  });
});
