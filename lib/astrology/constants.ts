import type { Element, HeavenlyStem, EarthlyBranch } from '../shared';

/**
 * Heavenly Stems (天干) — 10 stems in the sexagenary cycle
 * Each stem has a fixed element and yin/yang polarity.
 */
export const HEAVENLY_STEMS = [
  { enumKey: 'jia' as HeavenlyStem,  pinyin: 'jiǎ',  chinese: '甲', element: 'wood' as Element,  yinYang: 'yang' as const },
  { enumKey: 'yi' as HeavenlyStem,   pinyin: 'yǐ',   chinese: '乙', element: 'wood' as Element,  yinYang: 'yin' as const },
  { enumKey: 'bing' as HeavenlyStem, pinyin: 'bǐng', chinese: '丙', element: 'fire' as Element,  yinYang: 'yang' as const },
  { enumKey: 'ding' as HeavenlyStem, pinyin: 'dīng', chinese: '丁', element: 'fire' as Element,  yinYang: 'yin' as const },
  { enumKey: 'wu' as HeavenlyStem,   pinyin: 'wù',   chinese: '戊', element: 'earth' as Element, yinYang: 'yang' as const },
  { enumKey: 'ji' as HeavenlyStem,   pinyin: 'jǐ',   chinese: '己', element: 'earth' as Element, yinYang: 'yin' as const },
  { enumKey: 'geng' as HeavenlyStem, pinyin: 'gēng', chinese: '庚', element: 'metal' as Element, yinYang: 'yang' as const },
  { enumKey: 'xin' as HeavenlyStem,  pinyin: 'xīn',  chinese: '辛', element: 'metal' as Element, yinYang: 'yin' as const },
  { enumKey: 'ren' as HeavenlyStem,  pinyin: 'rén',  chinese: '壬', element: 'water' as Element, yinYang: 'yang' as const },
  { enumKey: 'gui' as HeavenlyStem,  pinyin: 'guǐ',  chinese: '癸', element: 'water' as Element, yinYang: 'yin' as const },
] as const;

/**
 * Earthly Branches (地支) — 12 branches in the sexagenary cycle
 * Each branch has a fixed animal, element, and Thai animal name.
 */
export const EARTHLY_BRANCHES = [
  { enumKey: 'zi' as EarthlyBranch,   pinyin: 'zǐ',   chinese: '子', animal: 'หนู (Rat)',        element: 'water' as Element },
  { enumKey: 'chou' as EarthlyBranch, pinyin: 'chǒu', chinese: '丑', animal: 'วัว (Ox)',         element: 'earth' as Element },
  { enumKey: 'yin' as EarthlyBranch,  pinyin: 'yín',  chinese: '寅', animal: 'เสือ (Tiger)',      element: 'wood' as Element },
  { enumKey: 'mao' as EarthlyBranch,  pinyin: 'mǎo',  chinese: '卯', animal: 'กระต่าย (Rabbit)',  element: 'wood' as Element },
  { enumKey: 'chen' as EarthlyBranch, pinyin: 'chén', chinese: '辰', animal: 'มังกร (Dragon)',    element: 'earth' as Element },
  { enumKey: 'si' as EarthlyBranch,   pinyin: 'sì',   chinese: '巳', animal: 'งู (Snake)',        element: 'fire' as Element },
  { enumKey: 'wu' as EarthlyBranch,   pinyin: 'wǔ',   chinese: '午', animal: 'ม้า (Horse)',       element: 'fire' as Element },
  { enumKey: 'wei' as EarthlyBranch,  pinyin: 'wèi',  chinese: '未', animal: 'แพะ (Goat)',        element: 'earth' as Element },
  { enumKey: 'shen' as EarthlyBranch, pinyin: 'shēn', chinese: '申', animal: 'ลิง (Monkey)',      element: 'metal' as Element },
  { enumKey: 'you' as EarthlyBranch,  pinyin: 'yǒu',  chinese: '酉', animal: 'ไก่ (Rooster)',     element: 'metal' as Element },
  { enumKey: 'xu' as EarthlyBranch,   pinyin: 'xū',   chinese: '戌', animal: 'สุนัข (Dog)',       element: 'earth' as Element },
  { enumKey: 'hai' as EarthlyBranch,  pinyin: 'hài',  chinese: '亥', animal: 'หมู (Pig)',         element: 'water' as Element },
] as const;

