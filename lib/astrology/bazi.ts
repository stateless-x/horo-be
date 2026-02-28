import type { BaziChart, Gender, EnrichedPillar, ElementProfile, PillarInteraction, Element, HeavenlyStem, EarthlyBranch } from '../shared';
import {
  HEAVENLY_STEMS,
  EARTHLY_BRANCHES,
  PILLAR_LIFE_AREAS,
  ELEMENT_ARCHETYPES,
  ELEMENT_PRODUCING,
  ELEMENT_CONTROLLING,
  SOLAR_TERM_BOUNDARIES,
  DAY_REFERENCE,
  CHINESE_HOURS,
  MONTH_BRANCH_START_INDEX,
} from './constants';

// ---- Internal helpers ----

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Count days between two dates (ignoring time)
 */
function daysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / (1000 * 60 * 60 * 24));
}

/**
 * Determine if a date is before the Lunar New Year boundary (~Feb 4)
 * for the purpose of year pillar calculation.
 */
function isBeforeSpringStart(month: number, day: number): boolean {
  // Spring starts approximately Feb 4 (Solar term: 立春)
  if (month < 2) return true;
  if (month === 2 && day < 4) return true;
  return false;
}

/**
 * Get the Chinese solar month index (0-11) for a given Gregorian date.
 * Returns -1 if before month 1 of the current year (meaning it's still month 12 of previous year).
 */
function getSolarMonthIndex(month: number, day: number): number {
  // SOLAR_TERM_BOUNDARIES are in order: month 1 through 12
  // We need to find which solar month the date falls in
  // Month 12 boundary is Jan 5, Month 1 boundary is Feb 4

  // Check if we're in month 12 (Jan 5 - Feb 3)
  if (month === 1 && day >= 5) return 11; // Month 12 (丑)
  if (month === 1 && day < 5) return 10;  // Still month 11 (子) from previous year cycle

  // For months Feb-Dec, check boundaries
  for (let i = SOLAR_TERM_BOUNDARIES.length - 2; i >= 0; i--) {
    const [boundaryMonth, boundaryDay] = SOLAR_TERM_BOUNDARIES[i];
    if (month > boundaryMonth || (month === boundaryMonth && day >= boundaryDay)) {
      return i;
    }
  }

  return 11; // Default to month 12
}

// ---- Year Pillar ----

function calculateYearPillar(year: number, month: number, day: number): { stemIndex: number; branchIndex: number } {
  // Adjust year if before 立春 (Start of Spring ~Feb 4)
  const adjustedYear = isBeforeSpringStart(month, day) ? year - 1 : year;

  const stemIndex = mod(adjustedYear - 4, 10);
  const branchIndex = mod(adjustedYear - 4, 12);

  return { stemIndex, branchIndex };
}

// ---- Month Pillar ----

function calculateMonthPillar(yearStemIndex: number, month: number, day: number): { stemIndex: number; branchIndex: number } {
  const solarMonthIndex = getSolarMonthIndex(month, day);

  // Month branch: starts at 寅 (index 2) for month 1, increments by 1
  const branchIndex = mod(MONTH_BRANCH_START_INDEX + solarMonthIndex, 12);

  // Month stem: derived from year stem using the "five-tiger escape" (五虎遁月) formula
  // Year stem 0 (甲) or 5 (己) → month 1 stem = 2 (丙)
  // Year stem 1 (乙) or 6 (庚) → month 1 stem = 4 (戊)
  // Year stem 2 (丙) or 7 (辛) → month 1 stem = 6 (庚)
  // Year stem 3 (丁) or 8 (壬) → month 1 stem = 8 (壬)
  // Year stem 4 (戊) or 9 (癸) → month 1 stem = 0 (甲)
  const monthStemBase = [2, 4, 6, 8, 0];
  const baseIndex = monthStemBase[yearStemIndex % 5];
  const stemIndex = mod(baseIndex + solarMonthIndex, 10);

  return { stemIndex, branchIndex };
}

// ---- Day Pillar ----

function calculateDayPillar(year: number, month: number, day: number): { stemIndex: number; branchIndex: number } {
  const targetDate = new Date(year, month - 1, day);
  const days = daysBetween(DAY_REFERENCE.date, targetDate);

  const stemIndex = mod(DAY_REFERENCE.stemIndex + days, 10);
  const branchIndex = mod(DAY_REFERENCE.branchIndex + days, 12);

  return { stemIndex, branchIndex };
}

