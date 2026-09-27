import { generateTeaserReading, type OnModelCall } from '../../lib/llm';
import {
  calculateBazi,
  calculateThaiAstrology,
  getDailyScoresForChart,
  selectFocusArea,
  buildTraitChips,
  normalizeMbtiType,
} from '../../../lib/astrology';
import type { BirthProfile } from '../../../lib/shared';
import { buildTeaserPrompt } from '../../lib/prompts';
import { getTodayBangkokString, getBangkokDate } from '../../../lib/shared/utils/date';

/**
 * The onboarding teaser from birth data alone: charts, today's deterministic
 * scores, trait chips, prompt and model call. No database, rate limit or
 * single-flight; POST /api/fortune/teaser wraps it with those, and the dev
 * generator tool calls it directly.
 */
export async function generateTeaser(profile: BirthProfile, onModelCall?: OnModelCall) {
  const calcStart = performance.now();
  const name = profile.name || 'ผู้มาเยือน';
  const birthDate = new Date(profile.birthDate);
  const birthHour = profile.birthTime?.isUnknown ? undefined : profile.birthTime?.chineseHour;
  const mbtiType = normalizeMbtiType(profile.mbtiType);

  // Calculate astrology
  const baziChart = calculateBazi(birthDate, birthHour, profile.gender);
  const thaiAstrology = calculateThaiAstrology(birthDate);

  // Same shared helper /daily calls — identical birth data + Bangkok day
  // always yields identical scores on both endpoints.
  const todayBangkok = getBangkokDate();
  const { scores } = getDailyScoresForChart(baziChart, todayBangkok);
  const focusArea = selectFocusArea(scores);

  // Deterministic trait chips, no LLM — thai + bazi always, mbti only
  // when a valid type was given.
  const traitChips = buildTraitChips(thaiAstrology.day, baziChart.element, mbtiType);

  // Generate AI reading using comprehensive prompt
  const prompt = buildTeaserPrompt(
    name,
    birthDate,
    baziChart,
    thaiAstrology,
    mbtiType,
    focusArea,
    scores[focusArea],
    traitChips,
  );

  const llmStart = performance.now();
  const { threeWay, reading } = await generateTeaserReading(prompt, name, onModelCall);
  const llmEnd = performance.now();

  const result = {
    contentVersion: 2 as const,
    elementType: baziChart.element,
    luckyColor: thaiAstrology.color,
    luckyNumber: thaiAstrology.luckyNumber,
    personality: thaiAstrology.personality,
    todaySnippet: reading,
    threeWay,
    reading,
    focusArea,
    traitChips,
    scores: {
      date: getTodayBangkokString(),
      love: scores.love,
      career: scores.career,
      finance: scores.finance,
      health: scores.health,
    },
  };

  return {
    result,
    prompt,
    timings: { calcMs: Math.round(llmStart - calcStart), llmMs: Math.round(llmEnd - llmStart) },
  };
}
