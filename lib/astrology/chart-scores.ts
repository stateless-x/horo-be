import type { Element } from '../shared';
import type {
  ElementProfile,
  EnrichedPillar,
  FortuneCategoryKey,
  PillarInteraction,
} from '../shared/types/astrology';
import { ELEMENT_PRODUCING, ELEMENT_CONTROLLING } from './constants';

/**
 * Deterministic 0-100 scores for the six chart categories.
 *
 * Mirrors calculateCompatibility (compatibility.ts) and calculateDailyCategoryScores
 * (daily-scores.ts): astrology data in, numbers out, leaving the LLM to narrate
 * rather than choose them. Previously the chart's per-category score was picked
 * freely by the LLM (prompts/md/chart.md), so it varied between regenerations of
 * an identical birth chart and could not be defended to a user who asked why.
 *
 * The chart is birth-derived, so these scores are STABLE FOR LIFE — the same
 * birth input always yields the same numbers. That is the intended meaning here:
 * enduring strength of each life area, not a monthly outlook. The month-to-month
 * movement in the product lives in recommendations.monthlyHighlights.
 */

export const CHART_CATEGORY_KEYS = [
  'life_overview', 'love', 'career', 'finance', 'health', 'family',
] as const satisfies readonly FortuneCategoryKey[];

/**
 * Which of the five elements each life area draws its strength from, in the
 * classical Wu Xing reading also used by daily-scores.ts:
 * metal = decisiveness/structure (career), earth = accumulation (finance),
 * water = flow/connection (love), wood = vitality/growth (health),
 * fire = warmth/hearth (family).
 */
const CATEGORY_ELEMENT: Record<Exclude<FortuneCategoryKey, 'life_overview'>, Element> = {
  career: 'metal',
  finance: 'earth',
  love: 'water',
  health: 'wood',
  family: 'fire',
};

/**
 * Base score from how the user's primary element relates to the element a life
 * area draws on. Centred on 62 (a deliberately unremarkable "fine") so the
 * modifiers below move scores in both directions instead of only downward.
 */
const RELATION_SCORE = {
  /** The user's element generates the area's element — effort flows outward easily. */
  producing: 78,
  /** The area's element generates the user's — the area feeds them. */
  produced_by: 84,
  /** Same element — familiar territory, strong but without tension to grow against. */
  same: 74,
  /** The user's element controls the area's — workable, but by force rather than flow. */
  controlling: 58,
  /** The area's element controls the user's — the area resists them. */
  controlled_by: 46,
  neutral: 62,
} as const;

type ElementRelation = keyof typeof RELATION_SCORE;

function relate(from: Element, to: Element): ElementRelation {
  if (from === to) return 'same';
  if (ELEMENT_PRODUCING[from] === to) return 'producing';
  if (ELEMENT_PRODUCING[to] === from) return 'produced_by';
  if (ELEMENT_CONTROLLING[from] === to) return 'controlling';
  if (ELEMENT_CONTROLLING[to] === from) return 'controlled_by';
  return 'neutral';
}

/** Pillar interactions nudge every category — a chart at war with itself scores lower. */
const INTERACTION_WEIGHT: Record<PillarInteraction['type'], number> = {
  producing: 3,
  same: 1,
  neutral: 0,
  weakening: -1,
  controlling: -3,
  overacting: -4,
};

const STRENGTH_MULTIPLIER: Record<PillarInteraction['strength'], number> = {
  strong: 1,
  mild: 0.6,
  weak: 0.3,
};

/**
 * Each pillar governs a life stage and its own life area (bazi.ts assigns
 * lifeArea per pillar). A category gets a bonus when the pillar most associated
 * with it carries the user's supporting elements.
 */
const CATEGORY_PILLAR: Record<Exclude<FortuneCategoryKey, 'life_overview'>, 'year' | 'month' | 'day' | 'hour'> = {
  family: 'year',   // ancestry, parents, early environment
  career: 'month',  // career and social standing
  love: 'day',      // self and spouse
  health: 'day',    // the body, read from the day pillar
  finance: 'hour',  // later life, accumulated wealth
};

