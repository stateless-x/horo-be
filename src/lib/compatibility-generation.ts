import { calculateBazi, calculateThaiAstrology, calculateCompatibility } from '../../lib/astrology';
import { z } from 'zod';
import {
  CompatibilityStructuredContentSchema,
  CompatibilityV3ContentSchema,
  GenderSchema,
  TOKEN_LIMITS,
  type CompatibilityStructuredContent,
  type CompatibilityV3Content,
  type Gender,
  type MbtiType,
  type RelationshipType,
} from '../../lib/shared';
import { buildCompatibilityPrompt, buildCompatibilityPromptV3 } from './prompts';
import {
  generateStructuredCompatibilityReading,
  generateStructuredCompatibilityReadingV3,
  type OnModelCall,
} from './llm';
import { elementCreditedToPlanet, foreignElementWords, mapStrings, tightenNameSpacing } from './compatibility-text';

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

export function buildCompatibilityPromptFor(
  version: 'v2' | 'v3',
  reader: CompatibilityReaderInput,
  partner: CompatibilityPartnerInput,
  relationshipType: RelationshipType,
  charts: CompatibilityCharts,
): string {
  const person1 = {
    name: 'เจ้า',
    gender: reader.gender,
    birthDate: reader.birthDate,
    baziChart: charts.readerBazi,
    thaiAstrology: charts.readerThai,
    mbtiType: reader.mbtiType,
  };
  const person2 = {
    name: partner.name,
    birthDate: partner.birthDate,
    baziChart: charts.partnerBazi,
    thaiAstrology: charts.partnerThai,
    mbtiType: partner.mbtiType,
  };
  const scoreContext = {
    score: charts.score.score,
    scoreExplanation: charts.score.overallAnalysis,
    strengths: charts.score.strengths,
    challenges: charts.score.challenges,
  };
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
