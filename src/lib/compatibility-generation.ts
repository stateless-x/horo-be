import {
  bestMonth,
  calculateBazi,
  calculateThaiAstrology,
  calculateCompatibility,
  calculateDimensions,
  DIMENSION_LABELS,
  pairInputs,
  relationshipCalendar,
  selectArchetype,
} from '../../lib/astrology';
import { z } from 'zod';
import {
  CompatibilityStructuredContentSchema,
  CompatibilityV3ContentSchema,
  GenderSchema,
  TOKEN_LIMITS,
  type CompatibilityStructuredContent,
  type CompatibilityV3Content,
  type CompatibilityV4Content,
  CompatibilityV4ContentSchema,
  duplicateInsights,
  type Element,
  type Gender,
  V4AllSectionsSchema,
  V4_CHAPTER_KEYS,
  type V4ChapterKey,
  type V4SectionKey,
  type V4Sections,
  type V4InsightPlan,
  type V4MonthLabel,
  type MbtiType,
  type RelationshipType,
} from '../../lib/shared';
import { buildCompatibilityPrompt, buildCompatibilityPromptV3, buildCompatibilityPromptV4, V4_FUTURE_BY_RELATIONSHIP } from './prompts';
import {
  generateStructuredCompatibilityReading,
  generateStructuredCompatibilityReadingV3,
  generateCompatibilityV4Plan,
  generateCompatibilityV4Sections,
  V4_SPLIT,
  type OnModelCall,
} from './llm';
import {
  birthDataInventory,
  chartSilence,
  elementCreditedToPlanet,
  elementsNamed,
  fixKnownTypos,
  foreignElementWords,
  guessesPartnerView,
  mapStrings,
  mixesPronouns,
  stockLine,
  stringLeaves,
  thaiWordCount,
  tightenNameSpacing,
  wrongGenderWords,
} from './compatibility-text';

/**
 * Compatibility generation from birth data alone: deterministic charts and
 * score, the prompt, and the model call. No database, cache or rate limit, so
 * the v3 prototype and the dev generator tool can run it statelessly.
 *
 * The production POST route still does its own v2 calculation inline and is
 * expected to switch to this function when v3 ships; until then the v2 path
 * here mirrors the route exactly (reader named 'เจ้า', partner charted with no
 * hour and gender 'female', TOKEN_LIMITS per relationship type).
 */

export interface CompatibilityReaderInput {
  birthDate: Date;
  birthHour?: number;
  /** null when unknown: the prompt then asks for gender-neutral wording. */
  gender: Gender | null;
  mbtiType: MbtiType | null;
}

