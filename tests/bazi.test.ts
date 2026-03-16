import { describe, test, expect } from 'bun:test';
import { calculateBazi, calculateEnrichedBazi } from '../lib/astrology';

const STEMS = ['jia', 'yi', 'bing', 'ding', 'wu', 'ji', 'geng', 'xin', 'ren', 'gui'] as const;
const BRANCHES = ['zi', 'chou', 'yin', 'mao', 'chen', 'si', 'wu', 'wei', 'shen', 'you', 'xu', 'hai'] as const;
const STEM_CHARS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCH_CHARS = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

function pillarStr(p: { stem: string; branch: string }): string {
  return STEM_CHARS[STEMS.indexOf(p.stem as any)] + BRANCH_CHARS[BRANCHES.indexOf(p.branch as any)];
}

const ELEMENT_FROM_STEM: Record<string, string> = {
  jia: 'wood', yi: 'wood',
  bing: 'fire', ding: 'fire',
  wu: 'earth', ji: 'earth',
  geng: 'metal', xin: 'metal',
  ren: 'water', gui: 'water',
};

/**
 * All expected values verified against wannianrili.bmcx.com (万年历)
 */
const KNOWN_DATES: {
  label: string;
  y: number; m: number; d: number;
  year: string; month: string; day: string;
}[] = [
  { label: 'Jan 1, 1900', y: 1900, m: 1, d: 1, year: '己亥', month: '丙子', day: '甲戌' },
  { label: 'Mar 15, 1985', y: 1985, m: 3, d: 15, year: '乙丑', month: '己卯', day: '癸丑' },
  { label: 'Jun 15, 1990', y: 1990, m: 6, d: 15, year: '庚午', month: '壬午', day: '辛亥' },
  { label: 'Jan 1, 2000', y: 2000, m: 1, d: 1, year: '己卯', month: '丙子', day: '戊午' },
  { label: 'Jan 1, 2024 (before 立春)', y: 2024, m: 1, d: 1, year: '癸卯', month: '甲子', day: '甲子' },
  { label: 'Feb 4, 2024 (立春)', y: 2024, m: 2, d: 4, year: '甲辰', month: '丙寅', day: '戊戌' },
  { label: 'Sep 28, 2024', y: 2024, m: 9, d: 28, year: '甲辰', month: '癸酉', day: '乙未' },
];

// ----- Day Pillar Tests -----

describe('Bazi Day Pillar (verified against 万年历)', () => {
  for (const tc of KNOWN_DATES) {
    test(tc.label, () => {
      const date = new Date(Date.UTC(tc.y, tc.m - 1, tc.d));
      const chart = calculateBazi(date);
      expect(pillarStr(chart.dayPillar)).toBe(tc.day);
    });
  }
});

// ----- Year Pillar Tests -----

describe('Bazi Year Pillar', () => {
  for (const tc of KNOWN_DATES) {
    test(tc.label, () => {
      const date = new Date(Date.UTC(tc.y, tc.m - 1, tc.d));
      const chart = calculateBazi(date);
      expect(pillarStr(chart.yearPillar)).toBe(tc.year);
    });
  }
});

// ----- Month Pillar Tests -----

describe('Bazi Month Pillar', () => {
  for (const tc of KNOWN_DATES) {
    test(tc.label, () => {
      const date = new Date(Date.UTC(tc.y, tc.m - 1, tc.d));
      const chart = calculateBazi(date);
      expect(pillarStr(chart.monthPillar)).toBe(tc.month);
    });
  }
});

// ----- Element Derivation -----

describe('Element derived from Day Master', () => {
  for (const tc of KNOWN_DATES) {
    test(tc.label, () => {
      const date = new Date(Date.UTC(tc.y, tc.m - 1, tc.d));
      const chart = calculateBazi(date);
      expect(chart.element).toBe(ELEMENT_FROM_STEM[chart.dayMaster]);
    });
  }
});

// ----- Year Pillar: 立春 boundary -----