function clamp(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}

/**
 * Aggregate pillar-interaction pressure on the chart, as a single additive term
 * applied to every category. Averaged (not summed) so charts with more computed
 * interactions are not systematically penalised.
 */
function interactionPressure(interactions: PillarInteraction[]): number {
  if (interactions.length === 0) return 0;
  const total = interactions.reduce(
    (sum, item) => sum + INTERACTION_WEIGHT[item.type] * STRENGTH_MULTIPLIER[item.strength],
    0,
  );
  return total / interactions.length;
}

/**
 * Score one category. Combines three independent signals so two people with the
 * same primary element still differ: the element relation (the dominant term),
 * the supporting pillar's own elements, and chart-wide interaction pressure.
 */
function scoreCategory(
  category: Exclude<FortuneCategoryKey, 'life_overview'>,
  profile: ElementProfile,
  pillars: { year: EnrichedPillar; month: EnrichedPillar; day: EnrichedPillar; hour?: EnrichedPillar },
  pressure: number,
): number {
  const categoryElement = CATEGORY_ELEMENT[category];
  const base = RELATION_SCORE[relate(profile.primaryElement, categoryElement)];

  // The governing pillar's stem and branch each pull the score toward the
  // category when they support its element.
  const pillar = pillars[CATEGORY_PILLAR[category]] ?? pillars.day;
  const pillarBonus =
    (relate(pillar.stemElement, categoryElement) === 'producing' ||
     pillar.stemElement === categoryElement ? 4 : 0) +
    (relate(pillar.branchElement, categoryElement) === 'producing' ||
     pillar.branchElement === categoryElement ? 3 : 0);

  // The profile's own declared compatibility is authoritative where it speaks.
  const profileBonus =
    profile.compatibleElements.includes(categoryElement) ? 5 :
    profile.conflictingElement === categoryElement ? -6 : 0;

  return clamp(base + pillarBonus + profileBonus + pressure);
}

/**
 * Deterministic 0-100 score for each of the six chart categories.
 * life_overview is the mean of the other five — it is a summary, not a
 * sixth independent area, so it should never contradict them.
 */
export function calculateChartCategoryScores(
  profile: ElementProfile,
  pillars: { year: EnrichedPillar; month: EnrichedPillar; day: EnrichedPillar; hour?: EnrichedPillar },
  interactions: PillarInteraction[],
): Record<FortuneCategoryKey, number> {
  const pressure = interactionPressure(interactions);

  const love = scoreCategory('love', profile, pillars, pressure);
  const career = scoreCategory('career', profile, pillars, pressure);
  const finance = scoreCategory('finance', profile, pillars, pressure);
  const health = scoreCategory('health', profile, pillars, pressure);
  const family = scoreCategory('family', profile, pillars, pressure);

  return {
    life_overview: clamp((love + career + finance + health + family) / 5),
    love,
    career,
    finance,
    health,
    family,
  };
}

/**
 * Replace the LLM's per-category score with the deterministic one, keeping its
 * narrative fields. Categories the model omitted are left as-is rather than
 * invented; an unexpected key keeps its own score.
 */
export function applyChartScores<T extends { key: FortuneCategoryKey; score: number }>(
  readings: T[],
  scores: Record<FortuneCategoryKey, number>,
): T[] {
  return readings.map((reading) => ({
    ...reading,
    score: scores[reading.key] ?? reading.score,
  }));
}

/**
 * Upgrade a cached narrative written before scores moved to 0-100.
 *
 * Cached rows are JSON.parse'd without re-validation, so a legacy 1-5 score
 * would otherwise render as a 3% bar instead of ~60%. Month-boundary expiry
 * clears these within at most one month; this keeps the window honest.
 *
 * A legacy score is any value <= 5, which is safe in both directions: the new
 * scale's own floor is well above 5 for any real chart (RELATION_SCORE bottoms
 * out at 46 before modifiers), and a genuine 0-100 score of 5 would be
 * indistinguishable from 1-5 anyway.
 */
export function normalizeLegacyChartScore(score: number): number {
  return score <= 5 ? clamp((score / 5) * 100) : score;
}
