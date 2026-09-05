import { describe, expect, test } from 'bun:test';
import {
  calculateBazi,
  calculateDailyCategoryScores,
  calculateOverallScore,
  calculateElementHarmony,
  checkBranchClash,
  calculateTodayPillar,
  getDailyFortuneContext,
  type ElementHarmony,
  type ElementRelationship,
  type BranchClash,
  normalizeLegacyDailyScore,
} from '../lib/astrology';
import type { Element } from '../lib/shared';

const ELEMENTS: Element[] = ['wood', 'fire', 'earth', 'metal', 'water'];
const RELATIONSHIPS: ElementRelationship[] = [
  'producing', 'produced_by', 'controlling', 'controlled_by', 'same', 'neutral',
];
const FAVORABILITIES: ElementHarmony['favorability'][] = [
  'very_favorable', 'favorable', 'neutral', 'challenging',
];

function harmony(relationship: ElementRelationship, favorability: ElementHarmony['favorability']): ElementHarmony {
  return {
    relationship,
    userElement: 'wood',
    todayElement: 'fire',
    favorability,
    description: '',
    scoreModifier: 0,
  };
}

function clash(clashType?: 'year' | 'day'): BranchClash {
  if (!clashType) return { hasClash: false };
  return { hasClash: true, clashType, userBranch: 'zi', todayBranch: 'wu', warning: '' };
}

const CLASH_STATES: (undefined | 'year' | 'day')[] = [undefined, 'year', 'day'];