// ---- Hour Pillar ----

function calculateHourPillar(dayStemIndex: number, hour: number): { stemIndex: number; branchIndex: number } {
  // Find the Chinese hour (時辰) from the 24-hour clock
  let branchIndex: number;
  if (hour === 23 || hour === 0) {
    branchIndex = 0; // 子 zi
  } else {
    branchIndex = Math.floor((hour + 1) / 2);
  }

  // Hour stem: derived from day stem using "five-rat escape" (五鼠遁時) formula
  // Day stem 0 (甲) or 5 (己) → hour 子 stem = 0 (甲)
  // Day stem 1 (乙) or 6 (庚) → hour 子 stem = 2 (丙)
  // Day stem 2 (丙) or 7 (辛) → hour 子 stem = 4 (戊)
  // Day stem 3 (丁) or 8 (壬) → hour 子 stem = 6 (庚)
  // Day stem 4 (戊) or 9 (癸) → hour 子 stem = 8 (壬)
  const hourStemBase = [0, 2, 4, 6, 8];
  const baseIndex = hourStemBase[dayStemIndex % 5];
  const stemIndex = mod(baseIndex + branchIndex, 10);

  return { stemIndex, branchIndex };
}

// ---- Public API ----

/**
 * Calculate Bazi Four Pillars chart from birth data.
 * Returns the BaziChart type for backward compatibility with existing endpoints.
 */
export function calculateBazi(
  birthDate: Date,
  birthHour?: number, // 0-23, undefined if unknown
  gender?: Gender
): BaziChart {
  // Use UTC methods since birthDate is stored as UTC midnight
  const year = birthDate.getUTCFullYear();
  const month = birthDate.getUTCMonth() + 1;
  const day = birthDate.getUTCDate();

  const yearPillar = calculateYearPillar(year, month, day);
  const monthPillar = calculateMonthPillar(yearPillar.stemIndex, month, day);
  const dayPillar = calculateDayPillar(year, month, day);

  const yearStem = HEAVENLY_STEMS[yearPillar.stemIndex];
  const yearBranch = EARTHLY_BRANCHES[yearPillar.branchIndex];
  const monthStem = HEAVENLY_STEMS[monthPillar.stemIndex];
  const monthBranch = EARTHLY_BRANCHES[monthPillar.branchIndex];
  const dayStem = HEAVENLY_STEMS[dayPillar.stemIndex];
  const dayBranch = EARTHLY_BRANCHES[dayPillar.branchIndex];

  const result: BaziChart = {
    yearPillar: { stem: yearStem.enumKey, branch: yearBranch.enumKey },
    monthPillar: { stem: monthStem.enumKey, branch: monthBranch.enumKey },
    dayPillar: { stem: dayStem.enumKey, branch: dayBranch.enumKey },
    dayMaster: dayStem.enumKey,
    element: dayStem.element,
  };

  if (birthHour !== undefined) {
    const hourPillar = calculateHourPillar(dayPillar.stemIndex, birthHour);
    const hourStem = HEAVENLY_STEMS[hourPillar.stemIndex];
    const hourBranch = EARTHLY_BRANCHES[hourPillar.branchIndex];
    result.hourPillar = { stem: hourStem.enumKey, branch: hourBranch.enumKey };
  }

  return result;
}

/**
 * Calculate enriched BaZi data with full metadata per pillar.
 * Used by the structured chart endpoint.
 */