/** A profile's stored gender as the prompt understands it; anything unrecognised is unknown. */
export function readerGender(raw: string | null | undefined): Gender | null {
  const parsed = GenderSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface CompatibilityPartnerInput {
  name: string;
  birthDate: Date;
  mbtiType: MbtiType | null;
}

export function calculateCompatibilityCharts(reader: CompatibilityReaderInput, partner: CompatibilityPartnerInput) {
  const readerBazi = calculateBazi(reader.birthDate, reader.birthHour, reader.gender ?? undefined);
  const readerThai = calculateThaiAstrology(reader.birthDate);
  // Mirrors the route: the partner form has no hour or gender.
  const partnerBazi = calculateBazi(partner.birthDate, undefined, 'female');
  const partnerThai = calculateThaiAstrology(partner.birthDate);
  const score = calculateCompatibility(readerBazi, partnerBazi);
  return { readerBazi, readerThai, partnerBazi, partnerThai, score };
}

export type CompatibilityCharts = ReturnType<typeof calculateCompatibilityCharts>;

function promptPeople(reader: CompatibilityReaderInput, partner: CompatibilityPartnerInput, charts: CompatibilityCharts) {
  return {
    person1: {
      name: 'เจ้า',
      gender: reader.gender,
      birthDate: reader.birthDate,
      baziChart: charts.readerBazi,
      thaiAstrology: charts.readerThai,
      mbtiType: reader.mbtiType,
    },
    person2: {
      name: partner.name,
      birthDate: partner.birthDate,
      baziChart: charts.partnerBazi,
      thaiAstrology: charts.partnerThai,
      mbtiType: partner.mbtiType,
    },
    scoreContext: {
      score: charts.score.score,
      scoreExplanation: charts.score.overallAnalysis,
      strengths: charts.score.strengths,
      challenges: charts.score.challenges,
    },
  };
}

export function buildCompatibilityPromptFor(
  version: 'v2' | 'v3',
  reader: CompatibilityReaderInput,
  partner: CompatibilityPartnerInput,
  relationshipType: RelationshipType,
  charts: CompatibilityCharts,
): string {
  const { person1, person2, scoreContext } = promptPeople(reader, partner, charts);
  return version === 'v2'
    ? buildCompatibilityPrompt(person1, person2, relationshipType, scoreContext)
    : buildCompatibilityPromptV3(person1, person2, relationshipType, scoreContext);
}

interface GenerateCompatibilityInput {
  reader: CompatibilityReaderInput;
  partner: CompatibilityPartnerInput;
  relationshipType: RelationshipType;
  onModelCall?: OnModelCall;
}

interface CompatibilityGeneration<TContent> {
  content: TContent;
  charts: CompatibilityCharts;
  prompt: string;
  timings: { calcMs: number; llmMs: number };
}

export async function generateCompatibilityV2(
  input: GenerateCompatibilityInput,
): Promise<CompatibilityGeneration<CompatibilityStructuredContent>> {
  const calcStart = performance.now();
  const charts = calculateCompatibilityCharts(input.reader, input.partner);
  const prompt = buildCompatibilityPromptFor('v2', input.reader, input.partner, input.relationshipType, charts);
  const llmStart = performance.now();
  const generated = await generateStructuredCompatibilityReading(
    prompt,
    TOKEN_LIMITS[input.relationshipType],
    input.onModelCall,
  );
  const llmEnd = performance.now();
  const content = CompatibilityStructuredContentSchema.parse({
    contentVersion: 2,
    scoreExplanation: charts.score.overallAnalysis,
    ...mapStrings(generated, (text) => tightenNameSpacing(text, input.partner.name)),
  });
  return {
    content,
    charts,
    prompt,
    timings: { calcMs: Math.round(llmStart - calcStart), llmMs: Math.round(llmEnd - llmStart) },
  };
}

/**
 * The free verdict and hook, and the dynamic paragraph, may only name the two
 * people's own elements, and may not credit an element to a Thai planet. The
 * model once wrote "ดินเจอกับไฟ" for a pair who are both earth, and "ไฟจาก
 * ดาวอังคาร" when the fire came from Bazi. A failure triggers the repair turn.
 */
function elementCheck(allowed: CompatibilityCharts['readerBazi']['element'][]) {
  type Checked = { teaser: { verdict: string; hook: string }; detail: { dynamic: string } };
  const fields: Array<[path: string[], read: (content: Checked) => string]> = [
    [['teaser', 'verdict'], (content) => content.teaser.verdict],
    [['teaser', 'hook'], (content) => content.teaser.hook],
    [['detail', 'dynamic'], (content) => content.detail.dynamic],
  ];
  return (content: Checked, ctx: z.RefinementCtx) => {
    for (const [path, read] of fields) {
      const text = read(content);
      const foreign = foreignElementWords(text, allowed);
      if (foreign.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `Names element ${foreign.join(', ')}, but this pair's elements are only those given in the data`,
        });
      }
      const credited = elementCreditedToPlanet(text);
      if (credited) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `"${credited}" credits an element to a planet; elements come from Bazi, planets from Thai astrology`,
        });
      }
    }
  };
}

