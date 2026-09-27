import { z } from 'zod';
import { thaiProse } from './compatibility-v3';

/**
 * Compatibility report (content v4): overview, then parts, then detail.
 *
 * The facts are computed in lib/astrology/compatibility-report.ts (four
 * dimension scores, the pair archetype, three month labels); the model writes
 * only the prose around them. What a reader sees is decided by
 * `shapeCompatibilityView` (compatibility-v3.ts): the teaser view is the cover
 * and the dimension scores, the full view is everything.
 */

export const V4_DIMENSION_KEYS = ['chemistry', 'communication', 'trust', 'rhythm'] as const;
export type V4DimensionKey = (typeof V4_DIMENSION_KEYS)[number];

export const V4_DIMENSION_INPUTS = ['dayBranch', 'yearBranch', 'element', 'stemCombine', 'mbti'] as const;

export const V4_CHAPTER_KEYS = ['attraction', 'partner', 'you', 'communication', 'friction', 'future'] as const;
export type V4ChapterKey = (typeof V4_CHAPTER_KEYS)[number];

/** Locked hints sell lived moments, which only these chapters answer. */
export const V4_HINT_CHAPTERS = ['partner', 'you', 'communication', 'friction'] as const;

export const V4_MONTH_LABELS = ['good', 'mixed', 'caution'] as const;
export type V4MonthLabel = (typeof V4_MONTH_LABELS)[number];

/** What an insight may rest on: computed inputs, either person's data, or a month. */
export const V4_INSIGHT_BASIS = [
  'dayBranch',
  'yearBranch',
  'element',
  'stemCombine',
  'readerMbti',
  'partnerMbti',
  'readerThaiDay',
  'partnerThaiDay',
  'relationship',
  'month1',
  'month2',
  'month3',
] as const;

/** Astrology vocabulary that turns a hint into a spec instead of a moment. */
const HINT_JARGON = /ธาตุ|ดาว|วันเกิด|ปาจื้อ|โหรา|เจ้าวัน|นักษัตร|MBTI|[IE][NS][TF][JP]/;

// ---------------------------------------------------------------- model output

const chapter = {
  summary: thaiProse(40, 320),
  /** One line that carries the chapter, set large as a pull quote. */
  pullQuote: thaiProse(15, 200),
  detail: thaiProse(350, 1600),
  move: thaiProse(20, 280),
};

const hint = z.object({
  text: thaiProse(20, 150).refine((value) => !HINT_JARGON.test(value), {
    message: 'A locked hint names a moment with this person in plain words, with no astrology or MBTI terms',
  }),
  chapter: z.enum(V4_HINT_CHAPTERS),
});

