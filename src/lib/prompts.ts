/**
 * LLM Prompts for Fortune Readings
 *
 * All fortune generation goes through DeepSeek via the backend (see lib/llm.ts).
 * The narrator speaks in Thai using "เจ้า" (thou) to address the user.
 * Tone: mysterious, sacred, slightly unsettling - like entering a temple at midnight.
 *
 * Prompt TEXT lives in the markdown files under ./prompts/md/ — edit those to
 * change wording. This module only assembles chart data into the templates
 * (see ./prompts/render.ts for the {{var}} / {{#block}} syntax).
 */

import type { BaziChart, ThaiAstrology, EnrichedPillar, ElementProfile, PillarInteraction, RelationshipType, MbtiType } from "../../lib/shared";
import type { FortuneCategoryKey } from "../../lib/shared/types/astrology";
import { getMbtiInfo, getMbtiCognitiveFunctions, getMbtiActionableGuidance } from "../../lib/shared";
import { getReadingPeriod, toBuddhistYear } from "../../lib/shared/utils/date";
import { THAI_MONTHS_FULL } from "../../lib/shared/constants/thai-time";
import { renderPrompt } from "./prompts/render";
import { buildTraitChips, type DailyCategory, type TraitChip } from "../../lib/astrology";

import systemMd from "./prompts/md/system.md" with { type: "text" };
import systemStructuredMd from "./prompts/md/system-structured.md" with { type: "text" };
import teaserMd from "./prompts/md/teaser.md" with { type: "text" };
import chartMd from "./prompts/md/chart.md" with { type: "text" };
import compatibilityMd from "./prompts/md/compatibility.md" with { type: "text" };
import compatibilityMbtiGuidanceMd from "./prompts/md/compatibility-mbti-guidance.md" with { type: "text" };
import mbtiContextMd from "./prompts/md/mbti-context.md" with { type: "text" };
import focusTalkingMd from "./prompts/md/compatibility-focus/talking.md" with { type: "text" };
import focusRomanticMd from "./prompts/md/compatibility-focus/romantic.md" with { type: "text" };
import focusBossMd from "./prompts/md/compatibility-focus/boss.md" with { type: "text" };
import focusCoworkerMd from "./prompts/md/compatibility-focus/coworker.md" with { type: "text" };
import focusFriendMd from "./prompts/md/compatibility-focus/friend.md" with { type: "text" };
import focusFamilyMd from "./prompts/md/compatibility-focus/family.md" with { type: "text" };

/**
 * System prompt for all LLM calls
 * Ensures consistent narrator voice and Thai cultural context
 */
export const SYSTEM_PROMPT = systemMd.trimEnd();

/**
 * System prompt variant for structured JSON output
 * Used with the LLM client's JSON output mode (see lib/llm.ts)
 */
export const SYSTEM_PROMPT_STRUCTURED = systemStructuredMd.trimEnd();

/**
 * Build MBTI context block for LLM prompts.
 * Returns empty string if mbtiType is null/undefined (excluded from prompt entirely).
 *
 * Enhanced version: Includes actionable guidance for practical, personalized advice.
 */
export function buildMbtiContext(mbtiType: string | null | undefined): string {
  if (!mbtiType) return '';

  const info = getMbtiInfo(mbtiType);
  const cognitive = getMbtiCognitiveFunctions(mbtiType);
  const guidance = getMbtiActionableGuidance(mbtiType);
  if (!info || !cognitive || !guidance) return '';

  const numbered = (items: string[]) => items.map((item, i) => `${i + 1}. ${item}`).join('\n');

  return '\n' + renderPrompt(mbtiContextMd, {
    code: info.code,
    nameTh: info.nameTh,
    dominantFunction: cognitive.dominantFunction,
    auxiliaryFunction: cognitive.auxiliaryFunction,
    strengths: cognitive.strengths,
    weaknesses: cognitive.weaknesses,
    decisionMaking: guidance.decisionMaking,
    relationshipStyle: guidance.relationshipStyle,
    pitfalls: numbered(guidance.pitfalls),
    strengthsToLeverage: numbered(guidance.strengthsToLeverage),
    warnings: numbered(guidance.warnings),
  }).trimEnd();
}

/** Thai display label for each daily category, teaser-prompt only — the other
 * prompts (today.md, chart.md) each spell their own labels inline the same way. */
const FOCUS_AREA_LABELS_TH: Record<DailyCategory, string> = {
  love: 'ความรัก',
  career: 'การงาน',
  finance: 'การเงิน',
  health: 'สุขภาพ',
};

