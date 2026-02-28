import { z } from 'zod';

// Chinese Five Elements
export const ElementSchema = z.enum(['wood', 'fire', 'earth', 'metal', 'water']);
export type Element = z.infer<typeof ElementSchema>;

// Heavenly Stems (天干)
export const HeavenlyStemSchema = z.enum([
  'jia', 'yi',    // Wood
  'bing', 'ding', // Fire
  'wu', 'ji',     // Earth
  'geng', 'xin',  // Metal
  'ren', 'gui'    // Water
]);
export type HeavenlyStem = z.infer<typeof HeavenlyStemSchema>;

// Earthly Branches (地支)
export const EarthlyBranchSchema = z.enum([
  'zi', 'chou', 'yin', 'mao', 'chen', 'si',
  'wu', 'wei', 'shen', 'you', 'xu', 'hai'
]);
export type EarthlyBranch = z.infer<typeof EarthlyBranchSchema>;

// Pillar (柱) - combination of Stem and Branch
export const PillarSchema = z.object({
  stem: HeavenlyStemSchema,
  branch: EarthlyBranchSchema,
});
export type Pillar = z.infer<typeof PillarSchema>;

// Four Pillars (四柱)
export const BaziChartSchema = z.object({
  yearPillar: PillarSchema,
  monthPillar: PillarSchema,
  dayPillar: PillarSchema,
  hourPillar: PillarSchema.optional(), // Optional if birth time unknown
  dayMaster: HeavenlyStemSchema, // Day Stem (日主)
  element: ElementSchema, // Primary element
});
export type BaziChart = z.infer<typeof BaziChartSchema>;

// Thai Astrology Day (วันเกิด)
export const ThaiDaySchema = z.enum([
  'sunday', 'monday', 'tuesday', 'wednesday_day',
  'wednesday_night', 'thursday', 'friday', 'saturday'
]);
export type ThaiDay = z.infer<typeof ThaiDaySchema>;

// Thai Astrology Result
export const ThaiAstrologySchema = z.object({
  day: ThaiDaySchema,
  color: z.string(),
  planet: z.string(),
  buddhaPosition: z.string(), // Buddha posture for birth day
  personality: z.string(),
  luckyNumber: z.number(),
  luckyDirection: z.string(),
});
export type ThaiAstrology = z.infer<typeof ThaiAstrologySchema>;

// ---- New types for dashboard redesign ----

// Enriched Pillar with full metadata (for Section 3: Four Pillars)
export const EnrichedPillarSchema = z.object({
  stem: HeavenlyStemSchema,
  branch: EarthlyBranchSchema,
  stemChinese: z.string(),
  stemPinyin: z.string(),
  stemElement: ElementSchema,
  stemYinYang: z.enum(['yin', 'yang']),
  branchChinese: z.string(),
  branchPinyin: z.string(),
  branchAnimal: z.string(),
  branchElement: ElementSchema,
  lifeArea: z.string(),
  lifeAreaDetail: z.string(),
});
export type EnrichedPillar = z.infer<typeof EnrichedPillarSchema>;

// Element Profile (for Section 2: Element Profile)
export const ElementProfileSchema = z.object({
  primaryElement: ElementSchema,
  corePersonality: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  compatibleElements: z.array(ElementSchema),
  conflictingElement: ElementSchema,
});
export type ElementProfile = z.infer<typeof ElementProfileSchema>;

// Pillar Interaction
export const PillarInteractionSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(['producing', 'controlling', 'weakening', 'overacting', 'same', 'neutral']),
  strength: z.enum(['strong', 'mild', 'weak']),
  description: z.string(),
});
export type PillarInteraction = z.infer<typeof PillarInteractionSchema>;

// Fortune category keys
export const FortuneCategoryKeySchema = z.enum([
  'life_overview', 'love', 'career', 'finance', 'health', 'family'
]);
export type FortuneCategoryKey = z.infer<typeof FortuneCategoryKeySchema>;

// Fortune reading per category (for Section 5)
export const FortuneReadingCategorySchema = z.object({
  key: FortuneCategoryKeySchema,
  score: z.number().min(1).max(5),
  reading: z.string(),
  tips: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type FortuneReadingCategory = z.infer<typeof FortuneReadingCategorySchema>;

// Monthly highlight (for Section 6: Recommendations)
export const MonthlyHighlightSchema = z.object({
  month: z.string(),
  rating: z.number().min(1).max(5),
  note: z.string(),
});
export type MonthlyHighlight = z.infer<typeof MonthlyHighlightSchema>;

// Recommendations (for Section 6)
export const RecommendationsSchema = z.object({
  luckyColors: z.array(z.string()),
  luckyNumbers: z.array(z.number()),
  luckyDirection: z.string(),
  luckyDay: z.string(),
  monthlyHighlights: z.array(MonthlyHighlightSchema),
  dos: z.array(z.string()),
  donts: z.array(z.string()),
});
export type Recommendations = z.infer<typeof RecommendationsSchema>;

// Pillar interpretation (LLM-generated per pillar)
export const PillarInterpretationSchema = z.object({
  pillarKey: z.enum(['year', 'month', 'day', 'hour']),
  interpretation: z.string(),
  pillarRelationships: z.string(),
});
export type PillarInterpretation = z.infer<typeof PillarInterpretationSchema>;

// Birth star detail (for Section 4)
export const BirthStarDetailSchema = z.object({
  planet: z.string(),
  planetDescription: z.string(),
  luckyColor: z.string(),
  luckyColorTooltip: z.string(),
  luckyNumber: z.number(),
  luckyNumberTooltip: z.string(),
  luckyDirection: z.string(),
  luckyDirectionTooltip: z.string(),
  luckyDay: z.string(),
  luckyDayTooltip: z.string(),
});
export type BirthStarDetail = z.infer<typeof BirthStarDetailSchema>;

// Full structured chart response (the new GET /fortune/chart shape)
export const StructuredChartResponseSchema = z.object({
  // Section 1: Hero
  personalityTraits: z.array(z.string()),
  birthDateFormatted: z.string(),
  currentAge: z.number(),

  // Section 2: Element Profile
  elementProfile: ElementProfileSchema,

  // Section 3: Four Pillars
  pillars: z.object({
    year: EnrichedPillarSchema,
    month: EnrichedPillarSchema,
    day: EnrichedPillarSchema,
    hour: EnrichedPillarSchema.optional(),
  }),
  pillarInterpretations: z.array(PillarInterpretationSchema),
  pillarInteractions: z.array(PillarInteractionSchema),

  // Section 4: Birth Star & Lucky Attributes
  birthStar: BirthStarDetailSchema,

  // Section 5: Fortune Readings (6 categories)
  fortuneReadings: z.array(FortuneReadingCategorySchema),

  // Section 6: Recommendations
  recommendations: RecommendationsSchema,
});
export type StructuredChartResponse = z.infer<typeof StructuredChartResponseSchema>;
