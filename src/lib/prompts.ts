/**
 * LLM Prompts for Fortune Readings
 *
 * All fortune generation goes through DeepSeek via the backend (see lib/llm.ts).
 * The narrator speaks in Thai using "เจ้า" (thou) to address the user.
 * Tone: mysterious, sacred, slightly unsettling - like entering a temple at midnight.
 *
 * Prompt TEXT lives in the markdown files under ./prompts/md/ — edit those to
 * change wording. This module only assembles chart data into the templates
 * (see ./prompts/render.ts for the {{var}} / {{#block}} syntax).
 */

import type { BaziChart, ThaiAstrology, EnrichedPillar, ElementProfile, PillarInteraction, RelationshipType, MbtiType, Gender, HeavenlyStem, V4SectionKey } from "../../lib/shared";
import type { FortuneCategoryKey } from "../../lib/shared/types/astrology";
import { getMbtiInfo, getMbtiCognitiveFunctions, getMbtiActionableGuidance } from "../../lib/shared";
import { getReadingPeriod, toBuddhistYear } from "../../lib/shared/utils/date";
import { THAI_MONTHS_FULL } from "../../lib/shared/constants/thai-time";
import { renderPrompt } from "./prompts/render";
import {
  buildTraitChips,
  BAZI_ELEMENT_LABELS,
  THAI_DAY_LABELS,
  HEAVENLY_STEMS,
  ELEMENT_PRODUCING,
  ELEMENT_CONTROLLING,
  type BranchRelation,
  type CalendarMonth,
  type Dimension,
  type DimensionInput,
  type MonthLabel,
  type PairArchetype,
  type PairInputs,
  type DailyCategory,
  type TraitChip,
} from "../../lib/astrology";

import systemMd from "./prompts/md/system.md" with { type: "text" };
import systemStructuredMd from "./prompts/md/system-structured.md" with { type: "text" };
import teaserMd from "./prompts/md/teaser.md" with { type: "text" };
import chartMd from "./prompts/md/chart.md" with { type: "text" };
import compatibilityDataMd from "./prompts/md/compatibility-data.md" with { type: "text" };
import compatibilityScoreMd from "./prompts/md/compatibility-score.md" with { type: "text" };
import compatibilityV4ContextMd from "./prompts/md/compatibility-v4-context.md" with { type: "text" };
import compatibilityV4RulesMd from "./prompts/md/compatibility-v4-rules.md" with { type: "text" };
import compatibilityV4TasksPlanMd from "./prompts/md/compatibility-v4-tasks-plan.md" with { type: "text" };
import compatibilityV4TasksWriteMd from "./prompts/md/compatibility-v4-tasks-write.md" with { type: "text" };
import compatibilityV4SectionsMd from "./prompts/md/compatibility-v4-sections.md" with { type: "text" };
import compatibilityV2TasksMd from "./prompts/md/compatibility-v2-tasks.md" with { type: "text" };
import compatibilityV3ContextMd from "./prompts/md/compatibility-v3-context.md" with { type: "text" };
import compatibilityV3TasksMd from "./prompts/md/compatibility-v3-tasks.md" with { type: "text" };
import compatibilityRulesMd from "./prompts/md/compatibility-rules.md" with { type: "text" };
import compatibilityMbtiGuidanceMd from "./prompts/md/compatibility-mbti-guidance.md" with { type: "text" };
import mbtiContextMd from "./prompts/md/mbti-context.md" with { type: "text" };
import focusTalkingMd from "./prompts/md/compatibility-focus/talking.md" with { type: "text" };
import focusRomanticMd from "./prompts/md/compatibility-focus/romantic.md" with { type: "text" };
import focusBossMd from "./prompts/md/compatibility-focus/boss.md" with { type: "text" };
import focusCoworkerMd from "./prompts/md/compatibility-focus/coworker.md" with { type: "text" };
import focusFriendMd from "./prompts/md/compatibility-focus/friend.md" with { type: "text" };
import focusFamilyMd from "./prompts/md/compatibility-focus/family.md" with { type: "text" };

/**
 * System prompt for all LLM calls
 * Ensures consistent narrator voice and Thai cultural context
 */
export const SYSTEM_PROMPT = systemMd.trimEnd();

/**
 * System prompt variant for structured JSON output
 * Used with the LLM client's JSON output mode (see lib/llm.ts)
 */
export const SYSTEM_PROMPT_STRUCTURED = systemStructuredMd.trimEnd();

