/**
 * MBTI (Myers-Briggs Type Indicator) Constants
 *
 * 16 personality types organized into 4 groups.
 * Used in onboarding step and LLM prompt enrichment.
 */

export type MbtiType =
  | 'INTJ' | 'INTP' | 'ENTJ' | 'ENTP'
  | 'INFJ' | 'INFP' | 'ENFJ' | 'ENFP'
  | 'ISTJ' | 'ISFJ' | 'ESTJ' | 'ESFJ'
  | 'ISTP' | 'ISFP' | 'ESTP' | 'ESFP';

export type MbtiGroup = 'analysts' | 'diplomats' | 'sentinels' | 'explorers';

export interface MbtiTypeInfo {
  code: MbtiType;
  nameTh: string;
  nameEn: string;
  group: MbtiGroup;
}

export interface MbtiGroupInfo {
  key: MbtiGroup;
  nameTh: string;
  nameEn: string;
  types: MbtiTypeInfo[];
}

/**
 * All 16 MBTI types with Thai names (matching 16personalities.com/th)
 */
export const MBTI_TYPES: MbtiTypeInfo[] = [
  // Analysts (NT)
  { code: 'INTJ', nameTh: 'นักยุทธศาสตร์', nameEn: 'Architect', group: 'analysts' },
  { code: 'INTP', nameTh: 'นักตรรกะ', nameEn: 'Logician', group: 'analysts' },
  { code: 'ENTJ', nameTh: 'ผู้บัญชาการ', nameEn: 'Commander', group: 'analysts' },
  { code: 'ENTP', nameTh: 'นักโต้วาที', nameEn: 'Debater', group: 'analysts' },
  // Diplomats (NF)
  { code: 'INFJ', nameTh: 'ผู้สนับสนุน', nameEn: 'Advocate', group: 'diplomats' },
  { code: 'INFP', nameTh: 'นักสื่อกลาง', nameEn: 'Mediator', group: 'diplomats' },
  { code: 'ENFJ', nameTh: 'ตัวเอก', nameEn: 'Protagonist', group: 'diplomats' },
  { code: 'ENFP', nameTh: 'ผู้รณรงค์', nameEn: 'Campaigner', group: 'diplomats' },
  // Sentinels (SJ)
  { code: 'ISTJ', nameTh: 'นักจัดการ', nameEn: 'Logistician', group: 'sentinels' },
  { code: 'ISFJ', nameTh: 'ผู้ปกป้อง', nameEn: 'Defender', group: 'sentinels' },
  { code: 'ESTJ', nameTh: 'ผู้บริหาร', nameEn: 'Executive', group: 'sentinels' },
  { code: 'ESFJ', nameTh: 'ผู้ดูแล', nameEn: 'Consul', group: 'sentinels' },
  // Explorers (SP)
  { code: 'ISTP', nameTh: 'ช่างฝีมือ', nameEn: 'Virtuoso', group: 'explorers' },
  { code: 'ISFP', nameTh: 'นักผจญภัย', nameEn: 'Adventurer', group: 'explorers' },
  { code: 'ESTP', nameTh: 'ผู้ประกอบการ', nameEn: 'Entrepreneur', group: 'explorers' },
  { code: 'ESFP', nameTh: 'ผู้สร้างสีสัน', nameEn: 'Entertainer', group: 'explorers' },
];

/**
 * Groups organized for UI display
 */
export const MBTI_GROUPS: MbtiGroupInfo[] = [
  {
    key: 'analysts',
    nameTh: 'นักวิเคราะห์',
    nameEn: 'Analysts',
    types: MBTI_TYPES.filter(t => t.group === 'analysts'),
  },
  {
    key: 'diplomats',
    nameTh: 'นักการทูต',
    nameEn: 'Diplomats',
    types: MBTI_TYPES.filter(t => t.group === 'diplomats'),
  },
  {
    key: 'sentinels',
    nameTh: 'ผู้พิทักษ์',
    nameEn: 'Sentinels',
    types: MBTI_TYPES.filter(t => t.group === 'sentinels'),
  },
  {
    key: 'explorers',
    nameTh: 'นักสำรวจ',
    nameEn: 'Explorers',
    types: MBTI_TYPES.filter(t => t.group === 'explorers'),
  },
];