/**
 * Thai description of a deterministic score band, for the LLM to write to
 * without inventing its own severity. Bands mirror the neutral midpoint (60)
 * that selectFocusArea measures distance from — see daily-scores.ts.
 */
function focusBandTh(score: number): string {
  if (score >= 75) return 'ดีมาก';
  if (score >= 60) return 'ดี';
  if (score >= 45) return 'ปกติ ต้องระวังเล็กน้อย';
  return 'ต้องใส่ใจเป็นพิเศษ';
}

/**
 * Generate teaser reading (Step 6 in onboarding - BEFORE auth)
 * Enticing short preview designed to hook the user into signing up.
 * Teaser v2: MBTI-aware (when given), grounded in the same deterministic trait
 * chips and focus area shown on screen, so the LLM's threeWay/reading narrate
 * what the user already sees rather than inventing a fourth, disconnected claim.
 */
export function buildTeaserPrompt(
  name: string,
  birthDate: Date,
  baziChart: BaziChart,
  thaiAstrology: ThaiAstrology,
  mbtiType: MbtiType | null,
  focusArea: DailyCategory,
  focusScore: number,
  traitChips: TraitChip[],
): string {
  const dateStr = birthDate.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const currentPeriod = new Date().toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
  });

  const thaiChip = traitChips.find((c) => c.system === 'thai');
  const baziChip = traitChips.find((c) => c.system === 'bazi');
  const mbtiChip = traitChips.find((c) => c.system === 'mbti');
  const mbtiInfo = mbtiType ? getMbtiInfo(mbtiType) : undefined;

  return renderPrompt(teaserMd, {
    name,
    birthDateStr: dateStr,
    currentPeriod,
    element: baziChart.element,
    dayMaster: baziChart.dayMaster,
    yearPillar: `${baziChart.yearPillar.stem}${baziChart.yearPillar.branch}`,
    dayPillar: `${baziChart.dayPillar.stem}${baziChart.dayPillar.branch}`,
    thaiDay: thaiAstrology.day,
    personality: thaiAstrology.personality,
    color: thaiAstrology.color,
    luckyNumber: thaiAstrology.luckyNumber,
    thaiTrait: thaiChip ? `${thaiChip.label}: ${thaiChip.trait}` : '',
    baziTrait: baziChip ? `${baziChip.label}: ${baziChip.trait}` : '',
    mbti: Boolean(mbtiType && mbtiInfo && mbtiChip),
    mbtiTrait: mbtiChip ? `${mbtiChip.label}: ${mbtiChip.trait}` : '',
    mbtiType: mbtiType ?? '',
    mbtiNameTh: mbtiInfo?.nameTh ?? '',
    focusAreaTh: FOCUS_AREA_LABELS_TH[focusArea],
    focusBand: focusBandTh(focusScore),
  });
}

/**
 * Relationship-type-specific focus instructions for compatibility prompt
 */
const RELATIONSHIP_FOCUS: Record<RelationshipType, string> = {
  talking: focusTalkingMd.trimEnd(),
  romantic: focusRomanticMd.trimEnd(),
  boss: focusBossMd.trimEnd(),
  coworker: focusCoworkerMd.trimEnd(),
  friend: focusFriendMd.trimEnd(),
  family: focusFamilyMd.trimEnd(),
};

/**
 * Generate compatibility reading between two people
 * Analyzes element interactions and relationship dynamics
 * Tailored to the specific relationship type
 */