/**
 * Five Element Producing Cycle (生)
 * Wood → Fire → Earth → Metal → Water → Wood
 */
export const ELEMENT_PRODUCING: Record<Element, Element> = {
  wood: 'fire',
  fire: 'earth',
  earth: 'metal',
  metal: 'water',
  water: 'wood',
};

/**
 * Five Element Controlling Cycle (克)
 * Wood → Earth → Water → Fire → Metal → Wood
 */
export const ELEMENT_CONTROLLING: Record<Element, Element> = {
  wood: 'earth',
  earth: 'water',
  water: 'fire',
  fire: 'metal',
  metal: 'wood',
};

/**
 * Life areas governed by each pillar
 */
export const PILLAR_LIFE_AREAS = {
  year:  { thai: 'บรรพบุรุษ & สังคม',   detail: 'Ancestors, social image, early childhood (0-15)' },
  month: { thai: 'พ่อแม่ & การทำงาน',   detail: 'Parents, career path, young adulthood (15-30)' },
  day:   { thai: 'ตัวคุณ & คู่ครอง',     detail: 'Self identity, spouse, middle age (30-45)' },
  hour:  { thai: 'ลูกหลาน & อนาคต',    detail: 'Children, late career, later life (45+)' },
} as const;

/**
 * Element archetypes — deterministic personality data per element (Thai)
 */
export const ELEMENT_ARCHETYPES: Record<Element, {
  corePersonality: string;
  strengths: string[];
  weaknesses: string[];
  compatibleElements: Element[];
  conflictingElement: Element;
}> = {
  wood: {
    corePersonality: 'มีความเมตตากรุณา ชอบเติบโตและพัฒนาตัวเอง มีวิสัยทัศน์กว้างไกล',
    strengths: ['มีความเมตตา', 'สร้างสรรค์', 'ยืดหยุ่น', 'มีวิสัยทัศน์'],
    weaknesses: ['โอนเอนตามคนอื่น', 'ตัดสินใจช้า', 'ใจอ่อน'],
    compatibleElements: ['water', 'fire'],
    conflictingElement: 'metal',
  },
  fire: {
    corePersonality: 'มีพลังงานสูง กล้าหาญ มีเสน่ห์ดึงดูดใจ เป็นผู้นำโดยธรรมชาติ',
    strengths: ['กล้าหาญ', 'มีเสน่ห์', 'มีพลังงานสูง', 'เป็นผู้นำ'],
    weaknesses: ['ใจร้อน', 'หุนหันพลันแล่น', 'เบื่อง่าย'],
    compatibleElements: ['wood', 'earth'],
    conflictingElement: 'water',
  },
  earth: {
    corePersonality: 'มั่นคง เชื่อถือได้ เป็นที่พึ่งพาของคนรอบข้าง มีความอดทนสูง',
    strengths: ['อดทน', 'ซื่อสัตย์', 'มีระเบียบ', 'เชื่อถือได้'],
    weaknesses: ['ดื้อรั้น', 'เครียดง่าย', 'ยึดติดกับอดีต'],
    compatibleElements: ['fire', 'metal'],
    conflictingElement: 'wood',
  },
  metal: {
    corePersonality: 'มีความเด็ดขาด มีวินัยสูง มุ่งมั่นในเป้าหมาย ซื่อตรงและยุติธรรม',
    strengths: ['เด็ดขาด', 'มีวินัย', 'ซื่อตรง', 'มุ่งมั่น'],
    weaknesses: ['เจ้าระเบียบเกินไป', 'ขาดความยืดหยุ่น', 'เข้มงวดกับตนเองและผู้อื่น'],
    compatibleElements: ['earth', 'water'],
    conflictingElement: 'fire',
  },
  water: {
    corePersonality: 'ฉลาดหลักแหลม มีปัญญาลึกซึ้ง ปรับตัวเก่ง มีสัญชาตญาณที่ดี',
    strengths: ['ฉลาด', 'ปรับตัวเก่ง', 'มีสัญชาตญาณดี', 'เข้าใจคนอื่น'],
    weaknesses: ['อารมณ์อ่อนไหว', 'ลังเลใจ', 'วิตกกังวลง่าย'],
    compatibleElements: ['metal', 'wood'],
    conflictingElement: 'earth',
  },
};