/**
 * MBTI Cognitive Functions data — deterministic personality data per type.
 * Embedded into LLM prompts to give the model accurate MBTI context.
 * All descriptions in Thai for the Thai-language LLM prompts.
 */
export const MBTI_COGNITIVE_FUNCTIONS: Record<MbtiType, {
  dominantFunction: string;
  auxiliaryFunction: string;
  strengths: string;
  weaknesses: string;
  summary: string;
}> = {
  // Analysts
  INTJ: {
    dominantFunction: 'Ni (สัญชาตญาณเชิงลึก)',
    auxiliaryFunction: 'Te (ตรรกะเชิงระบบ)',
    strengths: 'วางแผนระยะยาวเก่ง มองเห็นภาพรวม เด็ดขาด มุ่งมั่น',
    weaknesses: 'เข้าสังคมยาก ดื้อรั้นเรื่องวิสัยทัศน์ คาดหวังสูง',
    summary: 'นักวางแผนเชิงกลยุทธ์ที่มองเห็นอนาคตและลงมือทำให้เป็นจริง',
  },
  INTP: {
    dominantFunction: 'Ti (คิดวิเคราะห์เชิงตรรกะ)',
    auxiliaryFunction: 'Ne (สัญชาตญาณสร้างสรรค์)',
    strengths: 'วิเคราะห์ลึก เห็นรูปแบบ คิดนอกกรอบ ใฝ่รู้',
    weaknesses: 'ตัดสินใจช้า ชอบอยู่คนเดียว ละเลยอารมณ์ เบื่องานซ้ำซาก',
    summary: 'นักคิดที่หมกมุ่นกับทฤษฎีและการวิเคราะห์ มองหาความจริงเบื้องหลังทุกสิ่ง',
  },
  ENTJ: {
    dominantFunction: 'Te (ตรรกะเชิงระบบ)',
    auxiliaryFunction: 'Ni (สัญชาตญาณเชิงลึก)',
    strengths: 'เป็นผู้นำโดยธรรมชาติ จัดการเก่ง ตัดสินใจเร็ว มองการณ์ไกล',
    weaknesses: 'เผด็จการ ไม่อดทนกับคนช้า ละเลยอารมณ์คนรอบข้าง',
    summary: 'ผู้นำที่เกิดมาเพื่อบัญชาการ มองเห็นเป้าหมายและพาทุกคนไปถึง',
  },
  ENTP: {
    dominantFunction: 'Ne (สัญชาตญาณสร้างสรรค์)',
    auxiliaryFunction: 'Ti (คิดวิเคราะห์เชิงตรรกะ)',
    strengths: 'คิดไว ไหวพริบดี สร้างสรรค์ ท้าทายขนบ',
    weaknesses: 'เบื่อง่าย ไม่จบงาน ชอบเถียง ละเลยรายละเอียด',
    summary: 'นักสร้างสรรค์ที่ชอบตั้งคำถามและท้าทายทุกความเชื่อ',
  },
  // Diplomats
  INFJ: {
    dominantFunction: 'Ni (สัญชาตญาณเชิงลึก)',
    auxiliaryFunction: 'Fe (เข้าใจอารมณ์ผู้อื่น)',
    strengths: 'เข้าใจคนลึกซึ้ง มีอุดมการณ์ สร้างแรงบันดาลใจ มีวิสัยทัศน์',
    weaknesses: 'อ่อนไหวเกินไป สมบูรณ์แบบนิยม เก็บกด หมดพลังง่าย',
    summary: 'ผู้มีวิสัยทัศน์ที่อุทิศตนเพื่ออุดมการณ์และช่วยเหลือผู้อื่น',
  },
  INFP: {
    dominantFunction: 'Fi (คุณค่าภายใน)',
    auxiliaryFunction: 'Ne (สัญชาตญาณสร้างสรรค์)',
    strengths: 'จินตนาการสูง ซื่อสัตย์กับตัวเอง เห็นอกเห็นใจ สร้างสรรค์',
    weaknesses: 'อ่อนไหว หลบหนีความจริง ตัดสินใจยาก ละเลยเรื่องปฏิบัติ',
    summary: 'ศิลปินในจิตวิญญาณที่มองโลกผ่านเลนส์ของอุดมคติและความงาม',
  },
  ENFJ: {
    dominantFunction: 'Fe (เข้าใจอารมณ์ผู้อื่น)',
    auxiliaryFunction: 'Ni (สัญชาตญาณเชิงลึก)',
    strengths: 'ดึงดูดใจ สร้างแรงบันดาลใจ เข้าใจคน เป็นผู้นำที่อบอุ่น',
    weaknesses: 'เสียสละตัวเองมากเกินไป ต้องการการยอมรับ ควบคุมมากเกิน',
    summary: 'ผู้นำที่ขับเคลื่อนด้วยหัวใจ สร้างแรงบันดาลใจและดูแลทุกคนรอบข้าง',
  },
  ENFP: {
    dominantFunction: 'Ne (สัญชาตญาณสร้างสรรค์)',
    auxiliaryFunction: 'Fi (คุณค่าภายใน)',
    strengths: 'กระตือรือร้น สร้างสรรค์ เข้าสังคมเก่ง มองโลกในแง่ดี',
    weaknesses: 'สมาธิสั้น อารมณ์แปรปรวน ทำหลายอย่างไม่จบ',
    summary: 'นักสร้างแรงบันดาลใจที่เต็มไปด้วยพลังและความคิดสร้างสรรค์',
  },
  // Sentinels
  ISTJ: {
    dominantFunction: 'Si (ความทรงจำเชิงประสบการณ์)',
    auxiliaryFunction: 'Te (ตรรกะเชิงระบบ)',
    strengths: 'รับผิดชอบสูง เชื่อถือได้ มีระเบียบ ทำงานละเอียด',
    weaknesses: 'ยึดติดกฎ ไม่ยืดหยุ่น ไม่ถนัดแสดงอารมณ์ ต้านการเปลี่ยนแปลง',
    summary: 'ผู้รับผิดชอบที่เชื่อถือได้ ทำทุกอย่างตามระบบอย่างมีประสิทธิภาพ',
  },
  ISFJ: {
    dominantFunction: 'Si (ความทรงจำเชิงประสบการณ์)',
    auxiliaryFunction: 'Fe (เข้าใจอารมณ์ผู้อื่น)',
    strengths: 'ใส่ใจ ทุ่มเท ซื่อสัตย์ จดจำรายละเอียด ดูแลคนเก่ง',
    weaknesses: 'ปฏิเสธไม่เป็น เก็บกด ไม่กล้าเปลี่ยนแปลง เสียสละจนเหนื่อย',
    summary: 'ผู้ดูแลที่ทุ่มเทเพื่อคนรอบข้างอย่างเงียบๆ แต่จริงใจ',
  },
  ESTJ: {
    dominantFunction: 'Te (ตรรกะเชิงระบบ)',
    auxiliaryFunction: 'Si (ความทรงจำเชิงประสบการณ์)',
    strengths: 'จัดการเก่ง ตรงไปตรงมา เป็นผู้นำ มีวินัยสูง',
    weaknesses: 'เข้มงวดเกินไป ไม่ยืดหยุ่น ตัดสินคนเร็ว ไม่ฟังคนอื่น',
    summary: 'นักจัดการที่สร้างระเบียบและทำให้ทุกอย่างเดินหน้า',
  },
  ESFJ: {
    dominantFunction: 'Fe (เข้าใจอารมณ์ผู้อื่น)',
    auxiliaryFunction: 'Si (ความทรงจำเชิงประสบการณ์)',
    strengths: 'เป็นมิตร ใส่ใจคนอื่น สร้างความสามัคคี ดูแลเก่ง',
    weaknesses: 'ต้องการการยอมรับ อ่อนไหวต่อคำวิจารณ์ ยึดติดกับคนอื่น',
    summary: 'ผู้สร้างความอบอุ่นที่ใส่ใจทุกคนรอบข้างและสร้างความสามัคคี',
  },
  // Explorers
  ISTP: {
    dominantFunction: 'Ti (คิดวิเคราะห์เชิงตรรกะ)',
    auxiliaryFunction: 'Se (ประสบการณ์ปัจจุบัน)',
    strengths: 'แก้ปัญหาเฉพาะหน้าเก่ง ใจเย็น ปฏิบัติจริง สังเกตเก่ง',
    weaknesses: 'ไม่แสดงอารมณ์ เบื่อง่าย ไม่ชอบผูกมัด ชอบเสี่ยง',
    summary: 'นักแก้ปัญหาที่ใจเย็นและลงมือทำ มีทักษะทางปฏิบัติเป็นเลิศ',
  },
  ISFP: {
    dominantFunction: 'Fi (คุณค่าภายใน)',
    auxiliaryFunction: 'Se (ประสบการณ์ปัจจุบัน)',
    strengths: 'มีศิลปะ อ่อนโยน ใช้ชีวิตปัจจุบัน ยืดหยุ่น เปิดใจ',
    weaknesses: 'หลีกเลี่ยงความขัดแย้ง วางแผนระยะยาวไม่เก่ง อ่อนไหว',
    summary: 'ศิลปินผู้อ่อนโยนที่ใช้ชีวิตตามคุณค่าภายในและสร้างความงามรอบตัว',
  },
  ESTP: {
    dominantFunction: 'Se (ประสบการณ์ปัจจุบัน)',
    auxiliaryFunction: 'Ti (คิดวิเคราะห์เชิงตรรกะ)',
    strengths: 'กล้าได้กล้าเสีย ปรับตัวไว สังเกตเก่ง ลงมือทำทันที',
    weaknesses: 'ใจร้อน ไม่คิดระยะยาว เบื่อทฤษฎี ไม่สนใจอารมณ์คนอื่น',
    summary: 'นักปฏิบัติที่กล้าได้กล้าเสีย ชอบความตื่นเต้นและลงมือทำทันที',
  },
  ESFP: {
    dominantFunction: 'Se (ประสบการณ์ปัจจุบัน)',
    auxiliaryFunction: 'Fi (คุณค่าภายใน)',
    strengths: 'สนุกสนาน มีเสน่ห์ ปรับตัวเก่ง เข้ากับคนง่าย',
    weaknesses: 'ไม่ชอบวางแผน หลีกเลี่ยงความขัดแย้ง สมาธิสั้น',
    summary: 'ผู้สร้างสีสันที่มีเสน่ห์ดึงดูด ทำให้ทุกที่ที่ไปเต็มไปด้วยความสนุก',
  },
};

/**
 * Look up MBTI info by code
 */
export function getMbtiInfo(code: string): MbtiTypeInfo | undefined {
  return MBTI_TYPES.find(t => t.code === code.toUpperCase());
}

/**
 * Get cognitive functions data for a given MBTI type
 */
export function getMbtiCognitiveFunctions(code: string) {
  const key = code.toUpperCase() as MbtiType;
  return MBTI_COGNITIVE_FUNCTIONS[key] ?? undefined;
}

/**
 * Validate if a string is a valid MBTI type code
 */
export function isValidMbtiType(code: string): code is MbtiType {
  return MBTI_TYPES.some(t => t.code === code.toUpperCase());
}