describe('Year Pillar adjusts at 立春 (~Feb 4)', () => {
  test('Feb 3, 2024 still belongs to 癸卯 year', () => {
    const chart = calculateBazi(new Date(Date.UTC(2024, 1, 3)));
    expect(pillarStr(chart.yearPillar)).toBe('癸卯');
  });

  test('Feb 4, 2024 switches to 甲辰 year', () => {
    const chart = calculateBazi(new Date(Date.UTC(2024, 1, 4)));
    expect(pillarStr(chart.yearPillar)).toBe('甲辰');
  });
});

// ----- Hour Pillar -----

describe('Hour Pillar calculation', () => {
  test('hour 23 maps to 子 zi (branch 0)', () => {
    const chart = calculateBazi(new Date(Date.UTC(2024, 1, 4)), 23);
    expect(chart.hourPillar).toBeDefined();
    expect(chart.hourPillar!.branch).toBe('zi');
  });

  test('hour 0 maps to 子 zi (branch 0)', () => {
    const chart = calculateBazi(new Date(Date.UTC(2024, 1, 4)), 0);
    expect(chart.hourPillar!.branch).toBe('zi');
  });

  test('hour 11 maps to 午 wu (branch 6)', () => {
    const chart = calculateBazi(new Date(Date.UTC(2024, 1, 4)), 11);
    expect(chart.hourPillar!.branch).toBe('wu');
  });

  test('no hour pillar when birthHour is undefined', () => {
    const chart = calculateBazi(new Date(Date.UTC(2024, 1, 4)));
    expect(chart.hourPillar).toBeUndefined();
  });
});

// ----- Enriched Bazi consistency -----

describe('calculateEnrichedBazi matches calculateBazi', () => {
  for (const tc of KNOWN_DATES) {
    test(tc.label, () => {
      const date = new Date(Date.UTC(tc.y, tc.m - 1, tc.d));
      const basic = calculateBazi(date, 9);
      const enriched = calculateEnrichedBazi(date, 9);

      expect(enriched.year.stem).toBe(basic.yearPillar.stem);
      expect(enriched.year.branch).toBe(basic.yearPillar.branch);
      expect(enriched.month.stem).toBe(basic.monthPillar.stem);
      expect(enriched.month.branch).toBe(basic.monthPillar.branch);
      expect(enriched.day.stem).toBe(basic.dayPillar.stem);
      expect(enriched.day.branch).toBe(basic.dayPillar.branch);
      expect(enriched.hour!.stem).toBe(basic.hourPillar!.stem);
      expect(enriched.hour!.branch).toBe(basic.hourPillar!.branch);
    });
  }
});

// ----- Buddhist Era conversion -----

describe('Buddhist Era ↔ Gregorian conversion', () => {
  const BE_OFFSET = 543;
  const cases = [
    [2569, 2026],
    [2567, 2024],
    [2543, 2000],
    [2528, 1985],
    [2443, 1900],
  ];

  for (const [be, greg] of cases) {
    test(`BE ${be} = Gregorian ${greg}`, () => {
      expect(be - BE_OFFSET).toBe(greg);
      expect(greg + BE_OFFSET).toBe(be);
    });
  }
});

// ----- UTC date creation (simulating onboarding) -----

describe('Onboarding date flow: BE year → UTC Date', () => {
  test('BE 2528 Mar 15 → 1985-03-15T00:00:00.000Z', () => {
    const beYear = 2528;
    const month = 2; // March (0-indexed)
    const day = 15;
    const gregorianYear = beYear - 543;
    const date = new Date(Date.UTC(gregorianYear, month, day));

    expect(date.toISOString()).toBe('1985-03-15T00:00:00.000Z');
    expect(date.getUTCFullYear()).toBe(1985);
    expect(date.getUTCMonth()).toBe(2);
    expect(date.getUTCDate()).toBe(15);
  });

  test('BE 2543 Jan 1 → 2000-01-01T00:00:00.000Z', () => {
    const date = new Date(Date.UTC(2543 - 543, 0, 1));
    expect(date.toISOString()).toBe('2000-01-01T00:00:00.000Z');
  });
});
