import type { BaziChart, Element, HeavenlyStem } from '../shared';
import { calculateBazi } from './bazi';
import { getBranchRelation, getElementInteraction, type BranchRelation } from './compatibility';
import { ELEMENT_CONTROLLING, ELEMENT_PRODUCING, HEAVENLY_STEMS } from './constants';
import { PAIR_ARCHETYPES, type ElementClass, type PairArchetype } from './compatibility-archetypes';

/**
 * Deterministic parts of the compatibility report (content v4): dimension
 * scores, the pair archetype and the 3-month relationship calendar. No LLM
 * input; the model only explains these. Formulas and weights are documented
 * in docs/compatibility-scoring.md ("Report v4").
 */

// ---------------------------------------------------------------- inputs

/** The day-master pairs that form a heavenly-stem combination (天干五合), a classic attraction marker. */
const STEM_COMBINATIONS: [HeavenlyStem, HeavenlyStem][] = [
  ['jia', 'ji'], ['yi', 'geng'], ['bing', 'xin'], ['ding', 'ren'], ['wu', 'gui'],
];

export interface PairInputs {
  elementClass: ElementClass;
  dayRelation: BranchRelation;
  yearRelation: BranchRelation;
  stemCombine: boolean;
  /** Both codes, or null when either person has no MBTI: one side alone says nothing about the pair. */
  mbti: { reader: string; partner: string } | null;
}

export function elementClassOf(a: Element, b: Element): ElementClass {
  const type = getElementInteraction(a, b).type;
  if (type === 'same') return 'same';
  if (type === 'producing' || type === 'weakening') return 'generating';
  if (type === 'controlling' || type === 'overacting') return 'controlling';
  // Five elements: every pair is same, producing or controlling in one direction.
  throw new Error(`No cycle relation between ${a} and ${b}`);
}

export function pairInputs(
  reader: BaziChart,
  partner: BaziChart,
  readerMbti: string | null,
  partnerMbti: string | null,
): PairInputs {
  return {
    elementClass: elementClassOf(reader.element, partner.element),
    dayRelation: getBranchRelation(reader.dayPillar.branch, partner.dayPillar.branch),
    yearRelation: getBranchRelation(reader.yearPillar.branch, partner.yearPillar.branch),
    stemCombine: STEM_COMBINATIONS.some(
      ([x, y]) => (x === reader.dayMaster && y === partner.dayMaster) || (y === reader.dayMaster && x === partner.dayMaster),
    ),
    mbti: readerMbti && partnerMbti ? { reader: readerMbti, partner: partnerMbti } : null,
  };
}

// ---------------------------------------------------------------- dimensions

export const DIMENSION_KEYS = ['chemistry', 'communication', 'trust', 'rhythm'] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];
export type DimensionInput = 'dayBranch' | 'yearBranch' | 'element' | 'stemCombine' | 'mbti';

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  chemistry: 'เคมี',
  communication: 'การสื่อสาร',
  trust: 'ความไว้ใจ',
  rhythm: 'จังหวะชีวิต',
};

export interface Dimension {
  key: DimensionKey;
  label: string;
  score: number;
  /** The inputs this score was computed from; MBTI appears only when both people have it. */
  basis: DimensionInput[];
}

type ByRelation = Record<BranchRelation, number>;
type ByElement = Record<ElementClass, number>;

// Spouse palace (day branch). A clash reads as strong pull with friction, so it
// keeps chemistry mid-range while trust and communication take the hit.
const DAY_PULL: ByRelation = { combine: 92, trine: 80, same: 64, neutral: 52, harm: 30, clash: 58 };
const ELEMENT_PULL: ByElement = { generating: 84, controlling: 62, same: 48 };
const STEM_COMBINE_BONUS = 12;

const MBTI_TALK = { both: 90, perception: 72, judgement: 58, neither: 38 };
const ELEMENT_TALK: ByElement = { generating: 82, same: 70, controlling: 44 };
const DAY_TALK: ByRelation = { combine: 84, trine: 80, same: 70, neutral: 64, clash: 46, harm: 34 };

