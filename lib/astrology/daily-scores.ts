import type { ElementRelationship, ElementHarmony, BranchClash } from './daily';

export type DailyCategory = 'career' | 'love' | 'finance' | 'health';

/**
 * Base score per element-harmony favorability level. Chosen so that after adding
 * the widest affinity/clash swings below, every combination still lands inside
 * 1..5 without saturating (see ELEMENT_AFFINITY and BRANCH_MODIFIER comments).
 */
const BASE_SCORE: Record<ElementHarmony['favorability'], number> = {
  very_favorable: 4,
  favorable: 3,
  neutral: 3,
  challenging: 2,
};

/**
 * Per-category, per-element-relationship affinity, added to the base score.
 * Values are 0 or +1 only — kept small and non-negative so BASE_SCORE.challenging
 * (2) never needs to go below 1 after the branch-clash penalty is also applied.
 *
 * Each column encodes which categories the day's element relationship favors:
 * - career (metal — decisiveness, structure): favored when the user's day
 *   element actively acts on today (producing/produced_by/controlling)
 * - finance (earth — accumulation, stability): favored by steady/receptive
 *   relationships (controlled_by/same/neutral) rather than active ones
 * - love (water — flow, connection): favored when today's element nourishes
 *   the user (produced_by) or mirrors them (same)
 * - health (wood — vitality, growth): favored by producing/controlling/
 *   controlled_by — anything that puts the body's energy into motion
 *
 * Invariant (verified in tests): for every relationship, career's value differs
 * from finance's, and love's value differs from health's. That guarantees the
 * four scores are never all-equal even on a no-clash day, because within both
 * pairs at least one category is pulled apart from its partner.
 */
const ELEMENT_AFFINITY: Record<DailyCategory, Record<ElementRelationship, number>> = {
  career: {
    producing: 1,
    produced_by: 1,
    controlling: 1,
    controlled_by: 0,
    same: 0,
    neutral: 0,
  },
  finance: {
    producing: 0,
    produced_by: 0,
    controlling: 0,
    controlled_by: 1,
    same: 1,
    neutral: 1,
  },
  love: {
    producing: 0,
    produced_by: 1,
    controlling: 0,
    controlled_by: 0,
    same: 1,
    neutral: 0,
  },
  health: {
    producing: 1,
    produced_by: 0,
    controlling: 1,
    controlled_by: 1,
    same: 0,
    neutral: 1,
  },
};

type ClashState = 'none' | 'year' | 'day';

/**
 * Per-category branch-clash penalty. A `year` clash (family/social, per
 * checkBranchClash's own reading — see daily.ts:272) hits career and finance.
 * A `day` clash (personal/emotional, daily.ts:284) hits love and health.
 * Categories untouched by the clash type get no penalty.
 */
const BRANCH_MODIFIER: Record<DailyCategory, Record<ClashState, number>> = {
  career: { none: 0, year: -1, day: 0 },
  finance: { none: 0, year: -1, day: 0 },
  love: { none: 0, year: 0, day: -1 },
  health: { none: 0, year: 0, day: -1 },
};

function clashState(branchClash: BranchClash): ClashState {
  if (!branchClash.hasClash || !branchClash.clashType) return 'none';
  return branchClash.clashType;
}

/**
 * Calculate a deterministic 1-5 score for one daily category from the
 * element-harmony relationship and any Earthly Branch clash. Same inputs
 * always yield the same score — no LLM sampling involved.
 */
export function calculateCategoryScore(
  category: DailyCategory,
  elementHarmony: ElementHarmony,
  branchClash: BranchClash,
): number {
  const raw =
    BASE_SCORE[elementHarmony.favorability] +
    ELEMENT_AFFINITY[category][elementHarmony.relationship] +
    BRANCH_MODIFIER[category][clashState(branchClash)];

  return Math.max(1, Math.min(5, Math.round(raw)));
}

/**
 * Calculate all four daily category scores at once. Mirrors
 * calculateCompatibility's role in compatibility.ts: the single entry point
 * that turns already-computed astrology data into deterministic numbers,
 * leaving the LLM to narrate rather than choose them.
 */
export function calculateDailyCategoryScores(
  elementHarmony: ElementHarmony,
  branchClash: BranchClash,
): Record<DailyCategory, number> {
  return {
    career: calculateCategoryScore('career', elementHarmony, branchClash),
    love: calculateCategoryScore('love', elementHarmony, branchClash),
    finance: calculateCategoryScore('finance', elementHarmony, branchClash),
    health: calculateCategoryScore('health', elementHarmony, branchClash),
  };
}

/**
 * Bounds for the headline overall score, per favorability. Without these the
 * rounded mean lets a `challenging` day display 3/5 — the same as a good day —
 * because a 2.5 mean rounds up. Capping keeps the hero score honest while
 * leaving the within-tier variation the mean provides.
 */
const OVERALL_BOUNDS: Record<ElementHarmony['favorability'], { min: number; max: number }> = {
  very_favorable: { min: 4, max: 5 },
  favorable: { min: 3, max: 4 },
  neutral: { min: 3, max: 4 },
  challenging: { min: 1, max: 2 },
};

/**
 * Headline 1-5 score for the day: the mean of the four category scores, held
 * inside the band its favorability allows.
 */
export function calculateOverallScore(
  scores: Record<DailyCategory, number>,
  elementHarmony: ElementHarmony,
): number {
  const mean = (scores.career + scores.love + scores.finance + scores.health) / 4;
  const { min, max } = OVERALL_BOUNDS[elementHarmony.favorability];
  return Math.max(min, Math.min(max, Math.round(mean)));
}
