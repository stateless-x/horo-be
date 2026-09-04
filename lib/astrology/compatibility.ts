import type { BaziChart, EarthlyBranch, Element } from '../shared';
import { ELEMENT_PRODUCING, ELEMENT_CONTROLLING } from './constants';

type BranchRelation = 'combine' | 'trine' | 'clash' | 'harm' | 'same' | 'neutral';

const BRANCH_COMBINATIONS: [EarthlyBranch, EarthlyBranch][] = [
  ['zi', 'chou'], ['yin', 'hai'], ['mao', 'xu'],
  ['chen', 'you'], ['si', 'shen'], ['wu', 'wei'],
];

const BRANCH_CLASHES: [EarthlyBranch, EarthlyBranch][] = [
  ['zi', 'wu'], ['chou', 'wei'], ['yin', 'shen'],
  ['mao', 'you'], ['chen', 'xu'], ['si', 'hai'],
];

const BRANCH_HARMS: [EarthlyBranch, EarthlyBranch][] = [
  ['zi', 'wei'], ['chou', 'wu'], ['yin', 'si'],
  ['mao', 'chen'], ['shen', 'hai'], ['you', 'xu'],
];

const BRANCH_TRINES: EarthlyBranch[][] = [
  ['shen', 'zi', 'chen'], ['hai', 'mao', 'wei'],
  ['yin', 'wu', 'xu'], ['si', 'you', 'chou'],
];

const ELEMENT_HARMONY_SCORE: Record<ReturnType<typeof getElementInteraction>['type'], number> = {
  producing: 88, weakening: 88, same: 72,
  controlling: 42, overacting: 42, neutral: 60,
};

const BRANCH_HARMONY_SCORE: Record<BranchRelation, number> = {
  combine: 90, trine: 78, same: 68,
  neutral: 60, harm: 44, clash: 32,
};

function hasPair(
  pairs: [EarthlyBranch, EarthlyBranch][],
  branchA: EarthlyBranch,
  branchB: EarthlyBranch,
): boolean {
  return pairs.some(([left, right]) =>
    (left === branchA && right === branchB) || (left === branchB && right === branchA)
  );
}

function getBranchRelation(branchA: EarthlyBranch, branchB: EarthlyBranch): BranchRelation {
  if (branchA === branchB) return 'same';
  if (hasPair(BRANCH_COMBINATIONS, branchA, branchB)) return 'combine';
  if (hasPair(BRANCH_CLASHES, branchA, branchB)) return 'clash';
  if (hasPair(BRANCH_HARMS, branchA, branchB)) return 'harm';
  if (BRANCH_TRINES.some(group => group.includes(branchA) && group.includes(branchB))) return 'trine';
  return 'neutral';
}

function describeElementStrength(type: ReturnType<typeof getElementInteraction>['type']): string | null {
  if (type === 'producing' || type === 'weakening') return 'ธาตุหลักของทั้งคู่ส่งเสริมและเติมพลังให้กัน';
  if (type === 'same') return 'ธาตุหลักคล้ายกัน จึงเข้าใจแรงผลักดันของกันและกันได้ง่าย';
  return null;
}

function describeElementChallenge(type: ReturnType<typeof getElementInteraction>['type']): string | null {
  if (type === 'controlling' || type === 'overacting') return 'ธาตุหลักมีแรงควบคุมกัน ต้องระวังการกดดันหรือเอาชนะ';
  if (type === 'same') return 'พลังที่คล้ายกันอาจทำให้ต่างฝ่ายต่างยืนกรานเมื่อเห็นไม่ตรงกัน';
  return null;
}

function describeBranchStrength(relation: BranchRelation): string | null {
  if (relation === 'combine') return 'นักษัตรประจำวันเกิดเป็นคู่ประสาน ช่วยให้ปรับจังหวะเข้าหากันได้ดี';
  if (relation === 'trine') return 'นักษัตรประจำวันเกิดอยู่ในกลุ่มพลังเดียวกัน จึงมีแนวโน้มร่วมมือกันได้ง่าย';
  if (relation === 'same') return 'นักษัตรประจำวันเกิดเหมือนกัน ทำให้มองสถานการณ์หลายอย่างคล้ายกัน';
  return null;
}

