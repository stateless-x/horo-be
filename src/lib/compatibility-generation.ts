import { calculateBazi, calculateThaiAstrology, calculateCompatibility } from '../../lib/astrology';
import {
  CompatibilityStructuredContentSchema,
  CompatibilityV3ContentSchema,
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
  gender: Gender;
  mbtiType: MbtiType | null;
}

export interface CompatibilityPartnerInput {
  name: string;
  birthDate: Date;
  mbtiType: MbtiType | null;
}

export function calculateCompatibilityCharts(reader: CompatibilityReaderInput, partner: CompatibilityPartnerInput) {
  const readerBazi = calculateBazi(reader.birthDate, reader.birthHour, reader.gender);
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
    : buildCompatibilityPromptV3({ ...person1, gender: reader.gender }, person2, relationshipType, scoreContext);
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
    ...generated,
  });
  return {
    content,
    charts,
    prompt,
    timings: { calcMs: Math.round(llmStart - calcStart), llmMs: Math.round(llmEnd - llmStart) },
  };
}

export async function generateCompatibilityV3(
  input: GenerateCompatibilityInput,
): Promise<CompatibilityGeneration<CompatibilityV3Content>> {
  const calcStart = performance.now();
  const charts = calculateCompatibilityCharts(input.reader, input.partner);
  const prompt = buildCompatibilityPromptFor('v3', input.reader, input.partner, input.relationshipType, charts);
  const llmStart = performance.now();
  const generated = await generateStructuredCompatibilityReadingV3(prompt, input.onModelCall);
  const llmEnd = performance.now();
  const content = CompatibilityV3ContentSchema.parse({
    contentVersion: 3,
    scoreExplanation: charts.score.overallAnalysis,
    ...generated,
  });
  return {
    content,
    charts,
    prompt,
    timings: { calcMs: Math.round(llmStart - calcStart), llmMs: Math.round(llmEnd - llmStart) },
  };
}