export const V4InsightPlanSchema = z.object({
  insights: z
    .array(
      z.object({
        text: thaiProse(20, 500),
        basis: z.array(z.enum(V4_INSIGHT_BASIS)).min(1).max(4),
        chapter: z.enum(V4_CHAPTER_KEYS),
      }),
    )
    .min(6)
    .max(8)
    .superRefine((insights, ctx) => {
      // Name the missing chapters: a repair told only "every chapter needs one" sent back the same plan.
      const missing = V4_CHAPTER_KEYS.filter((key) => !insights.some((i) => i.chapter === key));
      if (missing.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Every chapter needs at least one insight; add one for ${missing.join(', ')} (change a duplicate chapter or add an insight, 8 at most)`,
        });
      }
    }),
});
export type V4InsightPlan = z.infer<typeof V4InsightPlanSchema>;

/**
 * Insights that cite the identical data set for the same chapter: the plan
 * repeats itself. Reported, not rejected; the chapters still read from the list.
 */
export function duplicateInsights(insights: V4InsightPlan['insights']): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const insight of insights) {
    const key = `${insight.chapter}:${[...new Set(insight.basis)].sort().join('+')}`;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  return duplicates;
}

/**
 * One schema per report section. A generation call asks for a set of
 * sections (see V4_SPLIT in horo-be src/lib/llm.ts); the stored content is
 * assembled from all of them.
 */
export const V4SectionSchemas = {
  cover: z.object({
    verdict: thaiProse(20, 260),
    lockedHints: z
      .array(hint)
      .length(3)
      .refine((hints) => new Set(hints.map((h) => h.chapter)).size === 3, {
        message: 'Each locked hint must point to a different chapter',
      }),
  }),
  overview: z.object({
    story: thaiProse(300, 1500),
    dimensionLines: z.object({
      chemistry: thaiProse(30, 320),
      communication: thaiProse(30, 320),
      trust: thaiProse(30, 320),
      rhythm: thaiProse(30, 320),
    }),
  }),
  attraction: z.object(chapter),
  partner: z.object(chapter),
  you: z.object(chapter),
  communication: z.object({
    ...chapter,
    pairs: z.array(z.object({ do: thaiProse(15, 240), avoid: thaiProse(15, 220) })).length(3),
    lines: z.array(thaiProse(10, 240)).length(3),
  }),
  friction: z.object({
    ...chapter,
    scenarios: z
      .array(
        z.object({
          scenario: thaiProse(20, 260).refine((value) => value.startsWith('ถ้า'), {
            message: 'A friction scenario must start with ถ้า',
          }),
          repair: thaiProse(20, 340),
        }),
      )
      .min(2)
      .max(3),
  }),
  future: z.object({
    ...chapter,
    goSignals: z.array(thaiProse(10, 220)).min(2).max(3),
    slowSignals: z.array(thaiProse(10, 220)).min(2).max(3),
    nextStep: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), step: thaiProse(20, 480) }),
  }),
  calendar: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), text: thaiProse(40, 420) })).length(3),
  plan: z
    .array(
      z.object({
        day: z.number().int().min(1).max(7),
        action: thaiProse(15, 240),
        conversationStarter: thaiProse(10, 240),
        watchFor: thaiProse(15, 240),
      }),
    )
    .length(3)
    .refine((steps) => steps.every((step, i) => i === 0 || step.day > steps[i - 1].day), {
      message: 'The three plan steps must be on increasing days',
    }),
};
export type V4SectionKey = keyof typeof V4SectionSchemas;
export const V4AllSectionsSchema = z.object(V4SectionSchemas);
export type V4Sections = z.infer<typeof V4AllSectionsSchema>;

// ---------------------------------------------------------------- stored content

const ChapterSchema = z.object({
  key: z.enum(V4_CHAPTER_KEYS),
  title: z.string().min(1),
  summary: z.string().min(1),
  pullQuote: z.string().min(1),
  detail: z.string().min(1),
  move: z.string().min(1),
  pairs: z.array(z.object({ do: z.string(), avoid: z.string() })).optional(),
  lines: z.array(z.string()).optional(),
  scenarios: z.array(z.object({ scenario: z.string(), repair: z.string() })).optional(),
  goSignals: z.array(z.string()).optional(),
  slowSignals: z.array(z.string()).optional(),
  nextStep: z.object({ month: z.string(), step: z.string() }).optional(),
});
export type V4Chapter = z.infer<typeof ChapterSchema>;

export const V4DimensionSchema = z.object({
  key: z.enum(V4_DIMENSION_KEYS),
  label: z.string(),
  score: z.number().int().min(0).max(100),
  basis: z.array(z.enum(V4_DIMENSION_INPUTS)),
});
export type V4Dimension = z.infer<typeof V4DimensionSchema>;

const ELEMENTS = ['wood', 'fire', 'earth', 'metal', 'water'] as const;
const PersonSchema = z.object({
  element: z.enum(ELEMENTS),
  yinYang: z.enum(['yin', 'yang']),
  mbti: z.string().nullable(),
});
const PalaceSchema = z.object({
  naksat: z.string(),
  animal: z.string(),
  hidden: z.object({ element: z.enum(ELEMENTS), yinYang: z.enum(['yin', 'yang']) }),
});

export const CompatibilityV4ContentSchema = z.object({
  contentVersion: z.literal(4),
  /** Bangkok date the report was written (YYYY-MM-DD); the week plan counts days from it. */
  generatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  archetype: z.object({ key: z.string(), name: z.string(), tagline: z.string() }),
  /** Both people's day masters and MBTI, for the cover. Free. */
  people: z.object({ reader: PersonSchema, partner: PersonSchema }),
  /** Both spouse palaces, the computed basis of the attraction chapter. Paid. */
  palace: z.object({ reader: PalaceSchema, partner: PalaceSchema }),
  /** Estimated minutes to read the paid report, computed from its text. */
  readingMinutes: z.number().int().min(1),
  dimensions: z.array(V4DimensionSchema).length(V4_DIMENSION_KEYS.length),
  cover: V4SectionSchemas.cover,
  overview: V4SectionSchemas.overview,
  chapters: z.array(ChapterSchema).length(V4_CHAPTER_KEYS.length),
  calendar: z
    .array(
      z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/),
        label: z.enum(V4_MONTH_LABELS),
        text: z.string(),
      }),
    )
    .length(3),
  plan: V4SectionSchemas.plan,
  /** The insight plan the chapters were written from; kept for audit, not rendered. */
  insights: V4InsightPlanSchema.shape.insights,
});
export type CompatibilityV4Content = z.infer<typeof CompatibilityV4ContentSchema>;

/** The teaser view: cover, people and score bars only. */
export type CompatibilityV4Teaser = Pick<
  CompatibilityV4Content,
  'contentVersion' | 'generatedOn' | 'archetype' | 'cover' | 'people' | 'readingMinutes'
> & {
  dimensions: Array<Pick<V4Dimension, 'key' | 'label' | 'score'>>;
};

/** What the public share link shows: free fields only, no hints and no paid text. */
export type CompatibilityV4Share = Pick<CompatibilityV4Content, 'contentVersion' | 'archetype' | 'people'> & {
  verdict: string;
  dimensions: Array<Pick<V4Dimension, 'key' | 'label' | 'score'>>;
};

export function shareCompatibilityV4(content: CompatibilityV4Content): CompatibilityV4Share {
  return {
    contentVersion: 4,
    archetype: content.archetype,
    people: content.people,
    verdict: content.cover.verdict,
    dimensions: content.dimensions.map(({ key, label, score }) => ({ key, label, score })),
  };
}
export type CompatibilityV4Shaped = CompatibilityV4Content | CompatibilityV4Teaser;