/**
 * Build MBTI context block for LLM prompts.
 * Returns empty string if mbtiType is null/undefined (excluded from prompt entirely).
 *
 * Enhanced version: Includes actionable guidance for practical, personalized advice.
 */
export function buildMbtiContext(
  mbtiType: string | null | undefined,
  /** Give cognitive functions as Thai glosses only; the bare codes (Ne, Si) leak into Thai prose. */
  thaiGlossOnly = false,
): string {
  if (!mbtiType) return '';

  const info = getMbtiInfo(mbtiType);
  const cognitive = getMbtiCognitiveFunctions(mbtiType);
  const guidance = getMbtiActionableGuidance(mbtiType);
  if (!info || !cognitive || !guidance) return '';

  const numbered = (items: string[]) => items.map((item, i) => `${i + 1}. ${item}`).join('\n');

  return '\n' + renderPrompt(mbtiContextMd, {
    code: info.code,
    nameTh: info.nameTh,
    dominantFunction: thaiGlossOnly ? cognitiveFunctionThai(cognitive.dominantFunction) : cognitive.dominantFunction,
    auxiliaryFunction: thaiGlossOnly ? cognitiveFunctionThai(cognitive.auxiliaryFunction) : cognitive.auxiliaryFunction,
    strengths: cognitive.strengths,
    weaknesses: cognitive.weaknesses,
    decisionMaking: guidance.decisionMaking,
    relationshipStyle: guidance.relationshipStyle,
    pitfalls: numbered(guidance.pitfalls),
    strengthsToLeverage: numbered(guidance.strengthsToLeverage),
    warnings: numbered(guidance.warnings),
  }).trimEnd();
}

/** Thai display label for each daily category, teaser-prompt only — the other
 * prompts (today.md, chart.md) each spell their own labels inline the same way. */
const FOCUS_AREA_LABELS_TH: Record<DailyCategory, string> = {
  love: 'ความรัก',
  career: 'การงาน',
  finance: 'การเงิน',
  health: 'สุขภาพ',
};

/**
 * Thai description of a deterministic score band, for the LLM to write to
 * without inventing its own severity. Bands mirror the neutral midpoint (60)
 * that selectFocusArea measures distance from — see daily-scores.ts.
 */
function focusBandTh(score: number): string {
  if (score >= 75) return 'ดีมาก';
  if (score >= 60) return 'ดี';
  if (score >= 45) return 'ปกติ ต้องระวังเล็กน้อย';
  return 'ต้องใส่ใจเป็นพิเศษ';
}

/**
 * Generate teaser reading (Step 6 in onboarding - BEFORE auth)
 * Enticing short preview designed to hook the user into signing up.
 * Teaser v2: MBTI-aware (when given), grounded in the same deterministic trait
 * chips and focus area shown on screen, so the LLM's threeWay/reading narrate
 * what the user already sees rather than inventing a fourth, disconnected claim.
 */
export function buildTeaserPrompt(
  name: string,
  birthDate: Date,
  baziChart: BaziChart,
  thaiAstrology: ThaiAstrology,
  mbtiType: MbtiType | null,
  focusArea: DailyCategory,
  focusScore: number,
  traitChips: TraitChip[],
): string {
  const dateStr = birthDate.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const currentPeriod = new Date().toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
  });

  const thaiChip = traitChips.find((c) => c.system === 'thai');
  const baziChip = traitChips.find((c) => c.system === 'bazi');
  const mbtiChip = traitChips.find((c) => c.system === 'mbti');
  const mbtiInfo = mbtiType ? getMbtiInfo(mbtiType) : undefined;

  return renderPrompt(teaserMd, {
    name,
    birthDateStr: dateStr,
    currentPeriod,
    element: baziChart.element,
    dayMaster: baziChart.dayMaster,
    yearPillar: `${baziChart.yearPillar.stem}${baziChart.yearPillar.branch}`,
    dayPillar: `${baziChart.dayPillar.stem}${baziChart.dayPillar.branch}`,
    thaiDay: thaiAstrology.day,
    personality: thaiAstrology.personality,
    color: thaiAstrology.color,
    luckyNumber: thaiAstrology.luckyNumber,
    thaiTrait: thaiChip ? `${thaiChip.label}: ${thaiChip.trait}` : '',
    baziTrait: baziChip ? `${baziChip.label}: ${baziChip.trait}` : '',
    mbti: Boolean(mbtiType && mbtiInfo && mbtiChip),
    mbtiTrait: mbtiChip ? `${mbtiChip.label}: ${mbtiChip.trait}` : '',
    mbtiType: mbtiType ?? '',
    mbtiNameTh: mbtiInfo?.nameTh ?? '',
    focusAreaTh: FOCUS_AREA_LABELS_TH[focusArea],
    focusBand: focusBandTh(focusScore),
  });
}

