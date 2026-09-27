import type { BranchRelation } from './compatibility';

/**
 * DRAFT, FOR OWNER REVIEW (2026-09-27). Names and taglines are placeholders
 * until the owner signs them off; the keying is final.
 *
 * One pair archetype per (element class × day-branch relation): 3 × 6 = 18.
 * Both keys are symmetric, so swapping the two people never changes the name.
 * - Element class compares the two day-master elements: 'same', 'generating'
 *   (either one produces the other) or 'controlling' (either one controls the
 *   other). With five elements every pair is exactly one of these.
 * - Day-branch relation is the spouse palace (นักษัตรวันเกิด).
 *
 * Writing rules: everyday contemporary Thai, flattering but honest even for a
 * clash, no doom names (no คู่กรรม), no element words (ไม้ ไฟ ดิน ทอง น้ำ)
 * because the prose checks treat those as data, and nothing that only fits a
 * couple: family, friends and bosses get these names too.
 */

export type ElementClass = 'same' | 'generating' | 'controlling';

export interface PairArchetype {
  key: `${ElementClass}-${BranchRelation}`;
  name: string;
  tagline: string;
}

export const PAIR_ARCHETYPES: Record<ElementClass, Record<BranchRelation, Omit<PairArchetype, 'key'>>> = {
  same: {
    combine: { name: 'คู่รู้ใจ', tagline: 'คิดคล้ายกันและเข้าจังหวะกันได้เองโดยไม่ต้องอธิบายเยอะ' },
    trine: { name: 'คู่ทีมเดียวกัน', tagline: 'มองไปทางเดียวกัน ยิ่งมีเป้าหมายร่วมยิ่งไปได้ไว' },
    same: { name: 'คู่กระจกเงา', tagline: 'เหมือนกันจนเห็นตัวเองในอีกคน ทั้งข้อดีและเรื่องที่ต้องระวัง' },
    neutral: { name: 'คู่เพื่อนร่วมทาง', tagline: 'เดินข้างกันได้สบาย แต่ต้องมีเรื่องใหม่มาเติมให้ไม่นิ่ง' },
    harm: { name: 'คู่ดื้อพอกัน', tagline: 'เข้าใจกันเร็ว แต่ถ้าไม่พูดตรง ๆ ความน้อยใจจะสะสมเงียบ ๆ' },
    clash: { name: 'คู่หัวแข็งเจอกัน', tagline: 'แรงพอกันทั้งคู่ ถ้ายอมกันเป็นจะกลายเป็นทีมที่แกร่งมาก' },
  },
  generating: {
    combine: { name: 'คู่เติมเต็ม', tagline: 'คนหนึ่งหนุน อีกคนเติบโต และต่างคนต่างอยากอยู่ใกล้กัน' },
    trine: { name: 'คู่ส่งแรงกัน', tagline: 'ต่างคนต่างดันกันไปข้างหน้า เป้าหมายยิ่งชัดยิ่งไปไกล' },
    same: { name: 'คู่ประคองกัน', tagline: 'มีคนคอยประคองและคนที่รับแล้วส่งต่อ มุมมองคล้ายกันจนสบายใจ' },
    neutral: { name: 'คู่อบอุ่นแบบค่อยเป็นค่อยไป', tagline: 'ความใส่ใจค่อย ๆ ก่อตัว ยิ่งอยู่ด้วยกันนานยิ่งเห็นค่า' },
    harm: { name: 'คู่ห่วงแต่ไม่พูด', tagline: 'ใส่ใจกันจริง แต่ความห่วงอาจออกมาในแบบที่อีกคนอ่านไม่ออก' },
    clash: { name: 'คู่ต่างขั้วที่ดึงดูดกัน', tagline: 'อยากดูแลกัน แต่จังหวะชีวิตสวนทาง ต้องหาจุดนัดพบให้เจอ' },
  },
  controlling: {
    combine: { name: 'คู่ท้าทายที่ลงตัว', tagline: 'ต่างกันจนท้าทาย แต่ลึก ๆ แล้วเข้ากันได้ดีกว่าที่เห็น' },
    trine: { name: 'คู่ขัดเกลากัน', tagline: 'ต่างคนต่างดึงศักยภาพของอีกคนออกมาด้วยความต่าง' },
    same: { name: 'คู่ผลัดกันนำ', tagline: 'มองโลกคล้ายกัน แต่ต้องตกลงให้ชัดว่าใครนำเรื่องไหน' },
    neutral: { name: 'คู่เรียนรู้กันและกัน', tagline: 'ความต่างชัดเจน ถ้าเปิดใจจะได้บทเรียนที่ดีที่สุดจากกัน' },
    harm: { name: 'คู่ที่ต้องพูดให้ชัด', tagline: 'มีแรงกดดันเงียบ ๆ ระหว่างกัน ความชัดเจนคือทางออกของคู่นี้' },
    clash: { name: 'คู่พายุกับเข็มทิศ', tagline: 'แรงปะทะชัด แต่ถ้าวางกติกาได้ จะพากันผ่านเรื่องยากได้' },
  },
};