export function calculateEnrichedBazi(
  birthDate: Date,
  birthHour?: number,
  gender?: Gender
): { year: EnrichedPillar; month: EnrichedPillar; day: EnrichedPillar; hour?: EnrichedPillar } {
  // Use UTC methods since birthDate is stored as UTC midnight
  const year = birthDate.getUTCFullYear();
  const month = birthDate.getUTCMonth() + 1;
  const day = birthDate.getUTCDate();

  const yearPillar = calculateYearPillar(year, month, day);
  const monthPillar = calculateMonthPillar(yearPillar.stemIndex, month, day);
  const dayPillar = calculateDayPillar(year, month, day);

  function buildEnrichedPillar(
    stemIdx: number,
    branchIdx: number,
    pillarKey: 'year' | 'month' | 'day' | 'hour',
  ): EnrichedPillar {
    const stem = HEAVENLY_STEMS[stemIdx];
    const branch = EARTHLY_BRANCHES[branchIdx];
    const area = PILLAR_LIFE_AREAS[pillarKey];

    return {
      stem: stem.enumKey,
      branch: branch.enumKey,
      stemChinese: stem.chinese,
      stemPinyin: stem.pinyin,
      stemElement: stem.element,
      stemYinYang: stem.yinYang,
      branchChinese: branch.chinese,
      branchPinyin: branch.pinyin,
      branchAnimal: branch.animal,
      branchElement: branch.element,
      lifeArea: area.thai,
      lifeAreaDetail: area.detail,
    };
  }

  const result: { year: EnrichedPillar; month: EnrichedPillar; day: EnrichedPillar; hour?: EnrichedPillar } = {
    year: buildEnrichedPillar(yearPillar.stemIndex, yearPillar.branchIndex, 'year'),
    month: buildEnrichedPillar(monthPillar.stemIndex, monthPillar.branchIndex, 'month'),
    day: buildEnrichedPillar(dayPillar.stemIndex, dayPillar.branchIndex, 'day'),
  };

  if (birthHour !== undefined) {
    const hourPillar = calculateHourPillar(dayPillar.stemIndex, birthHour);
    result.hour = buildEnrichedPillar(hourPillar.stemIndex, hourPillar.branchIndex, 'hour');
  }

  return result;
}

/**
 * Calculate element profile from the Day Master's element.
 * Returns deterministic personality data from ELEMENT_ARCHETYPES.
 */
export function calculateElementProfile(dayPillar: EnrichedPillar): ElementProfile {
  const element = dayPillar.stemElement;
  const archetype = ELEMENT_ARCHETYPES[element];

  return {
    primaryElement: element,
    corePersonality: archetype.corePersonality,
    strengths: [...archetype.strengths],
    weaknesses: [...archetype.weaknesses],
    compatibleElements: [...archetype.compatibleElements],
    conflictingElement: archetype.conflictingElement,
  };
}

/**
 * Calculate interactions between all pillar pairs.
 * Compares stem elements between pillars using the five-element cycle.
 */
export function calculatePillarInteractions(
  pillars: { year: EnrichedPillar; month: EnrichedPillar; day: EnrichedPillar; hour?: EnrichedPillar }
): PillarInteraction[] {
  const interactions: PillarInteraction[] = [];
  const pillarEntries: [string, EnrichedPillar][] = [
    ['year', pillars.year],
    ['month', pillars.month],
    ['day', pillars.day],
  ];
  if (pillars.hour) {
    pillarEntries.push(['hour', pillars.hour]);
  }

  for (let i = 0; i < pillarEntries.length; i++) {
    for (let j = i + 1; j < pillarEntries.length; j++) {
      const [keyA, pillarA] = pillarEntries[i];
      const [keyB, pillarB] = pillarEntries[j];

      const elemA = pillarA.stemElement;
      const elemB = pillarB.stemElement;

      const interaction = getElementInteractionType(elemA, elemB);

      if (interaction.type !== 'neutral') {
        interactions.push({
          from: `${keyA}_${elemA}`,
          to: `${keyB}_${elemB}`,
          type: interaction.type,
          strength: interaction.strength,
          description: interaction.description,
        });
      }
    }
  }

  return interactions;
}

/**
 * Determine the interaction type between two elements.
 */
function getElementInteractionType(
  elemA: Element,
  elemB: Element
): { type: PillarInteraction['type']; strength: PillarInteraction['strength']; description: string } {
  if (elemA === elemB) {
    return { type: 'same', strength: 'mild', description: `${elemA} reinforces ${elemB}` };
  }
  if (ELEMENT_PRODUCING[elemA] === elemB) {
    return { type: 'producing', strength: 'strong', description: `${elemA} produces ${elemB}` };
  }
  if (ELEMENT_PRODUCING[elemB] === elemA) {
    return { type: 'weakening', strength: 'mild', description: `${elemB} drains ${elemA}` };
  }
  if (ELEMENT_CONTROLLING[elemA] === elemB) {
    return { type: 'controlling', strength: 'strong', description: `${elemA} controls ${elemB}` };
  }
  if (ELEMENT_CONTROLLING[elemB] === elemA) {
    return { type: 'overacting', strength: 'mild', description: `${elemB} controls ${elemA}` };
  }
  return { type: 'neutral', strength: 'weak', description: 'No direct cycle relationship' };
}

