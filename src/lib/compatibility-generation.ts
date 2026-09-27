import {
  bestMonth,
  calculateBazi,
  HEAVENLY_STEMS,
  spousePalace,
  calculateThaiAstrology,
  calculateCompatibility,
  calculateDimensions,
  DIMENSION_LABELS,
  pairInputs,
  relationshipCalendar,
  selectArchetype,
  normalizeMbtiType,
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
  CompatibilityV4StoredSchema,
  type CompatibilityV4Stored,
  duplicateInsights,
  foreignTokenIn,
  shapeCompatibilityView,
  type V4DetailPart,
  V4DetailPartSchema,
  type V4TeaserPart,
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
import {
  buildCompatibilityPrompt,
  buildCompatibilityPromptV3,
  buildCompatibilityPromptV4,
  buildV4HintRewritePrompt,
  V4_FUTURE_BY_RELATIONSHIP,
} from './prompts';
import {
  generateStructuredCompatibilityReading,
  generateStructuredCompatibilityReadingV3,
  generateCompatibilityV4Plan,
  generateCompatibilityV4Sections,
  rewriteV4Hints,
  V4_DETAIL_SPLIT,
  V4_TEASER_SECTIONS,
  type OnModelCall,
} from './llm';
import {
  birthDataInventory,
  chartSilence,
  elementCreditedToPlanet,
  elementsNamed,
  escapeRegExp,
  fixKnownTypos,
  foreignElementWords,
  guessesPartnerView,
  hintJargon,
  mapStrings,
  maskNames,
  NAME_MARK,
  mixesPronouns,
  proseLeaves,
  stockLine,
  stringLeaves,
  thaiWordCount,
  tightenNameSpacing,
  wrongGenderWords,
} from './compatibility-text';

/**
 * Compatibility generation from birth data alone: deterministic charts and
 * score, the prompt, and the model call. No database, cache or rate limit, so
 * the live route, the dev generator tool and the prototype harness all call
 * it. The live POST route generates v4 (generateCompatibilityV4 with
 * COMPATIBILITY_V4_LIVE_BUDGET); the v2 and v3 paths remain for the dev tools
 * (reader named 'เจ้า', partner charted with no hour and gender 'female').
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
    input.partner.name,
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
 * Every prose field is Thai (MBTI codes aside). `view` is the reading with the
 * partner's name masked (maskNames), so a partner called Mind or A+ is not
 * English. The model drops stray foreign words into long Thai output; one
 * costs a repair.
 */
export function foreignTextIssues(view: unknown, ctx: z.RefinementCtx): void {
  for (const [path, text] of proseLeaves(view)) {
    const token = foreignTokenIn(text);
    if (token) ctx.addIssue({ code: z.ZodIssueCode.custom, path: path.split('.'), message: `Non-Thai text in prose: "${token}"` });
  }
}

/**
 * The free verdict and hook, and the dynamic paragraph, may only name the two
 * people's own elements, and may not credit an element to a Thai planet. The
 * model once wrote "ดินเจอกับไฟ" for a pair who are both earth, and "ไฟจาก
 * ดาวอังคาร" when the fire came from Bazi. A failure triggers the repair turn.
 */
function elementCheck(allowed: CompatibilityCharts['readerBazi']['element'][], partnerName: string) {
  type Checked = { teaser: { verdict: string; hook: string }; detail: { dynamic: string } };
  const fields: Array<[path: string[], read: (content: Checked) => string]> = [
    [['teaser', 'verdict'], (content) => content.teaser.verdict],
    [['teaser', 'hook'], (content) => content.teaser.hook],
    [['detail', 'dynamic'], (content) => content.detail.dynamic],
  ];
  return (content: Checked, ctx: z.RefinementCtx) => {
    const view = maskNames(content, partnerName);
    foreignTextIssues(view, ctx);
    for (const [path, read] of fields) {
      const text = read(view);
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
    elementCheck([charts.readerBazi.element, charts.partnerBazi.element], input.partner.name),
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
 * `entries` come from the masked view (maskNames), like every rule's input.
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

/**
 * Quality rules worth one repair: see generateValidatedCompatibilityJson's
 * softCheck. `entries` come from the masked view, where the partner is
 * NAME_MARK; `partnerName` is only for the messages.
 */
function qualityIssues(entries: Array<[string, string]>, partnerName: string): string[] {
  const issues: string[] = [];
  const personal = new RegExp(`${escapeRegExp(NAME_MARK)}|${Object.values(DIMENSION_LABELS).join('|')}`);
  for (const [path, text] of entries) {
    const inventory = birthDataInventory(text);
    if (inventory) issues.push(`${path}: lists birth data in one breath ("${inventory.slice(0, 40)}"); mention one data point per sentence, only as a reason`);
    const guess = guessesPartnerView(text, NAME_MARK);
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
 * does not count on its own. `verdict` is from the masked view, where the
 * partner is NAME_MARK; `partnerName` is only for the messages.
 */
export function verdictIssues(verdict: string, partnerName: string, pairElements: Element[], anchorsOnRelations: boolean): string[] {
  const issues: string[] = [];
  if (!verdict.includes(NAME_MARK)) issues.push(`cover.verdict: name ${partnerName} and this pair's specific tension or gift`);
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

type V4Input = GenerateCompatibilityInput & {
  now?: Date;
  /** Repair turns per call for rule failures; the live route passes 1. Default 2. */
  maxRepairs?: number;
  /** Epoch ms by which every model call must have finished (the live route's budget). */
  deadlineAt?: number;
};

/**
 * What the plan call and every section call share: the computed facts (dimension
 * scores, archetype, month labels), the prompt builder, and the pair and quality
 * checks. All deterministic from the inputs and `now`.
 */
function v4Context(input: V4Input) {
  const now = input.now ?? new Date();
  const budget = { maxRepairs: input.maxRepairs, deadlineAt: input.deadlineAt };
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

  const toIssues = (issues: Issue[], ctx: z.RefinementCtx) => {
    for (const [path, message] of issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: path.split('.'), message });
  };
  const monthElement = (path: string) => calendar[Number(path.split('.')[1])].monthElement;
  // Every prose rule reads `view`, the reply with the partner's name masked
  // once here (maskNames). Only the month keys are checked on the reply itself.
  const pairCheck = (content: Partial<V4Sections>, ctx: z.RefinementCtx) => {
    const view = maskNames(content, partnerName);
    foreignTextIssues(view, ctx);
    toIssues(
      factIssues(
        stringLeaves(view).filter(([path]) => !path.endsWith('.month')),
        (path) => (path.startsWith('calendar.') ? [...pairElements, monthElement(path)] : pairElements),
        gender,
      ).filter(([path, message]) => !message.startsWith(ELEMENT_ISSUE) || ELEMENT_CORE.test(path)),
      ctx,
    );
    // A locked hint sells a moment, not a spec. Checked here rather than in the
    // schema because a partner is often called ดาว, which is also the word for a planet.
    view.cover?.lockedHints.forEach((hint, i) => {
      const jargon = hintJargon(hint.text);
      if (jargon) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cover', 'lockedHints', i, 'text'],
          message: `"${jargon}" is an astrology or MBTI term; a locked hint names a moment with this person in plain words`,
        });
      }
    });
    content.calendar?.forEach((entry, i) => {
      if (entry.month !== calendar[i].month) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['calendar', i, 'month'], message: `must be ${calendar[i].month}` });
      }
    });
    if (content.future && content.future.nextStep.month !== facts.bestMonth.month) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['future', 'nextStep', 'month'], message: `must be ${facts.bestMonth.month}` });
    }
    for (const dim of view.overview ? facts.dimensions : []) {
      const line = view.overview!.dimensionLines[dim.key];
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
    const view = maskNames(content, partnerName);
    const issues = qualityIssues(stringLeaves(view), partnerName);
    // Element slips outside the core fields: often a metaphor, worth a repair, not a failed reading.
    for (const [path, message] of factIssues(
      stringLeaves(view).filter(([p]) => !p.endsWith('.month') && !ELEMENT_CORE.test(p)),
      (p) => (p.startsWith('calendar.') ? [...pairElements, monthElement(p)] : pairElements),
      gender,
    )) {
      if (message.startsWith(ELEMENT_ISSUE)) issues.push(`${path}: ${message}`);
    }
    if (view.cover) issues.push(...verdictIssues(view.cover.verdict, partnerName, pairElements, anchorsOnRelations));
    view.calendar?.forEach((entry, i) => {
      // Soft: a regex can't tell "เดือนดี" from "ยังไม่ใช่เดือนดี", and the label itself is shown from the computation.
      if (LABEL_CONTRADICTION[calendar[i].label]?.test(entry.text)) {
        issues.push(`calendar.${i}.text: reads against the computed label (${calendar[i].label}); explain that label`);
      }
    });
    view.cover?.lockedHints.forEach((hint, i) => {
      if (HINT_GIVES_ANSWER.test(hint.text)) {
        issues.push(`cover.lockedHints.${i}.text: already says what to do ("ลอง..."); tease the moment, keep the answer for the chapter`);
      }
    });
    if (view.attraction && !SPOUSE_PALACE.test(view.attraction.detail)) {
      issues.push('attraction.detail: give the astrological reason with ตำแหน่งคู่ในดวง or นักษัตรวันเกิด');
    }
    return issues;
  };

  /**
   * A cover whose only failures are locked hints over the cap: rewrite just
   * those hints in a small call, from the plan's insights for their chapters,
   * instead of spending the cover's one whole-reply repair. The patched cover
   * is validated again, so the cap and the pair check still hold. Null (the
   * whole repair runs) when anything else failed or the rewrite call failed.
   */
  const hintPatch = (insights: V4InsightPlan['insights']) => async (data: unknown, issues: z.ZodIssue[]) => {
    const overLong = issues.map((issue) =>
      issue.code === 'too_big' && issue.path.length === 4 && issue.path[0] === 'cover' && issue.path[1] === 'lockedHints' && issue.path[3] === 'text'
        ? Number(issue.path[2])
        : null,
    );
    if (overLong.length === 0 || overLong.includes(null)) return null;
    const reply = CoverReplySchema.safeParse(data);
    if (!reply.success) return null;
    const hints = reply.data.cover.lockedHints;
    const indexes = [...new Set(overLong.filter((i): i is number => i !== null))];
    const prompt = buildV4HintRewritePrompt(
      partnerName,
      V4_HINT_REWRITE_TARGET,
      indexes.map((i) => ({ text: hints[i].text, insights: insights.filter((x) => x.chapter === hints[i].chapter).map((x) => x.text) })),
    );
    let texts: string[];
    try {
      texts = await rewriteV4Hints(prompt, indexes.length, { onModelCall: input.onModelCall, deadlineAt: budget.deadlineAt });
    } catch (error) {
      console.warn('[compatibility v4] hint rewrite failed; the cover gets its whole repair', error);
      return null;
    }
    const lockedHints = hints.map((hint, i) => (indexes.includes(i) ? { ...hint, text: texts[indexes.indexOf(i)] } : hint));
    return { ...reply.data, cover: { ...reply.data.cover, lockedHints } };
  };

  /** The section calls for `split`, in parallel, from one insight plan. */
  const writeSections = async (split: ReadonlyArray<readonly V4SectionKey[]>, insights: V4InsightPlan['insights']) => {
    const prompts = split.map((sections) => build(sections, insights));
    const parts = await Promise.all(
      split.map((sections, i) =>
        generateCompatibilityV4Sections(prompts[i], sections, {
          onModelCall: input.onModelCall,
          pairCheck,
          softCheck,
          ...budget,
          patch: sections.includes('cover') ? hintPatch(insights) : undefined,
        }),
      ),
    );
    return {
      prompts,
      sections: Object.assign({}, ...parts.map((part) => part.data)) as Partial<V4Sections>,
      softIssues: parts.flatMap((part) => part.softIssues),
    };
  };

  /** Model text with the known typos fixed and the partner's name spaced (every stored string goes through it). */
  const polish = <T>(value: T): T => mapStrings(value, (text) => fixKnownTypos(tightenNameSpacing(text, partnerName)));

  const teaserPart = (sections: Partial<V4Sections>): V4TeaserPart =>
    polish({
      generatedOn: bangkokDate(now),
      archetype: facts.archetype,
      people: {
        reader: personFacts(charts.readerBazi, input.reader.mbtiType),
        partner: personFacts(charts.partnerBazi, input.partner.mbtiType),
      },
      dimensions: facts.dimensions,
      cover: V4AllSectionsSchema.pick({ cover: true }).parse(sections).cover,
    });

  const detailPart = (written: Partial<V4Sections>): V4DetailPart => {
    const sections = V4AllSectionsSchema.omit({ cover: true }).parse(written);
    const titles = CHAPTER_TITLES(partnerName, input.relationshipType);
    return polish({
      palace: { reader: palaceFacts(charts.readerBazi), partner: palaceFacts(charts.partnerBazi) },
      readingMinutes: readingMinutes(sections),
      overview: sections.overview,
      chapters: V4_CHAPTER_KEYS.map((key) => ({ key, title: titles[key], ...sections[key] })),
      calendar: calendar.map((month, i) => ({ month: month.month, label: month.label, text: sections.calendar[i].text })),
      plan: sections.plan,
    });
  };

  return { charts, inputs, build, budget, writeSections, polish, teaserPart, detailPart };
}