export async function generateCompatibilityV3(
  input: GenerateCompatibilityInput,
): Promise<CompatibilityGeneration<CompatibilityV3Content>> {
  const calcStart = performance.now();
  const charts = calculateCompatibilityCharts(input.reader, input.partner);
  const prompt = buildCompatibilityPromptFor('v3', input.reader, input.partner, input.relationshipType, charts);
  const llmStart = performance.now();
  const generated = await generateStructuredCompatibilityReadingV3(
    prompt,
    input.onModelCall,
    elementCheck([charts.readerBazi.element, charts.partnerBazi.element]),
  );
  const llmEnd = performance.now();
  const content = CompatibilityV3ContentSchema.parse({
    contentVersion: 3,
    scoreExplanation: charts.score.overallAnalysis,
    ...mapStrings(generated, (text) => tightenNameSpacing(text, input.partner.name)),
  });
  return {
    content,
    charts,
    prompt,
    timings: { calcMs: Math.round(llmStart - calcStart), llmMs: Math.round(llmEnd - llmStart) },
  };
}

// ---------------------------------------------------------------- v4 report

const CHAPTER_TITLES = (partnerName: string, relationshipType: RelationshipType): Record<V4ChapterKey, string> => ({
  attraction: 'แรงดึงดูด',
  partner: `ตัวตนของ${partnerName}ในความสัมพันธ์นี้`,
  you: 'ตัวคุณในความสัมพันธ์นี้',
  communication: 'การสื่อสาร',
  friction: 'จุดเสียดทานและวิธีคืนดี',
  future: V4_FUTURE_BY_RELATIONSHIP[relationshipType].title,
});

const DETAIL_WORDS = { min: 100, max: 300 };
/** Openings and over-claims that fit any pair ("บทเรียนลึกที่สุดที่คุณเคยเจอ"), all from the samples. */
const GENERIC_VERDICT = /^(?:ดวงคู่นี้|คู่นี้|ความสัมพันธ์นี้)\s*(?:ไปได้|ไปด้วยกันได้|มีพื้นฐาน|เข้ากันได้)|ที่สุดที่คุณเคย/;
/** Words that tie a verdict to the pair's chart when the palace or year relation is not neutral. */
const RELATION_TERMS = /นักษัตร|ตำแหน่งคู่|ประสาน|ปะทะ|ชง|บั่นทอน/;
const SPOUSE_PALACE = /ตำแหน่งคู่|นักษัตรวันเกิด/;
/** A hint that tells the reader what to try has given the chapter's answer away. */
const HINT_GIVES_ANSWER = /ลอง(?!ผิด|ถูก)/;
const LABEL_CONTRADICTION: Record<V4MonthLabel, RegExp | null> = {
  good: /ระวัง|ไม่ดี|ไม่เหมาะ/,
  mixed: null,
  caution: /เดือนดี|ดีมาก|ราบรื่น/,
};

type Issue = [path: string, message: string];

/**
 * Where a wrong element is a hard failure: the verdict, the overview story
 * and the attraction chapter state the pair's astrology outright. Elsewhere
 * a slip is often a metaphor, so it costs a repair and a flag instead.
 */
const ELEMENT_CORE = /^cover\.verdict$|^overview\.story$|^attraction\./;
const ELEMENT_ISSUE = 'Names element';
/** What every buyer reads first; saying the chart is silent there fails the reading. */
const HEADLINE = /^cover\.verdict$|^overview\.|^attraction\./;

/**
 * Rules every prose field must pass: correct elements, nothing credited to a
 * planet, the reader's gender, and no silent-chart claim in the headline fields.
 */
