import type { Element, ThaiDay } from '../shared';
import { type MbtiType, isValidMbtiType } from '../shared';

/**
 * Deterministic trait chips for the teaser: three short, specific Thai phrases
 * pulled from lookup tables, never the LLM. One chip per system (thai/bazi,
 * plus mbti when the user gave one) so the teaser can show "here is what each
 * system already says about you" before the paid LLM narrative even runs.
 */

export type TraitChipSystem = 'thai' | 'bazi' | 'mbti';

export interface TraitChip {
  system: TraitChipSystem;
  /** Short display label, e.g. "เกิดวันจันทร์", "ธาตุไฟ", "INTP". */
  label: string;
  /** The trait itself — max ~16 Thai characters, specific, never generic praise. */
  trait: string;
}

/**
 * Normalize a raw profile.mbtiType into a valid MbtiType, or null.
 * BirthProfileSchema only bounds the string to <=4 chars — it does not
 * validate the type code or its casing, so "", "intp", and "xxxx" must all be
 * handled here rather than at each call site. This is the ONE place that
 * decides whether the user "has" an MBTI type for chips, prompts, and flags.
 */
export function normalizeMbtiType(raw: string | null | undefined): MbtiType | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return isValidMbtiType(upper) ? (upper as MbtiType) : null;
}

/**
 * Thai birth-day trait, keyed by the 8-member ThaiDay enum (includes both
 * wednesday_day and wednesday_night as distinct entries, matching how the rest
 * of the codebase — see lib/astrology/thai.ts — already splits Wednesday).
 */
export const THAI_DAY_LABELS: Record<ThaiDay, string> = {
  sunday: 'เกิดวันอาทิตย์',
  monday: 'เกิดวันจันทร์',
  tuesday: 'เกิดวันอังคาร',
  wednesday_day: 'เกิดวันพุธกลางวัน',
  wednesday_night: 'เกิดวันพุธกลางคืน',
  thursday: 'เกิดวันพฤหัสบดี',
  friday: 'เกิดวันศุกร์',
  saturday: 'เกิดวันเสาร์',
};

const THAI_DAY_TRAITS: Record<ThaiDay, string> = {
  sunday: 'นำทีมได้เอง',
  monday: 'อ่านใจคนไว',
  tuesday: 'ลุยไม่กลัวเสี่ยง',
  wednesday_day: 'พูดให้เข้าใจง่าย',
  wednesday_night: 'เห็นสิ่งที่คนลืม',
  thursday: 'คนมาปรึกษาบ่อย',
  friday: 'คนรอบตัวสบายใจ',
  saturday: 'ยึดเป้าหมายมั่น',
};

/** Bazi day-master element trait. */
export const BAZI_ELEMENT_LABELS: Record<Element, string> = {
  wood: 'ธาตุไม้',
  fire: 'ธาตุไฟ',
  earth: 'ธาตุดิน',
  metal: 'ธาตุทอง',
  water: 'ธาตุน้ำ',
};

const BAZI_ELEMENT_TRAITS: Record<Element, string> = {
  wood: 'โตจากลงมือทำ',
  fire: 'จุดไฟให้คนรอบตัว',
  earth: 'พึ่งได้ยามคนล้ม',
  metal: 'ตัดสินใจไม่ลังเล',
  water: 'ปรับตัวไวมาก',
};

/** MBTI type trait — one specific, non-generic phrase per type. */
const MBTI_TRAITS: Record<MbtiType, string> = {
  INTJ: 'วางแผนยาวรอบคอบ',
  INTP: 'ขุดเหตุผลสุดทาง',
  ENTJ: 'ดันทีมให้ถึงฝัน',
  ENTP: 'ท้าทายของเดิม',
  INFJ: 'มองทะลุใจคน',
  INFP: 'ยึดคุณค่าตัวเอง',
  ENFJ: 'ดึงศักยภาพคนอื่น',
  ENFP: 'จุดไฟไอเดียใหม่',
  ISTJ: 'ทำตามแผนเป๊ะ',
  ISFJ: 'ใส่ใจสิ่งคนลืม',
  ESTJ: 'จัดระเบียบทุกจุด',
  ESFJ: 'ประสานคนในทีม',
  ISTP: 'ลงมือแก้ปัญหาไว',
  ISFP: 'ทำตามจังหวะตน',
  ESTP: 'กล้าเสี่ยงทันที',
  ESFP: 'ทำบรรยากาศสนุก',
};

export function buildTraitChips(
  thaiDay: ThaiDay,
  element: Element,
  mbtiType: MbtiType | null,
): TraitChip[] {
  const chips: TraitChip[] = [
    { system: 'thai', label: THAI_DAY_LABELS[thaiDay], trait: THAI_DAY_TRAITS[thaiDay] },
    { system: 'bazi', label: BAZI_ELEMENT_LABELS[element], trait: BAZI_ELEMENT_TRAITS[element] },
  ];

  if (mbtiType) {
    chips.push({ system: 'mbti', label: mbtiType, trait: MBTI_TRAITS[mbtiType] });
  }

  return chips;
}

/** Exported for the completeness/length unit test. */
export const TRAIT_CHIP_TABLES = {
  thaiDayTraits: THAI_DAY_TRAITS,
  baziElementTraits: BAZI_ELEMENT_TRAITS,
  mbtiTraits: MBTI_TRAITS,
};