export interface CompatibilityV4StoredGeneration {
  stored: CompatibilityV4Stored;
  charts: CompatibilityCharts;
  prompt: string;
  timings: { calcMs: number; llmMs: number; planMs: number; partsMs: number };
  qualityFlags: string[];
}

/**
 * Compatibility report v4 in its stored two-part form. The facts are computed
 * first. Then one short call plans 6 to 8 distinct insights, and the section
 * calls write from the same facts and insights: the cover (the free teaser)
 * alone, or with the three detail calls in parallel when `withDetail`. The
 * insight plan is what keeps the parts consistent, including a detail written
 * later on unlock (generateCompatibilityV4Detail): the cover's hints and every
 * chapter draw on the same list.
 */
export async function generateCompatibilityV4Stored(input: V4Input & { withDetail: boolean }): Promise<CompatibilityV4StoredGeneration> {
  const calcStart = performance.now();
  const ctx = v4Context(input);
  const planPrompt = ctx.build('plan');
  const llmStart = performance.now();
  const plan = await generateCompatibilityV4Plan(planPrompt, {
    onModelCall: input.onModelCall,
    ...ctx.budget,
    // The plan is short (3 to 10 s measured); cap it so the sections keep most of the budget.
    deadlineAt: input.deadlineAt === undefined ? undefined : Math.min(input.deadlineAt, Date.now() + PLAN_BUDGET_MS),
    pairCheck: (content, refine) => {
      foreignTextIssues(maskNames(content, input.partner.name), refine);
      const unavailable = new Set<string>([
        ...(input.reader.mbtiType ? [] : ['readerMbti']),
        ...(input.partner.mbtiType ? [] : ['partnerMbti']),
        ...(ctx.inputs.stemCombine ? [] : ['stemCombine']),
      ]);
      content.insights.forEach((insight, i) => {
        const bad = insight.basis.filter((b) => unavailable.has(b));
        if (bad.length) {
          refine.addIssue({ code: z.ZodIssueCode.custom, path: ['insights', i, 'basis'], message: `${bad.join(', ')} is not in this pair's data` });
        }
      });
    },
  });
  const planEnd = performance.now();

  const written = await ctx.writeSections(input.withDetail ? [V4_TEASER_SECTIONS, ...V4_DETAIL_SPLIT] : [V4_TEASER_SECTIONS], plan.data.insights);
  const llmEnd = performance.now();

  const stored = CompatibilityV4StoredSchema.parse({
    contentVersion: 4,
    plan: ctx.polish(plan.data),
    inputs: {
      reader: {
        birthDate: input.reader.birthDate.toISOString(),
        birthHour: input.reader.birthHour ?? null,
        gender: input.reader.gender,
        mbti: input.reader.mbtiType,
      },
      partner: { birthDate: input.partner.birthDate.toISOString(), mbti: input.partner.mbtiType },
    },
    teaser: ctx.teaserPart(written.sections),
    detail: input.withDetail ? ctx.detailPart(written.sections) : null,
    ...(input.withDetail ? { detailGeneratedAt: new Date().toISOString() } : {}),
  });
  return {
    stored,
    charts: ctx.charts,
    prompt: [planPrompt, ...written.prompts].join('\n\n==========\n\n'),
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
      ...written.softIssues,
    ],
  };
}

