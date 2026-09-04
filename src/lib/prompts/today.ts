/**
 * LLM Prompt for Today's Daily Reading
 *
 * Dedicated prompt for /dashboard/today - a focused daily fortune
 * with MBTI integration, lucky attributes, warnings, and suggestions.
 *
 * Uses the same mystical Thai narrator voice as all other prompts.
 * Prompt TEXT lives in ./md/today.md — edit that to change wording.
 */

import type { BaziChart, ThaiAstrology } from "../../../lib/shared";
import type { DailyPillar, ElementHarmony, DailyTheme, BranchClash } from "../../../lib/astrology/daily";
import { buildMbtiContext } from "../prompts";
import { renderPrompt, type PromptVars } from "./render";

import todayMd from "./md/today.md" with { type: "text" };

export interface DailyFortuneContext {
  todayPillar: DailyPillar;
  elementHarmony: ElementHarmony;
  dailyTheme: DailyTheme;
  branchClash: BranchClash;
}

/** Score-rule line per element-harmony favorability level. */
const FAVORABILITY_RULES: Record<string, string> = {
  very_favorable: "- วันมงคลมาก: scores ส่วนใหญ่ควรอยู่ที่ 4-5 (อย่างน้อย 2 หมวดต้องได้ 5)",
  favorable: "- วันดี: scores ส่วนใหญ่ควรอยู่ที่ 3-5 (อย่างน้อย 1 หมวดต้องได้ 4-5)",
  neutral: "- วันปกติ: scores กระจายตั้งแต่ 2-4 (มีทั้งดีและต้องระวัง)",
  challenging: "- วันท้าทาย: scores ส่วนใหญ่ควรอยู่ที่ 2-3 (อย่างน้อย 1 หมวดต้องได้ 1-2)",
};

/** Element -> supporting colors, injected into the luckyColor instruction. */
const ELEMENT_COLORS: Record<string, string> = {
  wood: "ไม้: เขียว, น้ำเงิน, ดำ",
  fire: "ไฟ: แดง, ส้ม, ชมพู, เขียว",
  earth: "ดิน: เหลือง, น้ำตาล, แดง, ส้ม",
  metal: "ทอง: ขาว, ทอง, เงิน, เหลือง",
  water: "น้ำ: ดำ, น้ำเงิน, ขาว, เงิน",
};

/**
 * Build the prompt for today's enhanced daily reading.
 *
 * Combines Chinese Bazi + Thai astrology + MBTI (if available)
 * to generate a personalized daily fortune with:
 * - Overall reading, category scores, lucky attributes
 * - Warnings and actionable suggestions
 * - Dos/donts for the day
 *
 * @param natalThaiAstrology - Thai astrology derived from user's birth date (natal planet, personality)
 * @param todayThaiAstrology - Thai astrology derived from today's date (today's color, lucky number, direction)
 * @param dailyContext - Today's Bazi pillar, element harmony, theme, and clash data
 */
export function buildTodayPrompt(
  name: string,
  birthDate: Date,
  today: Date,
  baziChart: BaziChart,
  natalThaiAstrology: ThaiAstrology,
  mbtiType?: string | null,
  todayThaiAstrology?: ThaiAstrology,
  dailyContext?: DailyFortuneContext,
): string {
  const birthDateStr = birthDate.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const todayStr = today.toLocaleDateString("th-TH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Today's lucky attributes: prefer today's day data, fall back to natal if not provided
  const daily = todayThaiAstrology ?? natalThaiAstrology;

  const pillars =
    `${baziChart.yearPillar.stem}${baziChart.yearPillar.branch} (ปี), ` +
    `${baziChart.monthPillar.stem}${baziChart.monthPillar.branch} (เดือน), ` +
    `${baziChart.dayPillar.stem}${baziChart.dayPillar.branch} (วัน)` +
    (baziChart.hourPillar ? `, ${baziChart.hourPillar.stem}${baziChart.hourPillar.branch} (ชั่วโมง)` : "");

  const vars: PromptVars = {
    name,
    birthDateStr,
    todayStr,
    element: baziChart.element,
    dayMaster: baziChart.dayMaster,
    pillars,
    natalDay: natalThaiAstrology.day,
    natalPlanet: natalThaiAstrology.planet,
    natalPersonality: natalThaiAstrology.personality,
    todayThaiDay: daily.day,
    todayThaiPlanet: daily.planet,
    mbtiContext: buildMbtiContext(mbtiType),
    mbti: Boolean(mbtiType),
    mbtiType: mbtiType ?? '',
    daily: Boolean(dailyContext),
    clash: Boolean(dailyContext?.branchClash.hasClash),
  };

  if (dailyContext) {
    const { todayPillar, elementHarmony, dailyTheme, branchClash } = dailyContext;
    Object.assign(vars, {
      todayStemBranch: `${todayPillar.stemChinese}${todayPillar.branchChinese}`,
      todayStemBranchEn: `${todayPillar.stem}-${todayPillar.branch}`,
      todayElement: todayPillar.element,
      todayAnimal: todayPillar.animal,
      todayYinYang: todayPillar.yinYang,
      userElement: elementHarmony.userElement,
      harmonyTodayElement: elementHarmony.todayElement,
      harmonyRelationship: elementHarmony.relationship,
      favorability: elementHarmony.favorability,
      harmonyDescription: elementHarmony.description,
      favorabilityRule: FAVORABILITY_RULES[elementHarmony.favorability] ?? FAVORABILITY_RULES.neutral,
      elementColorsLine: ELEMENT_COLORS[elementHarmony.userElement] ?? ELEMENT_COLORS.water,
      dailyTheme: dailyTheme.theme,
      clashWarning: branchClash.hasClash ? branchClash.warning : '',
    });
  }

  return renderPrompt(todayMd, vars);
}