/**
 * Relationship-type-specific focus instructions for compatibility prompt
 */
const RELATIONSHIP_FOCUS: Record<RelationshipType, string> = {
  talking: focusTalkingMd.trimEnd(),
  romantic: focusRomanticMd.trimEnd(),
  boss: focusBossMd.trimEnd(),
  coworker: focusCoworkerMd.trimEnd(),
  friend: focusFriendMd.trimEnd(),
  family: focusFamilyMd.trimEnd(),
};

/**
 * The compatibility prompt is three shared pieces: the data block (both
 * people, MBTI guidance, relationship focus, deterministic score), a task list
 * that differs per content version, and the style and safety rules. v2 and v3
 * render the same data and rules, so a rule fixed once applies to both.
 * tests/compatibility-prompt-golden.test.ts pins the v2 result byte for byte.
 */
const COMPATIBILITY_V2_TEMPLATE =
  compatibilityDataMd + compatibilityScoreMd + compatibilityV2TasksMd + compatibilityRulesMd;
const COMPATIBILITY_V3_TEMPLATE =
  compatibilityDataMd + compatibilityScoreMd + compatibilityV3ContextMd + compatibilityV3TasksMd + compatibilityRulesMd;
/**
 * v4 leaves out the score block (the canned 4-band explanation and stock
 * strengths the owner called empty) and gives the computed report facts
 * instead: archetype, dimension scores with their inputs, month labels.
 */
const V4_HEAD = compatibilityDataMd + compatibilityV4ContextMd + compatibilityV3ContextMd + compatibilityV4RulesMd;
const V4_PLAN_TEMPLATE = V4_HEAD + compatibilityV4TasksPlanMd + compatibilityRulesMd;

/** The per-section instructions, keyed by the `### key` headings in compatibility-v4-sections.md. */
const V4_SECTION_TASKS: Record<string, string> = Object.fromEntries(
  compatibilityV4SectionsMd
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [key, ...body] = block.split('\n');
      return [key.trim(), body.join('\n').trim()];
    }),
);

function v4WriteTemplate(sections: readonly V4SectionKey[]): string {
  const tasks = sections.map((key, n) => {
    const task = V4_SECTION_TASKS[key];
    if (!task) throw new Error(`No instructions for report section ${key}`);
    return `${n + 1}. ${task}`;
  });
  return V4_HEAD + compatibilityV4TasksWriteMd.replace('{{SECTION_TASKS}}', tasks.join('\n')) + compatibilityRulesMd;
}

interface CompatibilityPromptPerson {
  name: string;
  /** Reader only: picks pronouns and polite particles for the conversation starter. */
  gender?: Gender | null;
  birthDate: Date;
  baziChart: BaziChart;
  thaiAstrology: ThaiAstrology;
  mbtiType?: string | null;
}

interface CompatibilityScoreContext {
  score: number;
  scoreExplanation: string;
  strengths: string[];
  challenges: string[];
}