function describeBranchChallenge(relation: BranchRelation): string | null {
  if (relation === 'clash') return 'นักษัตรประจำวันเกิดปะทะกันโดยตรง ควรเว้นจังหวะก่อนตอบโต้เมื่อขัดแย้ง';
  if (relation === 'harm') return 'นักษัตรประจำวันเกิดมีแรงบั่นทอนกัน ควรสื่อสารความคาดหวังให้ชัด';
  return null;
}

/**
 * Calculate a deterministic compatibility score from Five Element interaction
 * and Earthly Branch relationships. Day pillars carry the most branch weight;
 * year pillars add broader context.
 */
export function calculateCompatibility(
  chartA: BaziChart,
  chartB: BaziChart
): {
  score: number;
  elementHarmony: number;
  branchHarmony: number;
  overallAnalysis: string;
  strengths: string[];
  challenges: string[];
} {
  const elementInteraction = getElementInteraction(chartA.element, chartB.element);
  const elementHarmony = ELEMENT_HARMONY_SCORE[elementInteraction.type];
  const dayRelation = getBranchRelation(chartA.dayPillar.branch, chartB.dayPillar.branch);
  const yearRelation = getBranchRelation(chartA.yearPillar.branch, chartB.yearPillar.branch);
  const branchHarmony = Math.round(
    BRANCH_HARMONY_SCORE[dayRelation] * 0.7 + BRANCH_HARMONY_SCORE[yearRelation] * 0.3
  );
  const score = Math.round(elementHarmony * 0.55 + branchHarmony * 0.45);

  const strengths = [
    describeElementStrength(elementInteraction.type),
    describeBranchStrength(dayRelation),
  ].filter((item): item is string => Boolean(item));
  const challenges = [
    describeElementChallenge(elementInteraction.type),
    describeBranchChallenge(dayRelation),
  ].filter((item): item is string => Boolean(item));

  if (strengths.length === 0) strengths.push('พลังของทั้งคู่ต่างกันพอดี จึงเปิดมุมมองใหม่ให้กันได้');
  if (challenges.length === 0) challenges.push('ควรสื่อสารความต้องการตรง ๆ เพื่อไม่ให้ความต่างเล็กน้อยสะสม');

  const overallAnalysis = score >= 80
    ? 'ความเข้ากันได้เด่น มีแรงส่งเสริมกันชัดเจน'
    : score >= 65
      ? 'ความเข้ากันได้อยู่ในระดับดี มีทั้งจุดร่วมและพื้นที่ให้ปรับตัว'
      : score >= 50
        ? 'ความเข้ากันได้ปานกลาง ต้องอาศัยการสื่อสารและการปรับจังหวะ'
        : 'ความสัมพันธ์นี้มีแรงปะทะชัดเจน ควรค่อย ๆ เรียนรู้ขอบเขตของกันและกัน';

  return { score, elementHarmony, branchHarmony, overallAnalysis, strengths, challenges };
}

/**
 * Calculate element interaction type between two elements.
 * Uses the Five Element producing and controlling cycles.
 */
export function getElementInteraction(
  element1: Element,
  element2: Element
): {
  type: 'producing' | 'controlling' | 'weakening' | 'overacting' | 'same' | 'neutral';
  description: string;
} {
  if (element1 === element2) {
    return { type: 'same', description: `${element1} reinforces ${element2}` };
  }

  // Producing cycle: element1 produces element2
  if (ELEMENT_PRODUCING[element1] === element2) {
    return { type: 'producing', description: `${element1} produces ${element2}` };
  }

  // Reverse producing: element2 produces element1 (draining element2)
  if (ELEMENT_PRODUCING[element2] === element1) {
    return { type: 'weakening', description: `${element2} drains ${element1}` };
  }

  // Controlling cycle: element1 controls element2
  if (ELEMENT_CONTROLLING[element1] === element2) {
    return { type: 'controlling', description: `${element1} controls ${element2}` };
  }

  // Reverse controlling: element2 controls element1
  if (ELEMENT_CONTROLLING[element2] === element1) {
    return { type: 'overacting', description: `${element2} controls ${element1}` };
  }

  return { type: 'neutral', description: 'No direct cycle relationship' };
}
