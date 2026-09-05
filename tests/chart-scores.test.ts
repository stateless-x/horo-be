import { describe, test, expect } from 'bun:test';
import {
  calculateEnrichedBazi,
  calculateElementProfile,
  calculatePillarInteractions,
  calculateChartCategoryScores,
  applyChartScores,
  normalizeLegacyChartScore,
  CHART_CATEGORY_KEYS,
} from '../lib/astrology';

function chartFor(iso: string, hour?: number) {
  const pillars = calculateEnrichedBazi(new Date(iso), hour, 'female');
  const profile = calculateElementProfile(pillars.day);
  const interactions = calculatePillarInteractions(pillars);
  return { pillars, profile, interactions };
}

function scoresFor(iso: string, hour?: number) {
  const { pillars, profile, interactions } = chartFor(iso, hour);
  return calculateChartCategoryScores(profile, pillars, interactions);
}

// A spread of birth dates across decades, elements and hour/no-hour charts.
const SAMPLE_DATES = [
  '1990-03-14T00:00:00Z', '1994-11-02T00:00:00Z', '1997-07-21T00:00:00Z',
  '2000-01-09T00:00:00Z', '2002-05-30T00:00:00Z', '2004-09-17T00:00:00Z',
  '1985-12-25T00:00:00Z', '1978-06-06T00:00:00Z',
];

describe('calculateChartCategoryScores', () => {
  test('returns all six categories in 1..100', () => {
    for (const iso of SAMPLE_DATES) {
      const scores = scoresFor(iso);
      for (const key of CHART_CATEGORY_KEYS) {
        const value = scores[key];
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  test('is deterministic — same birth input always yields identical scores', () => {
    for (const iso of SAMPLE_DATES) {
      expect(scoresFor(iso)).toEqual(scoresFor(iso));
    }
  });

  test('life_overview equals the mean of the other five', () => {
    for (const iso of SAMPLE_DATES) {
      const s = scoresFor(iso);
      const mean = Math.round((s.love + s.career + s.finance + s.health + s.family) / 5);
      expect(s.life_overview).toBe(mean);
    }
  });

  test('produces real spread, not one flat value per chart', () => {
    // The whole point of moving off a 1-5 LLM guess is resolution: a chart
    // whose six categories are identical would be no better than the old scale.
    for (const iso of SAMPLE_DATES) {
      const s = scoresFor(iso);
      const values = [s.love, s.career, s.finance, s.health, s.family];
      expect(new Set(values).size).toBeGreaterThan(1);
    }
  });

  test('different birth charts produce different score profiles', () => {
    const profiles = SAMPLE_DATES.map((iso) => JSON.stringify(scoresFor(iso)));
    expect(new Set(profiles).size).toBeGreaterThan(1);
  });

  test('uses more of the range than the old five-step scale', () => {
    // scoreToPercent on a 1-5 score could only ever emit 20/40/60/80/100.
    const seen = new Set<number>();
    for (const iso of SAMPLE_DATES) {
      for (const key of CHART_CATEGORY_KEYS) seen.add(scoresFor(iso)[key]);
    }
    const offGrid = [...seen].filter((v) => v % 20 !== 0);
    expect(offGrid.length).toBeGreaterThan(0);
  });

  test('handles charts with and without a birth hour', () => {
    const withHour = scoresFor('1997-07-21T00:00:00Z', 14);
    const withoutHour = scoresFor('1997-07-21T00:00:00Z');
    for (const key of CHART_CATEGORY_KEYS) {
      expect(withHour[key]).toBeGreaterThanOrEqual(1);
      expect(withoutHour[key]).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('applyChartScores', () => {
  test('overrides the LLM score and preserves narrative fields', () => {
    const readings = [
      { key: 'love' as const, score: 3, reading: 'ก', tips: ['t'], warnings: ['w'] },
      { key: 'career' as const, score: 5, reading: 'ข', tips: [], warnings: [] },
    ];
    const scores = scoresFor('1997-07-21T00:00:00Z');
    const result = applyChartScores(readings, scores);

    expect(result[0].score).toBe(scores.love);
    expect(result[1].score).toBe(scores.career);
    expect(result[0].reading).toBe('ก');
    expect(result[0].tips).toEqual(['t']);
    expect(result[0].warnings).toEqual(['w']);
  });

  test('leaves the input array untouched', () => {
    const readings = [{ key: 'love' as const, score: 3, reading: '', tips: [], warnings: [] }];
    applyChartScores(readings, scoresFor('1990-03-14T00:00:00Z'));
    expect(readings[0].score).toBe(3);
  });
});

describe('normalizeLegacyChartScore', () => {
  test('upgrades cached 1-5 scores onto the 0-100 scale', () => {
    expect(normalizeLegacyChartScore(1)).toBe(20);
    expect(normalizeLegacyChartScore(3)).toBe(60);
    expect(normalizeLegacyChartScore(5)).toBe(100);
  });

  test('leaves already-migrated scores alone', () => {
    for (const value of [46, 62, 74, 88, 100]) {
      expect(normalizeLegacyChartScore(value)).toBe(value);
    }
  });
});