function compatibilityDataVars(
  person1: CompatibilityPromptPerson,
  person2: CompatibilityPromptPerson,
  relationshipType: RelationshipType,
  scoreContext: CompatibilityScoreContext,
) {
  const mbtiGuidance = person1.mbtiType ? getMbtiActionableGuidance(person1.mbtiType) : null;

  const relationGuidance = mbtiGuidance
    ? (relationshipType === 'romantic' ? mbtiGuidance.loveGuidance :
       relationshipType === 'family' ? mbtiGuidance.familyGuidance :
       relationshipType === 'boss' || relationshipType === 'coworker' ? mbtiGuidance.careerGuidance :
       mbtiGuidance.socialGuidance)
    : '';

  const mbtiGuidanceBlock = mbtiGuidance
    ? '\n' + renderPrompt(compatibilityMbtiGuidanceMd, {
        relationGuidance,
        pitfalls: mbtiGuidance.pitfalls.map((p, i) => `${i + 1}. ${p}`).join('\n'),
        warnings: mbtiGuidance.warnings.slice(0, 3).map((w, i) => `${i + 1}. ${w}`).join('\n'),
      }).trim()
    : '';

  return {
    mbti: Boolean(person1.mbtiType),
    p2Name: person2.name,
    p1BirthDate: person1.birthDate.toLocaleDateString("th-TH"),
    p1DayMaster: dayMasterThai(person1.baziChart.dayMaster),
    p1Element: BAZI_ELEMENT_LABELS[person1.baziChart.element],
    p1ThaiDay: THAI_DAY_LABELS[person1.thaiAstrology.day],
    p1Planet: thaiPlanetName(person1.thaiAstrology.planet),
    readerGenderLine: READER_GENDER_LINES[person1.gender ?? 'unknown'],
    p2BirthDate: person2.birthDate.toLocaleDateString("th-TH"),
    p2DayMaster: dayMasterThai(person2.baziChart.dayMaster),
    p2Element: BAZI_ELEMENT_LABELS[person2.baziChart.element],
    p2ThaiDay: THAI_DAY_LABELS[person2.thaiAstrology.day],
    p2Planet: thaiPlanetName(person2.thaiAstrology.planet),
    p2Mbti: Boolean(person2.mbtiType),
    p2MbtiType: person2.mbtiType ?? '',
    score: scoreContext.score,
    scoreExplanation: scoreContext.scoreExplanation,
    deterministicStrengths: scoreContext.strengths.map(item => `- ${item}`).join('\n'),
    deterministicChallenges: scoreContext.challenges.map(item => `- ${item}`).join('\n'),
    mbtiContext: buildMbtiContext(person1.mbtiType, true),
    mbtiGuidanceBlock,
    focusBlock: RELATIONSHIP_FOCUS[relationshipType],
  };
}

/**
 * Generate compatibility reading between two people (content v2).
 * Analyzes element interactions and relationship dynamics
 * Tailored to the specific relationship type
 */
export function buildCompatibilityPrompt(
  person1: CompatibilityPromptPerson,
  person2: CompatibilityPromptPerson,
  relationshipType: RelationshipType = 'romantic',
  scoreContext: CompatibilityScoreContext,
): string {
  return renderPrompt(
    COMPATIBILITY_V2_TEMPLATE,
    compatibilityDataVars(person1, person2, relationshipType, scoreContext),
  );
}

/**
 * Thai for a day master: its element and polarity, e.g. 'ding' -> 'ไฟหยิน'.
 * The prompt shows only Thai names: raw codes like "ding" or "fire" were
 * echoed into the reading.
 */
function dayMasterThai(stem: HeavenlyStem): string {
  const entry = HEAVENLY_STEMS.find((s) => s.enumKey === stem);
  if (!entry) throw new Error(`Unknown heavenly stem: ${stem}`);
  return `${BAZI_ELEMENT_LABELS[entry.element].replace('ธาตุ', '')}${entry.yinYang === 'yang' ? 'หยาง' : 'หยิน'}`;
}

/** Tells the model which first-person pronoun and polite particle the reader uses. */
const READER_GENDER_LINES: Record<Gender | 'unknown', string> = {
  female: 'ผู้ถามเป็นผู้หญิง ใน conversationStarter ให้ใช้ ดิฉัน หนู หรือ เรา ตามความสนิท และลงท้ายด้วย ค่ะ หรือ คะ',
  male: 'ผู้ถามเป็นผู้ชาย ใน conversationStarter ให้ใช้ ผม หรือ เรา และลงท้ายด้วย ครับ',
  unknown: 'ไม่ทราบเพศของผู้ถาม ใน conversationStarter ให้ใช้ เรา และเลี่ยงคำลงท้ายที่บอกเพศ',
};

/** 'ดวงอังคาร (Mars)' -> 'ดาวอังคาร'. The input comes from a fixed table in lib/astrology/thai.ts. */
function thaiPlanetName(planet: string): string {
  const match = planet.match(/^ดวง(.+) \(.+\)$/);
  if (!match) throw new Error(`Unexpected Thai planet label: ${planet}`);
  return `ดาว${match[1]}`;
}

/** 'Si (ความทรงจำเชิงประสบการณ์)' -> 'ความทรงจำเชิงประสบการณ์'. Bare codes leaked into prose. */
function cognitiveFunctionThai(fn: string): string {
  const match = fn.match(/\((.+)\)/);
  if (!match) throw new Error(`Unexpected cognitive function label: ${fn}`);
  return match[1];
}

/**
 * Compatibility content v3: the v2 data and rules, plus a context block (Thai
 * day personalities, the partner's MBTI tendencies) and the v3 task list that
 * asks for `detail` and `teaser` in one JSON object.
 */