/**
 * Stem index lookup by enum key
 */
export function getStemIndex(stem: HeavenlyStem): number {
  return HEAVENLY_STEMS.findIndex(s => s.enumKey === stem);
}

/**
 * Branch index lookup by enum key
 */
export function getBranchIndex(branch: EarthlyBranch): number {
  return EARTHLY_BRANCHES.findIndex(b => b.enumKey === branch);
}

/**
 * Month branch is fixed: yin(2) for month 1, mao(3) for month 2, etc.
 * Chinese month 1 starts at branch index 2 (寅/yin)
 */
export const MONTH_BRANCH_START_INDEX = 2;

/**
 * Solar term approximate dates for determining Chinese months
 * Each entry is [month, day] marking the start of a new Chinese solar month (Jie 节)
 * These are approximate and sufficient for general BaZi calculation
 */
export const SOLAR_TERM_BOUNDARIES: [number, number][] = [
  [2, 4],   // Month 1 (寅): Start of Spring ~Feb 4
  [3, 6],   // Month 2 (卯): Insects Awaken ~Mar 6
  [4, 5],   // Month 3 (辰): Clear and Bright ~Apr 5
  [5, 6],   // Month 4 (巳): Start of Summer ~May 6
  [6, 6],   // Month 5 (午): Grain in Ear ~Jun 6
  [7, 7],   // Month 6 (未): Slight Heat ~Jul 7
  [8, 7],   // Month 7 (申): Start of Autumn ~Aug 7
  [9, 8],   // Month 8 (酉): White Dew ~Sep 8
  [10, 8],  // Month 9 (戌): Cold Dew ~Oct 8
  [11, 7],  // Month 10 (亥): Start of Winter ~Nov 7
  [12, 7],  // Month 11 (子): Heavy Snow ~Dec 7
  [1, 5],   // Month 12 (丑): Slight Cold ~Jan 5
];

/**
 * Reference date for Day Pillar calculation
 * January 1, 1900 is known to be 甲子 (jia-zi) day, stem index 0, branch index 0
 * Actually: Jan 1, 1900 = 庚子 (geng-zi), stem index 6, branch index 0
 */
export const DAY_REFERENCE = {
  date: new Date(1900, 0, 1), // Jan 1, 1900
  stemIndex: 6,   // 庚 (geng)
  branchIndex: 0, // 子 (zi)
};

/**
 * Chinese hour (時辰) mapping from 24-hour clock
 * Each Chinese hour spans 2 hours, starting from 23:00 (zi hour)
 */
export const CHINESE_HOURS: { branchIndex: number; start: number; end: number }[] = [
  { branchIndex: 0,  start: 23, end: 1 },  // 子 zi   23:00-00:59
  { branchIndex: 1,  start: 1,  end: 3 },  // 丑 chou 01:00-02:59
  { branchIndex: 2,  start: 3,  end: 5 },  // 寅 yin  03:00-04:59
  { branchIndex: 3,  start: 5,  end: 7 },  // 卯 mao  05:00-06:59
  { branchIndex: 4,  start: 7,  end: 9 },  // 辰 chen 07:00-08:59
  { branchIndex: 5,  start: 9,  end: 11 }, // 巳 si   09:00-10:59
  { branchIndex: 6,  start: 11, end: 13 }, // 午 wu   11:00-12:59
  { branchIndex: 7,  start: 13, end: 15 }, // 未 wei  13:00-14:59
  { branchIndex: 8,  start: 15, end: 17 }, // 申 shen 15:00-16:59
  { branchIndex: 9,  start: 17, end: 19 }, // 酉 you  17:00-18:59
  { branchIndex: 10, start: 19, end: 21 }, // 戌 xu   19:00-20:59
  { branchIndex: 11, start: 21, end: 23 }, // 亥 hai  21:00-22:59
];
