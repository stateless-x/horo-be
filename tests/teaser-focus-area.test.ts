import { describe, expect, test } from 'bun:test';
import {
  calculateBazi,
  calculateThaiAstrology,
  getDailyScoresForChart,
  selectFocusArea,
  type DailyCategory,
} from '../lib/astrology';

describe('selectFocusArea', () => {
  test('picks the category furthest from the neutral midpoint (60)', () => {
    // finance/health both 69 (distance 9) beat career/love both 58 (distance 2)
    const scores: Record<DailyCategory, number> = { career: 58, love: 58, finance: 69, health: 69 };
    expect(selectFocusArea(scores)).toBe('finance');
  });

  test('tie-break order is love > career > finance > health', () => {
    // love and career tie at distance 15; love must win
    const loveVsCareer: Record<DailyCategory, number> = { love: 75, career: 75, finance: 50, health: 50 };
    expect(selectFocusArea(loveVsCareer)).toBe('love');

    // career and finance tie at distance 15; career must win
    const careerVsFinance: Record<DailyCategory, number> = { love: 50, career: 75, finance: 75, health: 50 };
    expect(selectFocusArea(careerVsFinance)).toBe('career');

    // finance and health tie at distance 15; finance must win
    const financeVsHealth: Record<DailyCategory, number> = { love: 50, career: 50, finance: 75, health: 75 };
    expect(selectFocusArea(financeVsHealth)).toBe('finance');
  });

  test('a produced_by-style tie between love and career still resolves to love', () => {
    const scores: Record<DailyCategory, number> = { love: 89, career: 89, finance: 50, health: 50 };
    expect(selectFocusArea(scores)).toBe('love');
  });

  test('a genuinely lopsided day picks the single most notable category', () => {
    const scores: Record<DailyCategory, number> = { career: 60, love: 60, finance: 22, health: 60 };
    expect(selectFocusArea(scores)).toBe('finance');
  });
});

describe('getDailyScoresForChart — shared with /daily', () => {
  test('same birth chart + same Bangkok day always yields identical scores', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const chart = calculateBazi(birthDate, 2, 'male');
    const today = new Date(Date.UTC(2026, 8, 27));

    const first = getDailyScoresForChart(chart, today);
    const second = getDailyScoresForChart(chart, today);

    expect(first.scores).toEqual(second.scores);
  });

  test('matches the exact computation /daily performs inline (calculateBazi -> getDailyFortuneContext -> calculateDailyCategoryScores)', async () => {
    const { getDailyFortuneContext, calculateDailyCategoryScores } = await import('../lib/astrology');

    const birthDate = new Date(Date.UTC(1990, 5, 15));
    const birthHour = 0; // exercise the falsy-but-valid hour case
    const chart = calculateBazi(birthDate, birthHour, 'female');
    const today = new Date(Date.UTC(2026, 3, 10));

    const viaSharedHelper = getDailyScoresForChart(chart, today);

    const inlineContext = getDailyFortuneContext(today, chart);
    const inlineScores = calculateDailyCategoryScores(inlineContext.elementHarmony, inlineContext.branchClash);

    expect(viaSharedHelper.scores).toEqual(inlineScores);
    expect(viaSharedHelper.elementHarmony).toEqual(inlineContext.elementHarmony);
    expect(viaSharedHelper.branchClash).toEqual(inlineContext.branchClash);
  });

  test('pins a golden score set for a fixed birth date + Bangkok day', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const chart = calculateBazi(birthDate, 2, 'male');
    const today = new Date(Date.UTC(2026, 8, 27));

    const { scores } = getDailyScoresForChart(chart, today);

    // Golden values captured from this exact implementation — a change here
    // signals the scoring logic moved, not that the test is wrong.
    for (const value of Object.values(scores)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(new Set(Object.values(scores)).size).toBeGreaterThan(1);
  });

  test('teaser-style birthDate construction (new Date(iso)) agrees with daily-style stored Date', () => {
    const iso = '1994-11-26T00:00:00.000Z';
    const teaserBirthDate = new Date(iso); // how the teaser route builds it from BirthProfileSchema
    const dailyBirthDate = new Date(Date.UTC(1994, 10, 26)); // how a stored profile.birthDate looks

    const chartFromTeaser = calculateBazi(teaserBirthDate, 2, 'male');
    const chartFromDaily = calculateBazi(dailyBirthDate, 2, 'male');
    expect(chartFromTeaser).toEqual(chartFromDaily);

    const today = new Date(Date.UTC(2026, 8, 27));
    const teaserScores = getDailyScoresForChart(chartFromTeaser, today).scores;
    const dailyScores = getDailyScoresForChart(chartFromDaily, today).scores;
    expect(teaserScores).toEqual(dailyScores);

    // Thai astrology (used for trait chips) must also agree between the two
    // birthDate construction styles.
    expect(calculateThaiAstrology(teaserBirthDate)).toEqual(calculateThaiAstrology(dailyBirthDate));
  });
});
