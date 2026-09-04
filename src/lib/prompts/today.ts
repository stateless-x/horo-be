/**
 * LLM Prompt for Today's Daily Reading
 *
 * Dedicated prompt for /dashboard/today - a focused daily fortune
 * with MBTI integration, lucky attributes, warnings, and actions.
 *
 * Uses the same mystical Thai narrator voice as all other prompts.
 * Prompt TEXT lives in ./md/today.md — edit that to change wording.
 */

import type { BaziChart, ThaiAstrology } from "../../../lib/shared";
import type { DailyPillar, ElementHarmony, DailyTheme, BranchClash } from "../../../lib/astrology/daily";
import { calculateDailyCategoryScores, calculateOverallScore } from "../../../lib/astrology/daily-scores";
import { buildMbtiContext } from "../prompts";
import { renderPrompt, type PromptVars } from "./render";

import todayMd from "./md/today.md" with { type: "text" };

export interface DailyFortuneContext {
  todayPillar: DailyPillar;
  elementHarmony: ElementHarmony;
  dailyTheme: DailyTheme;
  branchClash: BranchClash;
}

export interface RecentDailyReadingContext {
  date: string;
  dailyTheme?: string;
  themeKey?: string;
  focusKey?: string;
  hookLine?: string;
  actionTags?: string[];
}

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
 * - Warnings and actionable dos/donts
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
  recentReadings: RecentDailyReadingContext[] = [],
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
    hasRecentReadings: recentReadings.length > 0,
    recentReadingsJson: JSON.stringify(recentReadings),
  };

  if (dailyContext) {
    const { todayPillar, elementHarmony, dailyTheme, branchClash } = dailyContext;
    // Scores are computed in code (lib/astrology/daily-scores.ts), not chosen by the
    // model — this is what makes them deterministic across regenerations of the same
    // day. The model only narrates these fixed numbers; routes.ts overwrites
    // categories[k].score with the same values as a hard guarantee either way.
    const categoryScores = calculateDailyCategoryScores(elementHarmony, branchClash);
    const overallScore = calculateOverallScore(categoryScores, elementHarmony);
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
      elementColorsLine: ELEMENT_COLORS[elementHarmony.userElement] ?? ELEMENT_COLORS.water,
      dailyTheme: dailyTheme.theme,
      clashWarning: branchClash.hasClash ? branchClash.warning : '',
      overallScoreValue: overallScore,
      careerScoreValue: categoryScores.career,
      loveScoreValue: categoryScores.love,
      financeScoreValue: categoryScores.finance,
      healthScoreValue: categoryScores.health,
    });
  }

  return renderPrompt(todayMd, vars);
}