describe('daily category scores', () => {
  test('deterministic — same inputs always produce identical scores', () => {
    const eh = calculateElementHarmony('wood', 'fire');
    const bc: BranchClash = { hasClash: true, clashType: 'day', userBranch: 'zi', todayBranch: 'wu', warning: 'x' };

    const first = calculateDailyCategoryScores(eh, bc);
    const second = calculateDailyCategoryScores(eh, bc);

    expect(first).toEqual(second);
  });

  test('never uniform — no relationship x favorability x clash combination yields four equal scores', () => {
    let uniformCount = 0;
    for (const favorability of FAVORABILITIES) {
      for (const relationship of RELATIONSHIPS) {
        for (const clashType of CLASH_STATES) {
          const scores = calculateDailyCategoryScores(harmony(relationship, favorability), clash(clashType));
          const values = Object.values(scores);
          if (new Set(values).size === 1) {
            uniformCount++;
            console.error('uniform combo:', favorability, relationship, clashType, scores);
          }
        }
      }
    }
    expect(uniformCount).toBe(0);
  });

  test('bounded — every score is an integer in 1..100 across the full sweep', () => {
    for (const favorability of FAVORABILITIES) {
      for (const relationship of RELATIONSHIPS) {
        for (const clashType of CLASH_STATES) {
          const scores = calculateDailyCategoryScores(harmony(relationship, favorability), clash(clashType));
          for (const value of Object.values(scores)) {
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(1);
            expect(value).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  test('affinity invariant — career always differs from finance, love always differs from health, per relationship', () => {
    // This is what makes "never uniform" true by construction rather than by luck:
    // a year-clash moves career+finance together and a day-clash moves love+health
    // together, so whichever pair the clash doesn't touch must still differ internally.
    for (const relationship of RELATIONSHIPS) {
      const eh = harmony(relationship, 'neutral');
      const scores = calculateDailyCategoryScores(eh, clash(undefined));
      expect(scores.career).not.toBe(scores.finance);
      expect(scores.love).not.toBe(scores.health);
    }
  });

  test('spread — a year of real dates for a fixed birth date shows genuine variance', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const userChart = calculateBazi(birthDate, 2, 'male');

    const perCategory: Record<string, number[]> = { career: [], love: [], finance: [], health: [] };
    for (let day = 0; day < 365; day++) {
      const today = new Date(Date.UTC(2026, 0, 1 + day));
      const { elementHarmony, branchClash } = getDailyFortuneContext(today, userChart);
      const scores = calculateDailyCategoryScores(elementHarmony, branchClash);
      for (const category of Object.keys(perCategory)) {
        perCategory[category].push(scores[category as keyof typeof scores]);
      }
    }

    for (const [category, values] of Object.entries(perCategory)) {
      const distinct = new Set(values);
      expect(distinct.size).toBeGreaterThanOrEqual(3);

      // No single value should dominate the whole year — real variance, not clustering.
      const counts = new Map<number, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      const maxShare = Math.max(...counts.values()) / values.length;
      expect(maxShare).toBeLessThanOrEqual(0.7);
    }
  });

  test('favorability-consistent — very_favorable scores higher in aggregate than challenging, for the same user', () => {
    for (const relationship of RELATIONSHIPS) {
      for (const clashType of CLASH_STATES) {
        const favorableScores = calculateDailyCategoryScores(harmony(relationship, 'very_favorable'), clash(clashType));
        const challengingScores = calculateDailyCategoryScores(harmony(relationship, 'challenging'), clash(clashType));

        const favorableSum = Object.values(favorableScores).reduce((a, b) => a + b, 0);
        const challengingSum = Object.values(challengingScores).reduce((a, b) => a + b, 0);

        expect(favorableSum).toBeGreaterThan(challengingSum);
      }
    }
  });

  test('favorability-consistent — overallScore (rounded mean, as computed in routes.ts) is higher for very_favorable than challenging', () => {
    // routes.ts overwrites overallScore with Math.round(mean of the four category
    // scores). Assert that same aggregate directly, since it's the user-visible
    // headline number and property 5 must hold for it too, not just the raw sum.
    const overallOf = (scores: Record<string, number>) =>
      Math.round((scores.career + scores.love + scores.finance + scores.health) / 4);

    for (const relationship of RELATIONSHIPS) {
      for (const clashType of CLASH_STATES) {
        const favorableOverall = overallOf(calculateDailyCategoryScores(harmony(relationship, 'very_favorable'), clash(clashType)));
        const challengingOverall = overallOf(calculateDailyCategoryScores(harmony(relationship, 'challenging'), clash(clashType)));

        expect(favorableOverall).toBeGreaterThan(challengingOverall);
      }
    }
  });

  test('branch clash sensitivity matches the documented mapping — year hits career/finance, day hits love/health', () => {
    const eh = harmony('neutral', 'neutral');
    const noClash = calculateDailyCategoryScores(eh, clash(undefined));
    const yearClash = calculateDailyCategoryScores(eh, clash('year'));
    const dayClash = calculateDailyCategoryScores(eh, clash('day'));

    expect(yearClash.career).toBeLessThan(noClash.career);
    expect(yearClash.finance).toBeLessThan(noClash.finance);
    expect(yearClash.love).toBe(noClash.love);
    expect(yearClash.health).toBe(noClash.health);

    expect(dayClash.love).toBeLessThan(noClash.love);
    expect(dayClash.health).toBeLessThan(noClash.health);
    expect(dayClash.career).toBe(noClash.career);
    expect(dayClash.finance).toBe(noClash.finance);
  });

  test('sanity check against calculateTodayPillar + checkBranchClash wiring used at the call site', () => {
    const birthDate = new Date(Date.UTC(1990, 5, 15));
    const userChart = calculateBazi(birthDate);
    const today = new Date(Date.UTC(2026, 8, 5));
    const todayPillar = calculateTodayPillar(today);
    const branchClash = checkBranchClash(userChart, todayPillar);
    const elementHarmony = calculateElementHarmony(userChart.element, todayPillar.element);

    const scores = calculateDailyCategoryScores(elementHarmony, branchClash);
    for (const value of Object.values(scores)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe('calculateOverallScore', () => {
  test('a challenging day never displays more than 45 of 100', () => {
    for (const relationship of RELATIONSHIPS) {
      for (const clashType of CLASH_STATES) {
        const eh = harmony(relationship, 'challenging');
        const overall = calculateOverallScore(calculateDailyCategoryScores(eh, clash(clashType)), eh);
        expect(overall).toBeLessThanOrEqual(45);
        expect(overall).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('a very_favorable day never displays fewer than 75 of 100', () => {
    for (const relationship of RELATIONSHIPS) {
      for (const clashType of CLASH_STATES) {
        const eh = harmony(relationship, 'very_favorable');
        const overall = calculateOverallScore(calculateDailyCategoryScores(eh, clash(clashType)), eh);
        expect(overall).toBeGreaterThanOrEqual(75);
        expect(overall).toBeLessThanOrEqual(100);
      }
    }
  });

  test('challenging and very_favorable bands never overlap', () => {
    const worst: number[] = [];
    const best: number[] = [];
    for (const relationship of RELATIONSHIPS) {
      for (const clashType of CLASH_STATES) {
        const bad = harmony(relationship, 'challenging');
        const good = harmony(relationship, 'very_favorable');
        worst.push(calculateOverallScore(calculateDailyCategoryScores(bad, clash(clashType)), bad));
        best.push(calculateOverallScore(calculateDailyCategoryScores(good, clash(clashType)), good));
      }
    }
    expect(Math.max(...worst)).toBeLessThan(Math.min(...best));
  });

  test('is bounded 1-100 and integral for every favorability', () => {
    for (const favorability of FAVORABILITIES) {
      for (const relationship of RELATIONSHIPS) {
        for (const clashType of CLASH_STATES) {
          const eh = harmony(relationship, favorability);
          const overall = calculateOverallScore(calculateDailyCategoryScores(eh, clash(clashType)), eh);
          expect(Number.isInteger(overall)).toBe(true);
          expect(overall).toBeGreaterThanOrEqual(1);
          expect(overall).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('normalizeLegacyDailyScore', () => {
  test('upgrades cached 1-5 scores onto the 0-100 scale', () => {
    expect(normalizeLegacyDailyScore(1)).toBe(20);
    expect(normalizeLegacyDailyScore(3)).toBe(60);
    expect(normalizeLegacyDailyScore(5)).toBe(100);
  });

  test('leaves already-migrated scores alone', () => {
    for (const value of [22, 38, 62, 78, 89, 100]) {
      expect(normalizeLegacyDailyScore(value)).toBe(value);
    }
  });
});