const DAY_TRUST: ByRelation = { combine: 94, trine: 84, same: 72, neutral: 62, clash: 38, harm: 30 };
const YEAR_TRUST: ByRelation = { combine: 88, trine: 80, same: 72, neutral: 62, clash: 42, harm: 40 };
const ELEMENT_TRUST: ByElement = { generating: 80, same: 70, controlling: 50 };

// Year branch: the zodiac-year fit Thai readers know as ปีชง when it clashes.
const YEAR_PACE: ByRelation = { combine: 90, trine: 84, same: 76, neutral: 60, harm: 44, clash: 30 };
const MBTI_PACE = { both: 90, planning: 72, energy: 60, neither: 40 };
const ELEMENT_PACE: ByElement = { same: 82, generating: 72, controlling: 48 };

/** Never 0 or 100: a heuristic should not claim certainty. */
const bound = (value: number) => Math.min(97, Math.max(5, Math.round(value)));

const letter = (code: string, index: number) => code[index];

function mbtiTalk(mbti: NonNullable<PairInputs['mbti']>): number {
  const perception = letter(mbti.reader, 1) === letter(mbti.partner, 1); // S/N: shared language
  const judgement = letter(mbti.reader, 2) === letter(mbti.partner, 2); // T/F: shared way of deciding
  if (perception && judgement) return MBTI_TALK.both;
  if (perception) return MBTI_TALK.perception;
  if (judgement) return MBTI_TALK.judgement;
  return MBTI_TALK.neither;
}

function mbtiPace(mbti: NonNullable<PairInputs['mbti']>): number {
  const energy = letter(mbti.reader, 0) === letter(mbti.partner, 0); // E/I: social energy
  const planning = letter(mbti.reader, 3) === letter(mbti.partner, 3); // J/P: planning style
  if (energy && planning) return MBTI_PACE.both;
  if (planning) return MBTI_PACE.planning;
  if (energy) return MBTI_PACE.energy;
  return MBTI_PACE.neither;
}

/**
 * Four dimensions, each from named inputs. There is no fifth "future" bar:
 * nothing the engine computes speaks to a relationship's future beyond what
 * these four already use, so it would be a re-weighted average dressed as a
 * prediction. The 3-month calendar covers time instead.
 */
export function calculateDimensions(inputs: PairInputs): Dimension[] {
  const { elementClass: el, dayRelation: day, yearRelation: year, stemCombine, mbti } = inputs;

  const chemistry = 0.55 * DAY_PULL[day] + 0.45 * ELEMENT_PULL[el] + (stemCombine ? STEM_COMBINE_BONUS : 0);
  const communication = mbti
    ? 0.45 * mbtiTalk(mbti) + 0.35 * ELEMENT_TALK[el] + 0.2 * DAY_TALK[day]
    : 0.6 * ELEMENT_TALK[el] + 0.4 * DAY_TALK[day];
  const trust = 0.5 * DAY_TRUST[day] + 0.3 * YEAR_TRUST[year] + 0.2 * ELEMENT_TRUST[el];
  const rhythm = mbti
    ? 0.5 * YEAR_PACE[year] + 0.5 * mbtiPace(mbti)
    : 0.7 * YEAR_PACE[year] + 0.3 * ELEMENT_PACE[el];

  const dims: Array<[DimensionKey, number, DimensionInput[]]> = [
    ['chemistry', chemistry, stemCombine ? ['dayBranch', 'element', 'stemCombine'] : ['dayBranch', 'element']],
    ['communication', communication, mbti ? ['mbti', 'element', 'dayBranch'] : ['element', 'dayBranch']],
    ['trust', trust, ['dayBranch', 'yearBranch', 'element']],
    ['rhythm', rhythm, mbti ? ['yearBranch', 'mbti'] : ['yearBranch', 'element']],
  ];
  return dims.map(([key, score, basis]) => ({ key, label: DIMENSION_LABELS[key], score: bound(score), basis }));
}

// ---------------------------------------------------------------- archetype

export function selectArchetype(inputs: PairInputs): PairArchetype {
  const entry = PAIR_ARCHETYPES[inputs.elementClass][inputs.dayRelation];
  return { key: `${inputs.elementClass}-${inputs.dayRelation}`, ...entry };
}