export function buildCompatibilityPromptV3(
  person1: CompatibilityPromptPerson,
  person2: CompatibilityPromptPerson,
  relationshipType: RelationshipType,
  scoreContext: CompatibilityScoreContext,
): string {
  return renderPrompt(COMPATIBILITY_V3_TEMPLATE, {
    ...compatibilityDataVars(person1, person2, relationshipType, scoreContext),
    ...partnerContextVars(person1, person2),
  });
}

/** Thai day personalities and the partner's MBTI tendencies (compatibility-v3-context.md), shared by v3 and v4. */
function partnerContextVars(person1: CompatibilityPromptPerson, person2: CompatibilityPromptPerson) {
  const partnerInfo = person2.mbtiType ? getMbtiInfo(person2.mbtiType) : undefined;
  const partnerCognitive = person2.mbtiType ? getMbtiCognitiveFunctions(person2.mbtiType) : undefined;
  if (person2.mbtiType && (!partnerInfo || !partnerCognitive)) {
    throw new Error(`Unknown partner MBTI type: ${person2.mbtiType}`);
  }
  const missingMbti = [!person1.mbtiType ? 'คุณ' : null, !person2.mbtiType ? person2.name : null]
    .filter((who): who is string => who !== null)
    .join(' และ ');
  return {
    p1Personality: person1.thaiAstrology.personality,
    p2Personality: person2.thaiAstrology.personality,
    p2MbtiNameTh: partnerInfo?.nameTh ?? '',
    p2MbtiDominant: partnerCognitive ? cognitiveFunctionThai(partnerCognitive.dominantFunction) : '',
    p2MbtiAuxiliary: partnerCognitive ? cognitiveFunctionThai(partnerCognitive.auxiliaryFunction) : '',
    p2MbtiStrengths: partnerCognitive?.strengths ?? '',
    p2MbtiWeaknesses: partnerCognitive?.weaknesses ?? '',
    missingMbti,
  };
}

// ---------------------------------------------------------------- v4 report

/**
 * The neutral relation is half of all pairs (6 of 12 branches). Described as
 * "no special force" it became the headline of 6 in 10 v4 verdicts ("the
 * chart has nothing to say"), so it is described as what it is: an open
 * palace that does not force the relationship either way.
 */
const BRANCH_RELATION_TH: Record<BranchRelation, string> = {
  combine: 'เป็นคู่ประสานกัน ดึงเข้าหากันเอง',
  trine: 'อยู่กลุ่มพลังเดียวกัน ร่วมมือกันง่าย',
  same: 'เป็นนักษัตรเดียวกัน มองหลายเรื่องคล้ายกัน',
  neutral: 'เปิดทางให้กัน ความสัมพันธ์ไม่ถูกบังคับ เลือกสร้างเองได้',
  harm: 'มีแรงบั่นทอนกันแบบเงียบ ๆ ความน้อยใจสะสมง่าย',
  clash: 'ปะทะกันตรง ๆ ดึงดูดแรงแต่ขัดกันแรง',
};
const YEAR_RELATION_TH: Record<BranchRelation, string> = {
  ...BRANCH_RELATION_TH,
  neutral: 'ไม่ชงและไม่บั่นทอนกัน จังหวะชีวิตไม่ถูกดึงให้สวนทาง',
  clash: 'ปะทะกัน (ปีชงกัน) จังหวะชีวิตสวนทางกันง่าย',
};

/**
 * DRAFT for owner review, like the archetype names: these open most verdicts,
 * so every pair with the same two elements gets the same image.
 *
 * One image per element pair, keyed `${from}-${to}` (the producing or
 * controlling element first; the two cycles never share an ordered pair).
 * Each names only the pair's own elements: a third element in the verdict,
 * the overview or the attraction chapter fails the reading.
 */