/** The full v4 report in one go (the dev tools and the harness): generateCompatibilityV4Stored with the detail, assembled. */
export async function generateCompatibilityV4(input: V4Input): Promise<CompatibilityV4Generation> {
  const { stored, ...generation } = await generateCompatibilityV4Stored({ ...input, withDetail: true });
  return { ...generation, content: CompatibilityV4ContentSchema.parse(shapeCompatibilityView(stored, 'full')) };
}

/**
 * The paid detail of a locked report, written on unlock from the stored insight
 * plan. `now` is the day the teaser was written, so the calendar months and the
 * week plan match what the plan's month insights refer to.
 */
export async function generateCompatibilityV4Detail(
  stored: CompatibilityV4Stored,
  input: Omit<V4Input, 'now' | 'reader' | 'partner'> & { partner: Pick<CompatibilityPartnerInput, 'name'> },
): Promise<{ detail: V4DetailPart; qualityFlags: string[]; timings: { llmMs: number } }> {
  const ctx = v4Context({
    ...input,
    now: new Date(`${stored.teaser.generatedOn}T12:00:00+07:00`),
    reader: {
      birthDate: new Date(stored.inputs.reader.birthDate),
      birthHour: stored.inputs.reader.birthHour ?? undefined,
      gender: stored.inputs.reader.gender,
      mbtiType: normalizeMbtiType(stored.inputs.reader.mbti),
    },
    partner: {
      name: input.partner.name,
      birthDate: new Date(stored.inputs.partner.birthDate),
      mbtiType: normalizeMbtiType(stored.inputs.partner.mbti),
    },
  });
  const llmStart = performance.now();
  const written = await ctx.writeSections(V4_DETAIL_SPLIT, stored.plan.insights);
  return {
    detail: V4DetailPartSchema.parse(ctx.detailPart(written.sections)),
    qualityFlags: written.softIssues,
    timings: { llmMs: Math.round(performance.now() - llmStart) },
  };
}

