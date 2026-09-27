import type { Element } from '../shared';

/**
 * DRAFT, FOR OWNER REVIEW (2026-09-27). The owner asked for poetic Thai
 * images in the spirit of "คู่ไฟหลอมทอง"; names and taglines await sign-off.
 *
 * One pair archetype per unordered pair of day-master elements: 5 same-element
 * pairs + 10 mixed = 15. The earlier draft keyed on element class × spouse
 * palace (18 names), but an element image is only true for the pair's own two
 * elements: "generating" covers five different element pairs, so any element
 * word in a class-keyed name would contradict four of them. The spouse palace
 * still drives the chemistry score and leads the verdict when it isn't neutral.
 *
 * Writing rules: contemporary readable Thai, nature and element imagery, only
 * the pair's own elements, gift and tension both honest, no doom names (no
 * คู่กรรม), and nothing that friend-zones a love pair or only fits a couple:
 * family, friends and bosses get these names too.
 */

export interface PairArchetype {
  /** The two elements in ELEMENT_ORDER, e.g. 'fire-metal'. */
  key: string;
  name: string;
  tagline: string;
}

const ELEMENT_ORDER: readonly Element[] = ['wood', 'fire', 'earth', 'metal', 'water'];

/** Keyed by the two elements in ELEMENT_ORDER, so both people get the same entry. */
export const PAIR_ARCHETYPES: Record<string, Omit<PairArchetype, 'key'>> = {
  'wood-wood': { name: 'คู่ไม้ร่วมป่า', tagline: 'โตเคียงกันจนเป็นร่มเงาให้กัน ขอแค่อย่าแย่งแสงกันเอง' },
  'fire-fire': { name: 'คู่ไฟต่อไฟ', tagline: 'จุดประกายให้กันได้ในพริบตา ขอแค่มีช่วงที่ลดไฟลงบ้าง' },
  'earth-earth': { name: 'คู่ดินผืนเดียว', tagline: 'มั่นคงเหมือนแผ่นดินเดียวกัน ขอแค่มีใครเริ่มพรวนให้เรื่องใหม่ได้งอก' },
  'metal-metal': { name: 'คู่ทองสองประกาย', tagline: 'แกร่งและเงางามพอกัน ยืนเคียงกันได้มั่น แต่กระทบกันทีไรก็ดังทั้งคู่' },
  'water-water': { name: 'คู่สายน้ำบรรจบ', tagline: 'เข้าใจกันลึกโดยไม่ต้องพูด ขอแค่ให้น้ำได้ไหลต่อ ไม่นิ่งจนขุ่น' },
  'wood-fire': { name: 'คู่ไม้ต่อไฟ', tagline: 'คนหนึ่งเป็นเชื้อ อีกคนเป็นแสง ส่องทางกันได้ไกลถ้าไม่เผาจนหมดแรง' },
  'fire-earth': { name: 'คู่ไฟปั้นดิน', tagline: 'ความอุ่นของคนหนึ่งทำให้อีกคนแกร่งขึ้น จนเป็นที่พักใจของกันและกัน' },
  'earth-metal': { name: 'คู่ดินบ่มทอง', tagline: 'คนหนึ่งให้ที่ยืน อีกคนได้เปล่งประกาย ยิ่งนานยิ่งเห็นค่า' },
  'metal-water': { name: 'คู่น้ำค้างบนทอง', tagline: 'คนหนึ่งนิ่งและมั่นคง อีกคนอ่อนโยนและลื่นไหล เติมกันจนเต็ม' },
  'wood-water': { name: 'คู่น้ำเลี้ยงไม้', tagline: 'คนหนึ่งหล่อเลี้ยงเงียบ ๆ อีกคนเติบโตให้เห็น งอกงามไปด้วยกัน' },
  'wood-earth': { name: 'คู่รากไม้ยึดดิน', tagline: 'ยึดกันไว้แน่นจนมั่นคง ขอแค่เว้นที่ให้อีกคนได้หายใจ' },
  'earth-water': { name: 'คู่ดินโอบน้ำ', tagline: 'คนหนึ่งวางขอบ อีกคนไหลไปได้ไกล ขอบที่พอดีพาทั้งคู่ไปถึงทะเล' },
  'fire-water': { name: 'คู่น้ำกล่อมไฟ', tagline: 'คนหนึ่งร้อนแรง อีกคนเยือกเย็น พบกันตรงกลางเมื่อไรก็อบอุ่นพอดี' },
  'fire-metal': { name: 'คู่ไฟหลอมทอง', tagline: 'ความร้อนที่ขัดเกลาให้คมขึ้น ขอแค่อย่าร้อนเกินจนเสียรูป' },
  'wood-metal': { name: 'คู่ทองสลักไม้', tagline: 'คมของคนหนึ่งขัดเกลาอีกคนให้เป็นรูปทรง ขอแค่อย่าตัดลึกเกินไป' },
};

export function archetypeKey(a: Element, b: Element): string {
  return [a, b].sort((x, y) => ELEMENT_ORDER.indexOf(x) - ELEMENT_ORDER.indexOf(y)).join('-');
}