export const ELEMENT_IMAGE: Readonly<Record<string, string>> = {
  'wood-wood': 'ไม้สองต้นที่โตเคียงกัน ช่วยกันกันลม แต่ก็แย่งแสงกันได้',
  'fire-fire': 'ไฟสองกองที่รวมกันแล้วสว่างและอุ่นขึ้น แต่ร้อนเร็วถ้าไม่มีใครลดไฟลงบ้าง',
  'earth-earth': 'ดินสองผืนที่ต่อกันเป็นผืนเดียว มั่นคงและพึ่งพากันได้ แต่ขยับช้าถ้าไม่มีใครเริ่มพรวน',
  'metal-metal': 'ทองสองชิ้นที่แข็งและมีคมพอกัน ยืนหยัดด้วยกันได้ดี แต่กระทบกันเมื่อไรก็ดังทั้งคู่',
  'water-water': 'น้ำสองสายที่ไหลมารวมกัน ลึกและเข้าใจกันโดยไม่ต้องพูด แต่ถ้าไม่มีทางไหลก็นิ่งจนขุ่น',
  'wood-fire': 'ไม้เป็นเชื้อให้ไฟลุก คนหนึ่งเติมเชื้อ อีกคนส่องสว่าง แต่ถ้าเติมไม่หยุด ไม้ก็หมดแรง',
  'fire-earth': 'ไฟเผาดินให้แกร่งเป็นภาชนะ คนหนึ่งให้ความอุ่น อีกคนให้ความมั่นคงที่จับต้องได้',
  'earth-metal': 'ดินบ่มแร่จนเป็นทอง คนหนึ่งให้ที่ยืน อีกคนได้เปล่งประกาย',
  'metal-water': 'ทองเป็นภาชนะที่ให้น้ำมีรูปทรง คนหนึ่งวางกรอบ อีกคนเติมให้เต็ม',
  'water-wood': 'น้ำเลี้ยงไม้ให้งอกงาม คนหนึ่งหล่อเลี้ยงเงียบ ๆ อีกคนเติบโตให้เห็น',
  'wood-earth': 'รากไม้ยึดดินไว้ไม่ให้พังทลาย แรงตึงที่ทำให้มั่นคง แต่ถ้ายึดแน่นเกิน ดินก็อึดอัด',
  'earth-water': 'ดินเป็นตลิ่งให้น้ำมีทางไหล คนหนึ่งวางขอบ อีกคนไหลไปได้ไกล แต่ถ้าตลิ่งแน่นเกิน น้ำก็เอ่อ',
  'water-fire': 'น้ำคุมไฟไม่ให้ลุกลาม ไฟทำให้น้ำอุ่นขึ้น แต่ถ้าน้ำมากไป ไฟก็มอด',
  'fire-metal': 'ไฟหลอมทองให้เป็นรูปและคมขึ้น ความร้อนที่ขัดเกลา แต่ถ้าร้อนเกิน ทองก็เสียรูป',
  'metal-wood': 'ทองแกะสลักไม้ให้เป็นรูปทรง คมที่ขัดเกลา แต่ถ้าตัดลึกเกิน ไม้ก็เจ็บ',
};
const DIMENSION_INPUT_TH: Record<DimensionInput, string> = {
  dayBranch: 'ตำแหน่งคู่ในดวง',
  yearBranch: 'ปีนักษัตร',
  element: 'ธาตุ',
  stemCombine: 'เจ้าวันประสานกัน',
  mbti: 'MBTI ของทั้งสองคน',
};
const MONTH_LABEL_TH: Record<MonthLabel, string> = { good: 'ดี', mixed: 'กลาง', caution: 'ระวัง' };
const MONTH_REASON_TH: Record<string, (who: string) => string> = {
  resource: (who) => `ธาตุประจำเดือนหนุนเจ้าวันของ${who}`,
  companion: (who) => `ธาตุประจำเดือนเป็นพวกเดียวกับเจ้าวันของ${who}`,
  output: (who) => `เดือนนี้${who}แสดงออกได้ง่าย`,
  pressure: (who) => `ธาตุประจำเดือนกดดันเจ้าวันของ${who}`,
  combine: (who) => `นักษัตรประจำเดือนประสานกับนักษัตรวันเกิดของ${who}`,
  trine: (who) => `นักษัตรประจำเดือนอยู่กลุ่มเดียวกับนักษัตรวันเกิดของ${who}`,
  harm: (who) => `นักษัตรประจำเดือนบั่นทอนนักษัตรวันเกิดของ${who}`,
  clash: (who) => `นักษัตรประจำเดือนปะทะนักษัตรวันเกิดของ${who}`,
};

/** The future chapter's title and the next step it times, per relationship stage. */
export const V4_FUTURE_BY_RELATIONSHIP: Record<RelationshipType, { title: string; nextStep: string }> = {
  talking: { title: 'สัญญาณว่าไปต่อได้และจังหวะขยับ', nextStep: 'ชวนออกไปเจอกันหรือคุยให้ชัดว่าเป็นอะไรกัน' },
  romantic: { title: 'สิ่งที่ทำให้อยู่ยาว', nextStep: 'คุยเรื่องใหญ่ของความสัมพันธ์ เช่น อนาคตหรือการตัดสินใจร่วมกัน' },
  friend: { title: 'มิตรภาพระยะยาว', nextStep: 'ชวนทำแผนใหญ่ด้วยกันหรือคุยเรื่องที่ค้างใจ' },
  boss: { title: 'โตไปด้วยกันในงาน', nextStep: 'ขอคุยเรื่องขอบเขตงานหรือเรื่องเงินเดือน' },
  coworker: { title: 'โตไปด้วยกันในงาน', nextStep: 'ตกลงบทบาทหรือขอบเขตงานร่วมกัน' },
  family: { title: 'ขอบเขตที่รักษาความสัมพันธ์', nextStep: 'บอกขอบเขตที่คุณต้องการ' },
};

