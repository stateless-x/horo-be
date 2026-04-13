/**
 * Daily Fortune Utilities
 *
 * Centralized functions for calculating daily-specific astrology data:
 * - Today's Bazi day pillar
 * - Element harmony between user and today
 * - Daily theme derivation
 * - Earth branch clash detection
 */

import type { Element, BaziChart, EarthlyBranch } from '../shared';
import {
  HEAVENLY_STEMS,
  EARTHLY_BRANCHES,
  ELEMENT_PRODUCING,
  ELEMENT_CONTROLLING,
  DAY_REFERENCE,
} from './constants';

// ---- Types ----

export type ElementRelationship =
  | 'producing'      // User's element produces today's element (生) - favorable, good for giving
  | 'produced_by'    // Today's element produces user's element (被生) - very favorable, receiving support
  | 'controlling'    // User's element controls today's element (克) - user dominates, assertive day
  | 'controlled_by'  // Today's element controls user's element (被克) - challenging, need care
  | 'same'           // Same element - reinforcing, stable
  | 'neutral';       // No direct relationship

export interface DailyPillar {
  stemIndex: number;
  branchIndex: number;
  stem: string;           // e.g., "jia"
  stemChinese: string;    // e.g., "甲"
  branch: string;         // e.g., "zi"
  branchChinese: string;  // e.g., "子"
  element: Element;
  animal: string;
  yinYang: 'yin' | 'yang';
}

export interface ElementHarmony {
  relationship: ElementRelationship;
  userElement: Element;
  todayElement: Element;
  favorability: 'very_favorable' | 'favorable' | 'neutral' | 'challenging';
  description: string;        // Thai description
  scoreModifier: number;      // Suggested base score modifier (-2 to +2)
}

export interface DailyTheme {
  theme: string;              // Thai theme name, e.g., "วันแห่งการสื่อสาร"
  animal: string;             // Today's branch animal
  element: Element;           // Today's element
}

export interface BranchClash {
  hasClash: boolean;
  clashType?: 'year' | 'day';
  userBranch?: string;
  todayBranch?: string;
  warning?: string;           // Thai warning message
}

// ---- Internal helpers ----

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function daysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const utcB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((utcB - utcA) / (1000 * 60 * 60 * 24));
}

// Earth Branch clash pairs (六冲)
// zi-wu, chou-wei, yin-shen, mao-you, chen-xu, si-hai
const BRANCH_CLASH_PAIRS: [number, number][] = [
  [0, 6],   // 子午 zi-wu
  [1, 7],   // 丑未 chou-wei
  [2, 8],   // 寅申 yin-shen
  [3, 9],   // 卯酉 mao-you
  [4, 10],  // 辰戌 chen-xu
  [5, 11],  // 巳亥 si-hai
];

// Theme mapping based on branch (animal) and element
const DAILY_THEMES: Record<string, string> = {
  // Branch-based themes
  'zi': 'วันแห่งปัญญาและการเรียนรู้',      // Rat - wisdom
  'chou': 'วันแห่งความอดทนและการลงมือทำ',  // Ox - diligence
  'yin': 'วันแห่งความกล้าหาญและการเริ่มต้น', // Tiger - courage
  'mao': 'วันแห่งความสุขุมและการวางแผน',   // Rabbit - diplomacy
  'chen': 'วันแห่งพลังและความสำเร็จ',      // Dragon - power
  'si': 'วันแห่งสติปัญญาและการวิเคราะห์',  // Snake - wisdom
  'wu': 'วันแห่งพลังงานและการเดินทาง',     // Horse - energy
  'wei': 'วันแห่งความคิดสร้างสรรค์',       // Goat - creativity
  'shen': 'วันแห่งความคล่องแคล่วและโอกาส', // Monkey - cleverness
  'you': 'วันแห่งความละเอียดและความงาม',   // Rooster - precision
  'xu': 'วันแห่งความซื่อสัตย์และมิตรภาพ',  // Dog - loyalty
  'hai': 'วันแห่งความเมตตาและการแบ่งปัน',  // Pig - generosity
};

// Element Thai names
const ELEMENT_NAMES_THAI: Record<Element, string> = {
  wood: 'ไม้',
  fire: 'ไฟ',
  earth: 'ดิน',
  metal: 'ทอง',
  water: 'น้ำ',
};

// ---- Public API ----

/**
 * Calculate today's Bazi day pillar.
 * Returns full pillar data including stem, branch, element, and animal.
 */
export function calculateTodayPillar(today: Date): DailyPillar {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();

  const targetDate = new Date(Date.UTC(year, month - 1, day));
  const days = daysBetween(DAY_REFERENCE.date, targetDate);

  const stemIndex = mod(DAY_REFERENCE.stemIndex + days, 10);
  const branchIndex = mod(DAY_REFERENCE.branchIndex + days, 12);

  const stem = HEAVENLY_STEMS[stemIndex];
  const branch = EARTHLY_BRANCHES[branchIndex];

  return {
    stemIndex,
    branchIndex,
    stem: stem.enumKey,
    stemChinese: stem.chinese,
    branch: branch.enumKey,
    branchChinese: branch.chinese,
    element: stem.element,
    animal: branch.animal,
    yinYang: stem.yinYang,
  };
}

/**
 * Calculate element harmony between user's day master and today's day element.
 * This is the core calculation for determining if a day is favorable.
 */
