import type { BaziChart, Element } from '../shared';
import { ELEMENT_PRODUCING, ELEMENT_CONTROLLING } from './constants';

/**
 * PLACEHOLDER: Calculate compatibility between two Bazi charts
 *
 * Compatibility factors:
 * - Element interactions (生 supporting, 克 controlling, 合 combining)
 * - Branch relationships (六合, 三合, 六冲, etc.)
 * - Stem interactions
 *
 * Returns score 0-100 and detailed analysis
 *
 * TODO: Implement full compatibility algorithm
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
  // Mock implementation
  return {
    score: 75,
    elementHarmony: 80,
    branchHarmony: 70,
    overallAnalysis: 'ความเข้ากันได้อยู่ในระดับดี มีจุดเด่นในการเติมเต็มกัน',
    strengths: [
      'องค์ประกอบธาตุสนับสนุนซึ่งกันและกัน',
      'มีความเข้าใจและเคารพซึ่งกันและกัน',
    ],
    challenges: [
      'อาจมีความขัดแย้งเรื่องการตัดสินใจบางครั้ง',
      'ควรให้พื้นที่ส่วนตัวแก่กัน',
    ],
  };
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