const band = (score: number) => (score >= 75 ? 'เด่น' : score >= 60 ? 'ดี' : score >= 45 ? 'กลาง' : 'ต้องใส่ใจ');

function elementRelationTh(p1: CompatibilityPromptPerson, p2: CompatibilityPromptPerson): string {
  const a = p1.baziChart.element;
  const b = p2.baziChart.element;
  if (a === b) return 'ธาตุเดียวกัน';
  if (ELEMENT_PRODUCING[a] === b) return `ธาตุของคุณหนุนธาตุของ${p2.name}`;
  if (ELEMENT_PRODUCING[b] === a) return `ธาตุของ${p2.name}หนุนธาตุของคุณ`;
  if (ELEMENT_CONTROLLING[a] === b) return `ธาตุของคุณข่มธาตุของ${p2.name}`;
  return `ธาตุของ${p2.name}ข่มธาตุของคุณ`;
}

function elementImage(p1: CompatibilityPromptPerson, p2: CompatibilityPromptPerson): string {
  const a = p1.baziChart.element;
  const b = p2.baziChart.element;
  const readerLeads = a === b || ELEMENT_PRODUCING[a] === b || ELEMENT_CONTROLLING[a] === b;
  return ELEMENT_IMAGE[readerLeads ? `${a}-${b}` : `${b}-${a}`];
}

/**
 * The pair's signals, strongest first, for the verdict, the overview story
 * and the attraction chapter to lead with. The spouse palace leads only when
 * it is not neutral; otherwise the element relation leads, since it always
 * says something, then the year branch, then the MBTI pairing.
 */
function leadSignalsTh(p1: CompatibilityPromptPerson, p2: CompatibilityPromptPerson, inputs: PairInputs): string {
  const signals = [
    inputs.dayRelation !== 'neutral' ? `ตำแหน่งคู่ในดวง: นักษัตรวันเกิด${BRANCH_RELATION_TH[inputs.dayRelation]}` : null,
    `ธาตุ: ${elementRelationTh(p1, p2)} ภาพของคู่นี้คือ ${elementImage(p1, p2)}`,
    inputs.yearRelation !== 'neutral' ? `ปีนักษัตร: ${YEAR_RELATION_TH[inputs.yearRelation]}` : null,
    inputs.mbti ? `MBTI: คุณเป็น ${inputs.mbti.reader} ส่วน${p2.name}เป็น ${inputs.mbti.partner}` : null,
  ].filter((signal): signal is string => signal !== null);
  return signals.map((signal, i) => `  ${i + 1}. ${signal}`).join('\n');
}

const thaiMonth = (month: string) => {
  const [year, m] = month.split('-').map(Number);
  return `${THAI_MONTHS_FULL[m - 1]} ${toBuddhistYear(year)}`;
};

export interface V4ReportFacts {
  score: number;
  inputs: PairInputs;
  dimensions: Dimension[];
  archetype: PairArchetype;
  calendar: CalendarMonth[];
  bestMonth: CalendarMonth;
}

/**
 * Compatibility report v4, one prompt per generation step: 'plan' asks for
 * the insight plan; a list of sections asks for those sections of the report.
 * The section calls run in parallel and all see the same facts and insights.
 */