export function calculateElementHarmony(
  userElement: Element,
  todayElement: Element
): ElementHarmony {
  // Same element - reinforcing
  if (userElement === todayElement) {
    return {
      relationship: 'same',
      userElement,
      todayElement,
      favorability: 'favorable',
      description: `ธาตุ${ELEMENT_NAMES_THAI[userElement]}ของเจ้าเสริมกำลังในวันนี้`,
      scoreModifier: 1,
    };
  }

  // User produces today (生) - giving energy
  if (ELEMENT_PRODUCING[userElement] === todayElement) {
    return {
      relationship: 'producing',
      userElement,
      todayElement,
      favorability: 'favorable',
      description: `ธาตุ${ELEMENT_NAMES_THAI[userElement]}ของเจ้าส่งพลังให้ธาตุ${ELEMENT_NAMES_THAI[todayElement]}ของวันนี้ — วันที่ดีสำหรับการให้และสร้างสรรค์`,
      scoreModifier: 1,
    };
  }

  // Today produces user (被生) - receiving support
  if (ELEMENT_PRODUCING[todayElement] === userElement) {
    return {
      relationship: 'produced_by',
      userElement,
      todayElement,
      favorability: 'very_favorable',
      description: `ธาตุ${ELEMENT_NAMES_THAI[todayElement]}ของวันนี้เสริมพลังให้ธาตุ${ELEMENT_NAMES_THAI[userElement]}ของเจ้า — วันมงคลที่ได้รับการสนับสนุน`,
      scoreModifier: 2,
    };
  }

  // User controls today (克) - dominating
  if (ELEMENT_CONTROLLING[userElement] === todayElement) {
    return {
      relationship: 'controlling',
      userElement,
      todayElement,
      favorability: 'favorable',
      description: `ธาตุ${ELEMENT_NAMES_THAI[userElement]}ของเจ้าครอบงำธาตุ${ELEMENT_NAMES_THAI[todayElement]}ของวันนี้ — วันที่ดีสำหรับการตัดสินใจและการแข่งขัน`,
      scoreModifier: 1,
    };
  }

  // Today controls user (被克) - challenging
  if (ELEMENT_CONTROLLING[todayElement] === userElement) {
    return {
      relationship: 'controlled_by',
      userElement,
      todayElement,
      favorability: 'challenging',
      description: `ธาตุ${ELEMENT_NAMES_THAI[todayElement]}ของวันนี้กดทับธาตุ${ELEMENT_NAMES_THAI[userElement]}ของเจ้า — วันที่ต้องระวังและอดทน`,
      scoreModifier: -2,
    };
  }

  // Neutral (no direct relationship in the cycle)
  return {
    relationship: 'neutral',
    userElement,
    todayElement,
    favorability: 'neutral',
    description: `ธาตุ${ELEMENT_NAMES_THAI[userElement]}ของเจ้าและธาตุ${ELEMENT_NAMES_THAI[todayElement]}ของวันนี้อยู่ในสมดุล — วันปกติ`,
    scoreModifier: 0,
  };
}

/**
 * Get daily theme based on today's branch (animal) and element.
 */
export function getDailyTheme(todayPillar: DailyPillar): DailyTheme {
  return {
    theme: DAILY_THEMES[todayPillar.branch] || 'วันแห่งโอกาสใหม่',
    animal: todayPillar.animal,
    element: todayPillar.element,
  };
}

/**
 * Check for Earth Branch clashes between user's chart and today.
 * Clashes (六冲) indicate potential conflict or turbulence.
 */
export function checkBranchClash(
  userChart: BaziChart,
  todayPillar: DailyPillar
): BranchClash {
  const todayBranchIndex = todayPillar.branchIndex;

  // Get user's year and day branch indices
  const userYearBranchIndex = EARTHLY_BRANCHES.findIndex(
    b => b.enumKey === userChart.yearPillar.branch
  );
  const userDayBranchIndex = EARTHLY_BRANCHES.findIndex(
    b => b.enumKey === userChart.dayPillar.branch
  );

  // Check for clashes
  for (const [a, b] of BRANCH_CLASH_PAIRS) {
    // Year branch clash
    if ((userYearBranchIndex === a && todayBranchIndex === b) ||
        (userYearBranchIndex === b && todayBranchIndex === a)) {
      return {
        hasClash: true,
        clashType: 'year',
        userBranch: EARTHLY_BRANCHES[userYearBranchIndex].animal,
        todayBranch: todayPillar.animal,
        warning: `วันนี้มีการปะทะกับปีนักษัตรของเจ้า (${EARTHLY_BRANCHES[userYearBranchIndex].animal}) — ระวังเรื่องครอบครัวและสังคม`,
      };
    }

    // Day branch clash (more personal impact)
    if ((userDayBranchIndex === a && todayBranchIndex === b) ||
        (userDayBranchIndex === b && todayBranchIndex === a)) {
      return {
        hasClash: true,
        clashType: 'day',
        userBranch: EARTHLY_BRANCHES[userDayBranchIndex].animal,
        todayBranch: todayPillar.animal,
        warning: `วันนี้มีการปะทะกับดวงส่วนตัวของเจ้า (${EARTHLY_BRANCHES[userDayBranchIndex].animal}) — ระวังเรื่องความสัมพันธ์และอารมณ์`,
      };
    }
  }

  return { hasClash: false };
}

/**
 * Get comprehensive daily fortune context for LLM prompt.
 * Combines all daily calculations into a single object.
 */
export function getDailyFortuneContext(
  today: Date,
  userChart: BaziChart
): {
  todayPillar: DailyPillar;
  elementHarmony: ElementHarmony;
  dailyTheme: DailyTheme;
  branchClash: BranchClash;
} {
  const todayPillar = calculateTodayPillar(today);
  const elementHarmony = calculateElementHarmony(userChart.element, todayPillar.element);
  const dailyTheme = getDailyTheme(todayPillar);
  const branchClash = checkBranchClash(userChart, todayPillar);

  return {
    todayPillar,
    elementHarmony,
    dailyTheme,
    branchClash,
  };
}
