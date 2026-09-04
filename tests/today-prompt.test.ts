import { describe, expect, test } from 'bun:test';
import {
  calculateBazi,
  calculateThaiAstrology,
  calculateTodayThaiAstrology,
  getDailyFortuneContext,
} from '../lib/astrology';
import { buildTodayPrompt } from '../src/lib/prompts/today';

describe('daily v2 prompt', () => {
  test('requests the compact contract and includes recent novelty context', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const today = new Date(Date.UTC(2026, 8, 4));
    const bazi = calculateBazi(birthDate, 2, 'male');
    const natalThai = calculateThaiAstrology(birthDate);
    const todayThai = calculateTodayThaiAstrology(today);
    const dailyContext = getDailyFortuneContext(today, bazi);

    const prompt = buildTodayPrompt(
      'Purin',
      birthDate,
      today,
      bazi,
      natalThai,
      'INTP',
      todayThai,
      dailyContext,
      [{
        date: '2026-09-03',
        dailyTheme: 'วันแห่งการวิเคราะห์',
        themeKey: 'deep_analysis',
        focusKey: 'career',
        hookLine: 'จัดลำดับความคิดก่อนตัดสินใจเรื่องงาน',
        actionTags: ['prioritize_work', 'pause_before_deciding'],
      }],
    );

    expect(prompt).toContain('1. themeKey');
    expect(prompt).toContain('2. focusKey');
    expect(prompt).toContain('3. actionTags');
    expect(prompt).toContain('5. hookLine');
    expect(prompt).toContain('overallReading: คำทำนายภาพรวมวันนี้ ไม่เกิน 3 ประโยค');
    expect(prompt).toContain('reading ไม่เกิน 2 ประโยค');
    expect(prompt).toContain('"themeKey":"deep_analysis"');
    expect(prompt).toContain('พลังนี้ต่อเนื่องจากเมื่อวาน');
    expect(prompt).not.toContain('suggestions:');
  });

  test('renders without a recent-history block for a first reading', () => {
    const birthDate = new Date(Date.UTC(2000, 0, 1));
    const today = new Date(Date.UTC(2026, 8, 4));
    const bazi = calculateBazi(birthDate);

    const prompt = buildTodayPrompt(
      'ผู้มาเยือน',
      birthDate,
      today,
      bazi,
      calculateThaiAstrology(birthDate),
      null,
      calculateTodayThaiAstrology(today),
      getDailyFortuneContext(today, bazi),
    );

    expect(prompt).not.toContain('ประวัติ 7 วันที่ผ่านมา');
    expect(prompt).not.toContain('{{');
  });
});