export function buildCompatibilityPromptV4(
  step: 'plan' | readonly V4SectionKey[],
  person1: CompatibilityPromptPerson,
  person2: CompatibilityPromptPerson,
  relationshipType: RelationshipType,
  scoreContext: CompatibilityScoreContext,
  facts: V4ReportFacts,
  insights: Array<{ text: string; basis: string[]; chapter: string }> = [],
): string {
  const who = (w: 'reader' | 'partner') => (w === 'reader' ? 'คุณ' : person2.name);
  const future = V4_FUTURE_BY_RELATIONSHIP[relationshipType];
  return renderPrompt(step === 'plan' ? V4_PLAN_TEMPLATE : v4WriteTemplate(step), {
    ...compatibilityDataVars(person1, person2, relationshipType, scoreContext),
    ...partnerContextVars(person1, person2),
    score: facts.score,
    archetypeName: facts.archetype.name,
    archetypeTagline: facts.archetype.tagline,
    dayRelationTh: BRANCH_RELATION_TH[facts.inputs.dayRelation],
    dayNeutral: facts.inputs.dayRelation === 'neutral',
    leadSignals: leadSignalsTh(person1, person2, facts.inputs),
    yearRelationTh: YEAR_RELATION_TH[facts.inputs.yearRelation],
    elementRelationTh: elementRelationTh(person1, person2),
    stemCombine: facts.inputs.stemCombine,
    dimensionList: facts.dimensions
      // The level only. With the number here, all 40 dimension lines in the round-4 samples repeated it
      // ("เคมีอยู่ที่ 57 จาก 100") and insights quoted it; the bar already shows it.
      .map((d) => `  - ${d.key} ${d.label}: ระดับ${band(d.score)} คำนวณจาก ${d.basis.map((b) => DIMENSION_INPUT_TH[b]).join(' และ ')}`)
      .join('\n'),
    calendarList: facts.calendar
      .map((m, i) => {
        const reasons = m.reasons.map((r) => MONTH_REASON_TH[r.relation](who(r.who))).join(' และ ');
        return `  - month${i + 1} ${m.month} (${thaiMonth(m.month)}): ${MONTH_LABEL_TH[m.label]}${reasons ? ` เพราะ ${reasons}` : ' ธาตุและนักษัตรประจำเดือนเป็นกลางกับทั้งสองคน'}`;
      })
      .join('\n'),
    nextStepKind: future.nextStep,
    bestMonthKey: facts.bestMonth.month,
    bestMonthTh: thaiMonth(facts.bestMonth.month),
    futureTitle: future.title,
    insightList: insights.map((i, n) => `  ${n + 1}. [${i.chapter}] ${i.text} (อ้างอิง ${i.basis.join(', ')})`).join('\n'),
  });
}

/**
 * Build structured chart prompt for the redesigned dashboard.
 * Implements the 2-step architecture:
 * - Step 1 data (deterministic) is embedded as JSON in the prompt
 * - Step 2 (creative) asks the LLM to synthesize readings in structured JSON
 */
export function buildStructuredChartPrompt(
  name: string,
  birthDate: Date,
  enrichedPillars: {
    year: EnrichedPillar;
    month: EnrichedPillar;
    day: EnrichedPillar;
    hour?: EnrichedPillar;
  },
  elementProfile: ElementProfile,
  pillarInteractions: PillarInteraction[],
  thaiAstrology: ThaiAstrology,
  currentAge: string,
  mbtiType?: string | null,
  /**
   * Deterministic 0-100 category scores (calculateChartCategoryScores). Passed
   * in so the model narrates to the number instead of inventing its own.
   */
  categoryScores?: Record<FortuneCategoryKey, number>,
  /**
   * The month this narrative is written for (getReadingPeriod), plus today's
   * date. A model has no clock, so without these it lands its month references
   * on arbitrary months and the chart reads as stale the day it is generated.
   */
  readingPeriod?: { yearMonth: string; monthTh: string; yearBe: number },
  today: Date = new Date(),
): string {
  const birthDateStr = birthDate.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const deterministicData = {
    name,
    birthDate: birthDateStr,
    currentAge,
    pillars: enrichedPillars,
    elementProfile,
    pillarInteractions,
    thaiAstrology,
  };

  const period = readingPeriod ?? getReadingPeriod();
  const todayTh = `${today.getDate()} ${THAI_MONTHS_FULL[today.getMonth()]} ${toBuddhistYear(today.getFullYear())}`;

  return renderPrompt(chartMd, {
    readingMonthTh: period.monthTh,
    readingYearBe: period.yearBe,
    readingYearMonth: period.yearMonth,
    todayTh,
    mbti: Boolean(mbtiType),
    mbtiType: mbtiType ?? '',
    // Compact JSON: pretty-print whitespace only inflates the token bill.
    deterministicJson: JSON.stringify(deterministicData),
    mbtiContext: buildMbtiContext(mbtiType),
    name,
    lifeOverviewScoreValue: categoryScores?.life_overview ?? '',
    loveScoreValue: categoryScores?.love ?? '',
    careerScoreValue: categoryScores?.career ?? '',
    financeScoreValue: categoryScores?.finance ?? '',
    healthScoreValue: categoryScores?.health ?? '',
    familyScoreValue: categoryScores?.family ?? '',
  });
}
