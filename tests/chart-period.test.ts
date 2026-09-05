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
import { validateStructuredFortuneReading, isSoftValidationError } from '../src/lib/llm';

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

  const pillarFixture = {
    pillarKey: 'year',
    interpretation: 'a',
    pillarRelationships: 'b',
    summary: 'เสาปีบอกรากฐานชีวิตของเจ้า',
    tips: ['ฟังความเห็นครอบครัวก่อนตัดสินใจใหญ่', 'วางแผนการเงินระยะยาวไว้ล่วงหน้า'],
    warning: 'บางครั้งเจ้ายึดติดกับความมั่นคงจนพลาดโอกาสใหม่ ลองเปิดใจดูบ้าง',
  };

  function payload(readings: unknown[], pillarInterpretations: unknown[] = [pillarFixture]) {
    return {
      personalityTraits: ['มีวินัย'],
      pillarInterpretations,
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

  test('rejects a pillar missing summary so the generation retries', () => {
    const { summary, ...withoutSummary } = pillarFixture;
    const error = validateStructuredFortuneReading(payload([category], [withoutSummary]));

    expect(error).toContain('pillarInterpretations[0].summary');
  });

  test('rejects a pillar missing tips or warning so the generation retries', () => {
    const { tips, ...withoutTips } = pillarFixture;
    const { warning, ...withoutWarning } = pillarFixture;

    expect(validateStructuredFortuneReading(payload([category], [withoutTips]))).toContain(
      'pillarInterpretations[0].tips',
    );
    expect(validateStructuredFortuneReading(payload([category], [withoutWarning]))).toContain(
      'pillarInterpretations[0].warning',
    );
  });
});

describe('chart prompt pillar content', () => {
  function pillarSectionOfPrompt() {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const pillars = calculateEnrichedBazi(birthDate, 2, 'male');
    const elementProfile = calculateElementProfile(pillars.day);
    const interactions = calculatePillarInteractions(pillars);
    const scores = calculateChartCategoryScores(elementProfile, pillars, interactions);

    const prompt = buildStructuredChartPrompt(
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

    // Isolate the pillarInterpretations instructions from the rest of the
    // prompt (fortuneReadings and recommendations also mention tips/warning)
    // so these assertions can only pass if the pillar section itself asks
    // for the three new fields, not because the words appear elsewhere.
    const start = prompt.indexOf('pillarInterpretations:');
    const end = prompt.indexOf('birthStarDetails:');
    return prompt.slice(start, end);
  }

  test('asks for a pillar summary capped at 60 Thai characters', () => {
    const section = pillarSectionOfPrompt();
    expect(section).toContain('summary');
    expect(section).toContain('60 ตัวอักษรไทย');
  });

  test('asks for pillar tips as concrete actions', () => {
    const section = pillarSectionOfPrompt();
    expect(section).toContain('tips');
  });

  test('asks for a pillar warning phrased as a heads-up, capped at 120 Thai characters', () => {
    const section = pillarSectionOfPrompt();
    expect(section).toContain('warning');
    expect(section).toContain('120 ตัวอักษรไทย');
  });
});


describe('isSoftValidationError', () => {
  test('missing hooks and pillar extras are soft', () => {
    expect(isSoftValidationError('Missing required fields: fortuneReadings[2].hook, pillarInterpretations[0].warning, pillarInterpretations[3].tips')).toBe(true);
  });
  test('a missing hard field is not soft, even alongside soft ones', () => {
    expect(isSoftValidationError('Missing required fields: fortuneReadings[2].hook, fortuneReadings[2].reading')).toBe(false);
    expect(isSoftValidationError('Missing required fields: pillarInterpretations[1].interpretation')).toBe(false);
    expect(isSoftValidationError('Missing required fields: recommendations.monthlyHighlights[0].month')).toBe(false);
  });
  test('non-validator messages are not soft', () => {
    expect(isSoftValidationError('Empty response from DeepSeek')).toBe(false);
    expect(isSoftValidationError('')).toBe(false);
  });
});