function factIssues(entries: Array<[string, string]>, allowedFor: (path: string) => Element[], gender: Gender | null): Issue[] {
  const issues: Issue[] = [];
  for (const [path, text] of entries) {
    const silent = HEADLINE.test(path) ? chartSilence(text) : null;
    if (silent) issues.push([path, `"${silent}" says the chart is silent; lead with the pair's first signal instead`]);
    const foreign = foreignElementWords(text, allowedFor(path));
    if (foreign.length) issues.push([path, `Names element ${foreign.join(', ')}, which neither person has`]);
    const credited = elementCreditedToPlanet(text);
    if (credited) issues.push([path, `"${credited}" credits an element to a planet; elements come from Bazi, planets from Thai astrology`]);
    const wrong = wrongGenderWords(text, gender);
    if (wrong.length) issues.push([path, `Uses ${wrong.join(', ')}, which does not match the reader's gender`]);
  }
  return issues;
}

/** Quality rules worth one repair: see generateValidatedCompatibilityJson's softCheck. */
function qualityIssues(entries: Array<[string, string]>, partnerName: string): string[] {
  const issues: string[] = [];
  const personal = new RegExp(`${partnerName}|${Object.values(DIMENSION_LABELS).join('|')}`);
  for (const [path, text] of entries) {
    const inventory = birthDataInventory(text);
    if (inventory) issues.push(`${path}: lists birth data in one breath ("${inventory.slice(0, 40)}"); mention one data point per sentence, only as a reason`);
    const guess = guessesPartnerView(text, partnerName);
    if (guess) issues.push(`${path}: "${guess}" says how ${partnerName} reads you; describe what ${partnerName} tends to do or need instead`);
    const stock = stockLine(text);
    if (stock) issues.push(`${path}: "${stock}" is stock advice that fits anyone; make it specific to this pair`);
    if (path.endsWith('.detail')) {
      const words = thaiWordCount(text);
      if (words < DETAIL_WORDS.min) issues.push(`${path}: ${words} words; write about 120 to 220`);
      if (words > DETAIL_WORDS.max) issues.push(`${path}: ${words} words; keep it to about 220`);
    }
    if (/\.move$|^plan\.\d+\.action$/.test(path) && !personal.test(text)) {
      issues.push(`${path}: names nothing specific to this pair; tie it to ${partnerName} or one of the scores`);
    }
    if (/\.lines\.\d+$|\.repair$|conversationStarter$/.test(path) && mixesPronouns(text)) {
      issues.push(`${path}: mixes เรา with หนู or ดิฉัน in one line; pick one`);
    }
  }
  return issues;
}

/**
 * The verdict must name the partner and hold one concrete from this pair's
 * chart: one of their elements, or, when the palace or year relation is not
 * neutral, that relation. A behaviour from the insight plan can't be told
 * from a generic line by word overlap (tested on 20 sample verdicts), so it
 * does not count on its own.
 */
export function verdictIssues(verdict: string, partnerName: string, pairElements: Element[], anchorsOnRelations: boolean): string[] {
  const issues: string[] = [];
  if (!verdict.includes(partnerName)) issues.push(`cover.verdict: name ${partnerName} and this pair's specific tension or gift`);
  const anchored =
    elementsNamed(verdict).some((element) => pairElements.includes(element)) || (anchorsOnRelations && RELATION_TERMS.test(verdict));
  if (!anchored) issues.push("cover.verdict: fits any pair; open with the pair's first signal as a concrete image");
  if (GENERIC_VERDICT.test(verdict)) issues.push('cover.verdict: a line that fits any pair or over-claims; say what is specific to this pair');
  return issues;
}

export interface CompatibilityV4Generation {
  content: CompatibilityV4Content;
  charts: CompatibilityCharts;
  prompt: string;
  timings: { calcMs: number; llmMs: number; planMs: number; partsMs: number };
  /** Quality rules still failing after each call's one repair turn. */
  qualityFlags: string[];
}

/**
 * Compatibility report v4. The facts (dimension scores, archetype, month
 * labels) are computed first. Then one short call plans 6 to 8 distinct
 * insights, and the section calls in V4_SPLIT write the report in parallel
 * from the same facts and insights. The insight plan is what keeps the parts
 * consistent: the cover's hints and every chapter draw on the same list.
 */
