import { describe, expect, test } from 'bun:test';
import { calculateBazi, calculateCompatibility } from '../lib/astrology';

describe('compatibility scoring', () => {
  test('is deterministic and bounded', () => {
    const chartA = calculateBazi(new Date(Date.UTC(1994, 10, 26)));
    const chartB = calculateBazi(new Date(Date.UTC(2001, 5, 15)));

    const first = calculateCompatibility(chartA, chartB);
    const second = calculateCompatibility(chartA, chartB);
    const reversed = calculateCompatibility(chartB, chartA);

    expect(first).toEqual(second);
    expect(first.score).toBe(reversed.score);
    expect(first.elementHarmony).toBe(reversed.elementHarmony);
    expect(first.branchHarmony).toBe(reversed.branchHarmony);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(first.elementHarmony).toBeGreaterThanOrEqual(0);
    expect(first.branchHarmony).toBeLessThanOrEqual(100);
  });

  test('supportive interactions score above controlling elements and clashes', () => {
    const supportiveA = calculateBazi(new Date(Date.UTC(1900, 0, 1)));
    const supportiveB = calculateBazi(new Date(Date.UTC(1900, 0, 7)));
    supportiveB.element = 'fire'; // wood produces fire
    supportiveB.dayPillar.branch = 'mao'; // xu + mao combine
    supportiveA.yearPillar.branch = 'xu';
    supportiveB.yearPillar.branch = 'mao';

    const tenseA = calculateBazi(new Date(Date.UTC(1900, 0, 1)));
    const tenseB = calculateBazi(new Date(Date.UTC(1900, 0, 2)));
    tenseB.element = 'earth'; // wood controls earth
    tenseB.dayPillar.branch = 'chen'; // xu + chen clash
    tenseA.yearPillar.branch = 'xu';
    tenseB.yearPillar.branch = 'chen';

    const supportive = calculateCompatibility(supportiveA, supportiveB);
    const tense = calculateCompatibility(tenseA, tenseB);

    expect(supportive.score).toBeGreaterThan(tense.score);
    expect(supportive.branchHarmony).toBe(90);
    expect(tense.branchHarmony).toBe(32);
  });

  test('real birth dates produce a score spread instead of a constant', () => {
    const dates = [
      new Date(Date.UTC(1985, 2, 15)),
      new Date(Date.UTC(1990, 5, 15)),
      new Date(Date.UTC(1994, 10, 26)),
      new Date(Date.UTC(2000, 0, 1)),
      new Date(Date.UTC(2004, 8, 28)),
    ];
    const base = calculateBazi(dates[0]);
    const scores = dates.slice(1).map(date => calculateCompatibility(base, calculateBazi(date)).score);

    expect(new Set(scores).size).toBeGreaterThanOrEqual(3);
  });
});