export function buildCompatibilityPrompt(
  person1: {
    name: string;
    birthDate: Date;
    baziChart: BaziChart;
    thaiAstrology: ThaiAstrology;
    mbtiType?: string | null;
  },
  person2: {
    name: string;
    birthDate: Date;
    baziChart: BaziChart;
    thaiAstrology: ThaiAstrology;
    mbtiType?: string | null;
  },
  relationshipType: RelationshipType = 'romantic',
  scoreContext: {
    score: number;
    scoreExplanation: string;
    strengths: string[];
    challenges: string[];
  },
): string {
  const mbtiGuidance = person1.mbtiType ? getMbtiActionableGuidance(person1.mbtiType) : null;

  const relationGuidance = mbtiGuidance
    ? (relationshipType === 'romantic' ? mbtiGuidance.loveGuidance :
       relationshipType === 'family' ? mbtiGuidance.familyGuidance :
       relationshipType === 'boss' || relationshipType === 'coworker' ? mbtiGuidance.careerGuidance :
       mbtiGuidance.socialGuidance)
    : '';

  const mbtiGuidanceBlock = mbtiGuidance
    ? '\n' + renderPrompt(compatibilityMbtiGuidanceMd, {
        relationGuidance,
        pitfalls: mbtiGuidance.pitfalls.map((p, i) => `${i + 1}. ${p}`).join('\n'),
        warnings: mbtiGuidance.warnings.slice(0, 3).map((w, i) => `${i + 1}. ${w}`).join('\n'),
      }).trim()
    : '';

  return renderPrompt(compatibilityMd, {
    mbti: Boolean(person1.mbtiType),
    p2Name: person2.name,
    p1BirthDate: person1.birthDate.toLocaleDateString("th-TH"),
    p1DayMaster: person1.baziChart.dayMaster,
    p1Element: person1.baziChart.element,
    p1ThaiDay: person1.thaiAstrology.day,
    p1Planet: person1.thaiAstrology.planet,
    p2BirthDate: person2.birthDate.toLocaleDateString("th-TH"),
    p2DayMaster: person2.baziChart.dayMaster,
    p2Element: person2.baziChart.element,
    p2ThaiDay: person2.thaiAstrology.day,
    p2Planet: person2.thaiAstrology.planet,
    p2Mbti: Boolean(person2.mbtiType),
    p2MbtiType: person2.mbtiType ?? '',
    score: scoreContext.score,
    scoreExplanation: scoreContext.scoreExplanation,
    deterministicStrengths: scoreContext.strengths.map(item => `- ${item}`).join('\n'),
    deterministicChallenges: scoreContext.challenges.map(item => `- ${item}`).join('\n'),
    mbtiContext: buildMbtiContext(person1.mbtiType),
    mbtiGuidanceBlock,
    focusBlock: RELATIONSHIP_FOCUS[relationshipType],
  });
}

/**
 * Build structured chart prompt for the redesigned dashboard.
 * Implements the 2-step architecture:
 * - Step 1 data (deterministic) is embedded as JSON in the prompt
 * - Step 2 (creative) asks the LLM to synthesize readings in structured JSON
 */
export function buildStructuredChartPrompt(
  name: string,
  birthDate: Date,
  enrichedPillars: {
    year: EnrichedPillar;
    month: EnrichedPillar;
    day: EnrichedPillar;
    hour?: EnrichedPillar;
  },
  elementProfile: ElementProfile,
  pillarInteractions: PillarInteraction[],
  thaiAstrology: ThaiAstrology,
  currentAge: string,
  mbtiType?: string | null,
  /**
   * Deterministic 0-100 category scores (calculateChartCategoryScores). Passed
   * in so the model narrates to the number instead of inventing its own.
   */
  categoryScores?: Record<FortuneCategoryKey, number>,
  /**
   * The month this narrative is written for (getReadingPeriod), plus today's
   * date. A model has no clock, so without these it lands its month references
   * on arbitrary months and the chart reads as stale the day it is generated.
   */
  readingPeriod?: { yearMonth: string; monthTh: string; yearBe: number },
  today: Date = new Date(),
): string {
  const birthDateStr = birthDate.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const deterministicData = {
    name,
    birthDate: birthDateStr,
    currentAge,
    pillars: enrichedPillars,
    elementProfile,
    pillarInteractions,
    thaiAstrology,
  };

  const period = readingPeriod ?? getReadingPeriod();
  const todayTh = `${today.getDate()} ${THAI_MONTHS_FULL[today.getMonth()]} ${toBuddhistYear(today.getFullYear())}`;

  return renderPrompt(chartMd, {
    readingMonthTh: period.monthTh,
    readingYearBe: period.yearBe,
    readingYearMonth: period.yearMonth,
    todayTh,
    mbti: Boolean(mbtiType),
    mbtiType: mbtiType ?? '',
    // Compact JSON: pretty-print whitespace only inflates the token bill.
    deterministicJson: JSON.stringify(deterministicData),
    mbtiContext: buildMbtiContext(mbtiType),
    name,
    lifeOverviewScoreValue: categoryScores?.life_overview ?? '',
    loveScoreValue: categoryScores?.love ?? '',
    careerScoreValue: categoryScores?.career ?? '',
    financeScoreValue: categoryScores?.finance ?? '',
    healthScoreValue: categoryScores?.health ?? '',
    familyScoreValue: categoryScores?.family ?? '',
  });
}