const PLAN_BUDGET_MS = 75_000;

/** What a rewritten hint aims for: the p95 of the sample hints, well inside V4_HINT_MAX. */
const V4_HINT_REWRITE_TARGET = 130;

/** Just enough of a cover reply to patch its hints; everything else passes through untouched. */
const CoverReplySchema = z
  .object({
    cover: z
      .object({ lockedHints: z.array(z.object({ text: z.string(), chapter: z.string() }).passthrough()) })
      .passthrough(),
  })
  .passthrough();

/**
 * The live route's budget (docs/compatibility-response-fix.md, "v4 live
 * budget"): one repair per call, and every model call finished within
 * llmMs of the request starting, which keeps the synchronous response under
 * 240 s against the 255 s server idle and 270 s client timeouts.
 */
export const COMPATIBILITY_V4_LIVE_BUDGET = { maxRepairs: 1, llmMs: 220_000 } as const;

function personFacts(chart: CompatibilityCharts['readerBazi'], mbti: MbtiType | null | undefined) {
  const stem = HEAVENLY_STEMS.find((s) => s.enumKey === chart.dayMaster);
  if (!stem) throw new Error(`Unknown day master ${chart.dayMaster}`);
  return { element: chart.element, yinYang: stem.yinYang, mbti: mbti ?? null };
}

function palaceFacts(chart: CompatibilityCharts['readerBazi']) {
  const { naksat, animal, hidden } = spousePalace(chart);
  return { naksat, animal, hidden };
}

/** Thai reads at about 800 graphemes a minute; each part counts at least a minute, as the contents list shows it. */
const GRAPHEMES_PER_MINUTE = 800;
const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });
function readingMinutes(sections: Omit<V4Sections, 'cover'>): number {
  const parts = [
    stringLeaves(sections.overview),
    ...V4_CHAPTER_KEYS.map((key) => stringLeaves(sections[key])),
    stringLeaves(sections.calendar),
    stringLeaves(sections.plan),
  ];
  return parts.reduce((sum, leaves) => {
    const count = [...graphemes.segment(leaves.map(([, text]) => text).join('').replace(/\s+/g, ''))].length;
    return sum + Math.max(1, Math.round(count / GRAPHEMES_PER_MINUTE));
  }, 0);
}

function bangkokDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