export async function generateCompatibilityV4(
  input: GenerateCompatibilityInput & { now?: Date },
): Promise<CompatibilityV4Generation> {
  const now = input.now ?? new Date();
  const calcStart = performance.now();
  const charts = calculateCompatibilityCharts(input.reader, input.partner);
  const inputs = pairInputs(charts.readerBazi, charts.partnerBazi, input.reader.mbtiType, input.partner.mbtiType);
  const calendar = relationshipCalendar(charts.readerBazi, charts.partnerBazi, now);
  const facts = {
    score: charts.score.score,
    inputs,
    dimensions: calculateDimensions(inputs),
    archetype: selectArchetype(charts.readerBazi.element, charts.partnerBazi.element),
    calendar,
    bestMonth: bestMonth(calendar),
  };
  const { person1, person2, scoreContext } = promptPeople(input.reader, input.partner, charts);
  const build = (step: 'plan' | readonly V4SectionKey[], insights?: V4InsightPlan['insights']) =>
    buildCompatibilityPromptV4(step, person1, person2, input.relationshipType, scoreContext, facts, insights);
  const partnerName = input.partner.name;
  const pairElements: Element[] = [charts.readerBazi.element, charts.partnerBazi.element];
  const anchorsOnRelations = inputs.dayRelation !== 'neutral' || inputs.yearRelation !== 'neutral';
  const gender = input.reader.gender;

  const planPrompt = build('plan');
  const llmStart = performance.now();
  const plan = await generateCompatibilityV4Plan(planPrompt, {
    onModelCall: input.onModelCall,
    pairCheck: (content, ctx) => {
      const unavailable = new Set<string>([
        ...(input.reader.mbtiType ? [] : ['readerMbti']),
        ...(input.partner.mbtiType ? [] : ['partnerMbti']),
        ...(inputs.stemCombine ? [] : ['stemCombine']),
      ]);
      content.insights.forEach((insight, i) => {
        const bad = insight.basis.filter((b) => unavailable.has(b));
        if (bad.length) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['insights', i, 'basis'], message: `${bad.join(', ')} is not in this pair's data` });
        }
      });
    },
  });
  const planEnd = performance.now();

  const toIssues = (issues: Issue[], ctx: z.RefinementCtx) => {
    for (const [path, message] of issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: path.split('.'), message });
  };
  const monthElement = (path: string) => calendar[Number(path.split('.')[1])].monthElement;
  const pairCheck = (content: Partial<V4Sections>, ctx: z.RefinementCtx) => {
    toIssues(
      factIssues(
        stringLeaves(content).filter(([path]) => !path.endsWith('.month')),
        (path) => (path.startsWith('calendar.') ? [...pairElements, monthElement(path)] : pairElements),
        gender,
      ).filter(([path, message]) => !message.startsWith(ELEMENT_ISSUE) || ELEMENT_CORE.test(path)),
      ctx,
    );
    content.calendar?.forEach((entry, i) => {
      if (entry.month !== calendar[i].month) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['calendar', i, 'month'], message: `must be ${calendar[i].month}` });
      }
    });
    if (content.future && content.future.nextStep.month !== facts.bestMonth.month) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['future', 'nextStep', 'month'], message: `must be ${facts.bestMonth.month}` });
    }
    for (const dim of content.overview ? facts.dimensions : []) {
      const line = content.overview!.dimensionLines[dim.key];
      const path = ['overview', 'dimensionLines', dim.key];
      if (!dim.basis.includes('mbti') && /MBTI|[IE][NS][TF][JP]/.test(line)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: 'mentions MBTI, but this score was not computed from MBTI' });
      }
      if ((dim.score < 45 && /เด่น|สูงมาก|ดีมาก/.test(line)) || (dim.score >= 75 && /ต่ำ|อ่อนแอ|น่าห่วง/.test(line))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `contradicts the score ${dim.score}` });
      }
      if (/[0-9๐-๙]/.test(line)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: 'has a number; the bar shows the score, explain the level in words' });
      }
    }
  };
  const softCheck = (content: Partial<V4Sections>) => {
    const issues = qualityIssues(stringLeaves(content), partnerName);
    // Element slips outside the core fields: often a metaphor, worth a repair, not a failed reading.
    for (const [path, message] of factIssues(
      stringLeaves(content).filter(([p]) => !p.endsWith('.month') && !ELEMENT_CORE.test(p)),
      (p) => (p.startsWith('calendar.') ? [...pairElements, monthElement(p)] : pairElements),
      gender,
    )) {
      if (message.startsWith(ELEMENT_ISSUE)) issues.push(`${path}: ${message}`);
    }
    if (content.cover) issues.push(...verdictIssues(content.cover.verdict, partnerName, pairElements, anchorsOnRelations));
    content.calendar?.forEach((entry, i) => {
      // Soft: a regex can't tell "เดือนดี" from "ยังไม่ใช่เดือนดี", and the label itself is shown from the computation.
      if (LABEL_CONTRADICTION[calendar[i].label]?.test(entry.text)) {
        issues.push(`calendar.${i}.text: reads against the computed label (${calendar[i].label}); explain that label`);
      }
    });
    content.cover?.lockedHints.forEach((hint, i) => {
      if (HINT_GIVES_ANSWER.test(hint.text)) {
        issues.push(`cover.lockedHints.${i}.text: already says what to do ("ลอง..."); tease the moment, keep the answer for the chapter`);
      }
    });
    if (content.attraction && !SPOUSE_PALACE.test(content.attraction.detail)) {
      issues.push('attraction.detail: give the astrological reason with ตำแหน่งคู่ในดวง or นักษัตรวันเกิด');
    }
    return issues;
  };

  const sectionPrompts = V4_SPLIT.map((sections) => build(sections, plan.data.insights));
  const parts = await Promise.all(
    V4_SPLIT.map((sections, i) =>
      generateCompatibilityV4Sections(sectionPrompts[i], sections, { onModelCall: input.onModelCall, pairCheck, softCheck }),
    ),
  );
  const llmEnd = performance.now();

  const sections = V4AllSectionsSchema.parse(Object.assign({}, ...parts.map((part) => part.data)));
  const titles = CHAPTER_TITLES(partnerName, input.relationshipType);
  const content = CompatibilityV4ContentSchema.parse(
    mapStrings(
      {
        contentVersion: 4,
        generatedOn: bangkokDate(now),
        archetype: facts.archetype,
        dimensions: facts.dimensions,
        cover: sections.cover,
        overview: sections.overview,
        chapters: V4_CHAPTER_KEYS.map((key) => ({ key, title: titles[key], ...sections[key] })),
        calendar: calendar.map((month, i) => ({ month: month.month, label: month.label, text: sections.calendar[i].text })),
        plan: sections.plan,
        insights: plan.data.insights,
      },
      (text) => fixKnownTypos(tightenNameSpacing(text, partnerName)),
    ),
  );
  return {
    content,
    charts,
    prompt: [planPrompt, ...sectionPrompts].join('\n\n==========\n\n'),
    timings: {
      calcMs: Math.round(llmStart - calcStart),
      llmMs: Math.round(llmEnd - llmStart),
      planMs: Math.round(planEnd - llmStart),
      partsMs: Math.round(llmEnd - planEnd),
    },
    qualityFlags: [
      ...duplicateInsights(plan.data.insights).map((key) => `insights: two insights cite the same data for ${key}`),
      ...(plan.data.insights.some((i) => i.chapter === 'attraction' && i.basis.includes('dayBranch'))
        ? []
        : ['insights: no attraction insight rests on the spouse palace (dayBranch)']),
      ...parts.flatMap((part) => part.softIssues),
    ],
  };
}

function bangkokDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
