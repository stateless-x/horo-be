import { describe, test, expect } from 'bun:test';
import {
  calculateEnrichedBazi,
  calculateElementProfile,
  calculatePillarInteractions,
  calculateChartCategoryScores,
} from '../lib/astrology';
import { calculateThaiAstrology } from '../lib/astrology';
import { getReadingPeriod } from '../lib/shared/utils/date';
import { buildStructuredChartPrompt } from '../src/lib/prompts';
import { validateStructuredFortuneReading } from '../src/lib/llm';

describe('getReadingPeriod', () => {
  test('stamps a September date with the Thai month and BE year', () => {
    // Local constructor, matching how getBangkokDate()'s value reads: its
    // local getters carry Bangkok wall-clock time.
    expect(getReadingPeriod(new Date(2026, 8, 5))).toEqual({
      yearMonth: '2026-09',
      monthTh: 'กันยายน',
      yearBe: 2569,
    });
  });

  test('rolls the BE year forward in January of the next Gregorian year', () => {
    expect(getReadingPeriod(new Date(2027, 0, 5))).toEqual({
      yearMonth: '2027-01',
      monthTh: 'มกราคม',
      yearBe: 2570,
    });
  });

  test('zero-pads the month so yearMonth matches the regeneration key', () => {
    expect(getReadingPeriod(new Date(2026, 2, 31)).yearMonth).toBe('2026-03');
  });
});

describe('structured chart prompt', () => {
  function renderChartPrompt() {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const pillars = calculateEnrichedBazi(birthDate, 2, 'male');
    const elementProfile = calculateElementProfile(pillars.day);
    const interactions = calculatePillarInteractions(pillars);
    const scores = calculateChartCategoryScores(elementProfile, pillars, interactions);

    return buildStructuredChartPrompt(
      'Purin',
      birthDate,
      pillars,
      elementProfile,
      interactions,
      calculateThaiAstrology(birthDate),
      '31 ปี 9 เดือน 10 วัน',
      'INTP',
      scores,
      { yearMonth: '2026-09', monthTh: 'กันยายน', yearBe: 2569 },
      new Date(2026, 8, 5),
    );
  }

  test('tells the model the reading month, the BE year and today', () => {
    const prompt = renderChartPrompt();

    expect(prompt).toContain('เดือนกันยายน พ.ศ. 2569');
    expect(prompt).toContain('2026-09');
    expect(prompt).toContain('วันนี้คือ 5 กันยายน 2569');
  });

  test('asks for a per-category hook and anchors monthlyHighlights to the reading month', () => {
    const prompt = renderChartPrompt();

    expect(prompt).toContain('hook');
    expect(prompt).toContain('ไม่เกิน 40 ตัวอักษรไทย');
    expect(prompt).toContain('ต้องเริ่มจากเดือนกันยายน');
  });

  test('leaves no unrendered period placeholders', () => {
    expect(renderChartPrompt()).not.toContain('{{readingMonthTh}}');
  });
});

describe('structured fortune validation', () => {
  const category = {
    key: 'love',
    score: 72,
    hook: 'เดือนนี้ความรักของเจ้าเริ่มมีจังหวะ',
    reading: 'คำทำนายความรัก',
    tips: ['ทิป'],
    warnings: ['คำเตือน'],
  };

  function payload(readings: unknown[]) {
    return {
      personalityTraits: ['มีวินัย'],
      pillarInterpretations: [
        { pillarKey: 'year', interpretation: 'a', pillarRelationships: 'b' },
      ],
      birthStarDetails: {
        planetDescription: 'a',
        luckyColorTooltip: 'b',
        luckyNumberTooltip: 'c',
        luckyDirectionTooltip: 'd',
        luckyDayTooltip: 'e',
      },
      fortuneReadings: readings,
      recommendations: {
        luckyColors: ['ม่วง'],
        luckyNumbers: [3],
        luckyDirection: 'เหนือ',
        luckyDay: 'เสาร์',
        monthlyHighlights: [
          { month: 'ก.ย.', rating: 4, note: 'ดวงรักเด่น', description: 'รายละเอียด' },
        ],
        dos: ['ทำ'],
        donts: ['เลี่ยง'],
      },
    };
  }

  test('accepts a category carrying a hook', () => {
    expect(validateStructuredFortuneReading(payload([category]))).toBeNull();
  });

  test('rejects a category without a hook so the generation retries', () => {
    const { hook, ...withoutHook } = category;
    const error = validateStructuredFortuneReading(payload([withoutHook]));

    expect(error).toContain('fortuneReadings[0].hook');
  });
});
