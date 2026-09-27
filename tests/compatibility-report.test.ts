import { describe, expect, test } from 'bun:test';
import {
  bestMonth,
  calculateBazi,
  calculateDimensions,
  PAIR_ARCHETYPES,
  pairInputs,
  relationshipCalendar,
  selectArchetype,
  type PairInputs,
} from '../lib/astrology';
import { foreignElementWords } from '../src/lib/compatibility-text';

const MBTI = ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'];

/** Seeded so the spread assertions are about the formula, not the draw. */
function randomPairs(count: number, withMbti: boolean) {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const date = () => new Date(Date.UTC(1965 + Math.floor(rnd() * 40), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28)));
  return Array.from({ length: count }, () => {
    const reader = calculateBazi(date());
    const partner = calculateBazi(date());
    const mbti = withMbti ? [MBTI[Math.floor(rnd() * 16)], MBTI[Math.floor(rnd() * 16)]] : [null, null];
    return { reader, partner, readerMbti: mbti[0], partnerMbti: mbti[1] };
  });
}

describe('dimension scores', () => {
  const pairs = randomPairs(2000, false);
  const mbtiPairs = randomPairs(2000, true);

  test('are deterministic, bounded and symmetric', () => {
    for (const { reader, partner, readerMbti, partnerMbti } of [...pairs.slice(0, 200), ...mbtiPairs.slice(0, 200)]) {
      const once = calculateDimensions(pairInputs(reader, partner, readerMbti, partnerMbti));
      expect(calculateDimensions(pairInputs(reader, partner, readerMbti, partnerMbti))).toEqual(once);
      expect(calculateDimensions(pairInputs(partner, reader, partnerMbti, readerMbti))).toEqual(once);
      for (const dim of once) {
        expect(dim.score).toBeGreaterThanOrEqual(5);
        expect(dim.score).toBeLessThanOrEqual(97);
      }
    }
  });

  test.each([
    ['without MBTI', pairs],
    ['with MBTI', mbtiPairs],
  ])('spread %s: not everyone lands at 50 to 60, and a pair never gets four equal bars', (_label, sample) => {
    const scores = sample.map((p) => calculateDimensions(pairInputs(p.reader, p.partner, p.readerMbti, p.partnerMbti)));
    for (const key of ['chemistry', 'communication', 'trust', 'rhythm'] as const) {
      const values = scores.map((dims) => dims.find((d) => d.key === key)!.score);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
      expect(sd).toBeGreaterThan(9);
      expect(values.filter((v) => v >= 50 && v <= 60).length / values.length).toBeLessThan(0.4);
      expect(Math.min(...values)).toBeLessThan(45);
      expect(Math.max(...values)).toBeGreaterThan(80);
    }
    expect(scores.filter((dims) => new Set(dims.map((d) => d.score)).size === 1)).toHaveLength(0);
  });

  test('without both MBTI codes no dimension claims MBTI as a basis', () => {
    const { reader, partner } = pairs[0];
    for (const [a, b] of [[null, null], ['INFP', null], [null, 'ESTJ']] as const) {
      const dims = calculateDimensions(pairInputs(reader, partner, a, b));
      expect(dims.flatMap((d) => d.basis)).not.toContain('mbti');
    }
    const withBoth = calculateDimensions(pairInputs(reader, partner, 'INFP', 'ESTJ'));
    expect(withBoth.find((d) => d.key === 'communication')!.basis).toContain('mbti');
  });

  test('a spouse-palace combination outscores a harm on trust and communication', () => {
    const base: PairInputs = { elementClass: 'generating', dayRelation: 'combine', yearRelation: 'neutral', stemCombine: false, mbti: null };
    const good = calculateDimensions(base);
    const bad = calculateDimensions({ ...base, dayRelation: 'harm' });
    for (const key of ['trust', 'communication', 'chemistry'] as const) {
      expect(good.find((d) => d.key === key)!.score).toBeGreaterThan(bad.find((d) => d.key === key)!.score);
    }
  });
});

describe('pair archetype', () => {
  test('every element class and day-branch relation has a named entry, 18 in all', () => {
    const entries = Object.values(PAIR_ARCHETYPES).flatMap((byRelation) => Object.values(byRelation));
    expect(entries).toHaveLength(18);
    expect(new Set(entries.map((e) => e.name)).size).toBe(18);
    for (const entry of entries) {
      expect(entry.name.length).toBeGreaterThan(2);
      expect(entry.tagline.length).toBeGreaterThan(10);
      // Element words are data in the prose checks; names must not carry them. No doom names.
      expect(foreignElementWords(`${entry.name} ${entry.tagline}`, [])).toEqual([]);
      expect(entry.name).not.toContain('กรรม');
    }
  });

  test('is deterministic and the same whichever person is the reader', () => {
    for (const { reader, partner } of randomPairs(500, false)) {
      const once = selectArchetype(pairInputs(reader, partner, null, null));
      expect(selectArchetype(pairInputs(reader, partner, null, null))).toEqual(once);
      expect(selectArchetype(pairInputs(partner, reader, null, null))).toEqual(once);
    }
  });
});

describe('relationship calendar', () => {
  const reader = calculateBazi(new Date('1996-03-14'), 8, 'female');
  const partner = calculateBazi(new Date('1993-11-02'));

  test('covers the three months after the current Bangkok month, across the Bangkok month boundary', () => {
    // 2026-09-30 23:30 in Bangkok: still September.
    expect(relationshipCalendar(reader, partner, new Date('2026-09-30T16:30:00Z')).map((m) => m.month)).toEqual([
      '2026-10', '2026-11', '2026-12',
    ]);
    // 2026-10-01 00:30 in Bangkok, though still September 30 in UTC.
    expect(relationshipCalendar(reader, partner, new Date('2026-09-30T17:30:00Z')).map((m) => m.month)).toEqual([
      '2026-11', '2026-12', '2027-01',
    ]);
  });

  test('is deterministic, symmetric in its labels, and uses all three labels across pairs', () => {
    const now = new Date('2026-09-27T05:00:00Z');
    const once = relationshipCalendar(reader, partner, now);
    expect(relationshipCalendar(reader, partner, now)).toEqual(once);
    expect(relationshipCalendar(partner, reader, now).map((m) => m.label)).toEqual(once.map((m) => m.label));

    const counts = { good: 0, mixed: 0, caution: 0 };
    for (const pair of randomPairs(500, false)) {
      for (const month of relationshipCalendar(pair.reader, pair.partner, now)) counts[month.label] += 1;
    }
    for (const count of Object.values(counts)) expect(count / 1500).toBeGreaterThan(0.15);
  });

  test('a month that clashes either spouse palace is never good', () => {
    const now = new Date('2026-09-27T05:00:00Z');
    for (const pair of randomPairs(500, false)) {
      for (const month of relationshipCalendar(pair.reader, pair.partner, now)) {
        if (month.reasons.some((r) => r.kind === 'branch' && r.relation === 'clash')) expect(month.label).not.toBe('good');
      }
    }
  });

  test('the recommended month is the first good one, else the first mixed one', () => {
    const month = (label: 'good' | 'mixed' | 'caution', m: string) => ({ month: m, monthElement: 'fire' as const, label, reasons: [] });
    expect(bestMonth([month('caution', 'a'), month('good', 'b'), month('good', 'c')]).month).toBe('b');
    expect(bestMonth([month('caution', 'a'), month('mixed', 'b'), month('caution', 'c')]).month).toBe('b');
    expect(bestMonth([month('caution', 'a'), month('caution', 'b'), month('caution', 'c')]).month).toBe('a');
  });
});