// ---------------------------------------------------------------- calendar

export type MonthLabel = 'good' | 'mixed' | 'caution';
export type MonthElementRelation = 'resource' | 'companion' | 'output' | 'wealth' | 'pressure';

export interface MonthReason {
  who: 'reader' | 'partner';
  kind: 'element' | 'branch';
  relation: MonthElementRelation | BranchRelation;
}

export interface CalendarMonth {
  /** YYYY-MM, Gregorian, Bangkok calendar. */
  month: string;
  monthElement: Element;
  label: MonthLabel;
  /** Only the relations that moved the label; neutral ones are left out. */
  reasons: MonthReason[];
}

const ELEMENT_POINTS: Record<MonthElementRelation, number> = {
  resource: 2, // the month's element produces the day master
  companion: 1, // same element
  output: 1, // the day master produces the month's element: expression comes easily
  wealth: 0, // the day master controls it: gains take effort
  pressure: -2, // the month's element controls the day master
};
const BRANCH_POINTS: Record<BranchRelation, number> = { combine: 2, trine: 1, same: 0, neutral: 0, harm: -1, clash: -2 };

function monthElementRelation(monthEl: Element, dayMasterEl: Element): MonthElementRelation {
  if (monthEl === dayMasterEl) return 'companion';
  if (ELEMENT_PRODUCING[monthEl] === dayMasterEl) return 'resource';
  if (ELEMENT_PRODUCING[dayMasterEl] === monthEl) return 'output';
  if (ELEMENT_CONTROLLING[dayMasterEl] === monthEl) return 'wealth';
  return 'pressure';
}

function stemElement(stem: HeavenlyStem): Element {
  const entry = HEAVENLY_STEMS.find((s) => s.enumKey === stem);
  if (!entry) throw new Error(`Unknown heavenly stem: ${stem}`);
  return entry.element;
}

/** The Bangkok calendar month (YYYY-MM) of an instant. */
function bangkokYearMonth(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' })
    .formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

/**
 * The three Gregorian months after the current Bangkok month. Each month is
 * read from the Bazi month pillar in force on its 15th (Bazi months start
 * around the 4th to 8th of each Gregorian month, so the 15th is well inside):
 * the pillar's stem element against each day master, and its branch against
 * each day branch (the spouse palace).
 *
 * Label: points summed over both people (-8 to 8); 3 or more is 'good', -1 or
 * less is 'caution', otherwise 'mixed'. A month whose branch clashes either
 * person's day branch is never 'good'.
 */
export function relationshipCalendar(reader: BaziChart, partner: BaziChart, now: Date): CalendarMonth[] {
  const { year, month } = bangkokYearMonth(now);
  return [1, 2, 3].map((offset) => {
    const target = new Date(Date.UTC(year, month - 1 + offset, 15));
    const pillar = calculateBazi(target).monthPillar;
    const monthEl = stemElement(pillar.stem);
    const reasons: MonthReason[] = [];
    let points = 0;
    let clash = false;
    for (const [who, chart] of [['reader', reader], ['partner', partner]] as const) {
      const elRel = monthElementRelation(monthEl, chart.element);
      const brRel = getBranchRelation(pillar.branch, chart.dayPillar.branch);
      points += ELEMENT_POINTS[elRel] + BRANCH_POINTS[brRel];
      if (ELEMENT_POINTS[elRel] !== 0) reasons.push({ who, kind: 'element', relation: elRel });
      if (BRANCH_POINTS[brRel] !== 0) reasons.push({ who, kind: 'branch', relation: brRel });
      if (brRel === 'clash') clash = true;
    }
    const label: MonthLabel = points >= 3 && !clash ? 'good' : points <= -1 ? 'caution' : 'mixed';
    return {
      month: `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}`,
      monthElement: monthEl,
      label,
      reasons,
    };
  });
}

/** The month the future chapter recommends for the next step: the first good one, else the first mixed one, else the first. */
export function bestMonth(calendar: CalendarMonth[]): CalendarMonth {
  return calendar.find((m) => m.label === 'good') ?? calendar.find((m) => m.label === 'mixed') ?? calendar[0];
}
