import { z } from 'zod';
import { GenderSchema } from './user';

/** The only compatibility contract produced in production. */
export const RELATIONSHIP_TYPES = ['romantic', 'talking', 'friend', 'boss', 'coworker', 'family'] as const;
export const RelationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  romantic: 'ความรัก',
  talking: 'คนคุย',
  friend: 'เพื่อน',
  boss: 'หัวหน้า',
  coworker: 'เพื่อนร่วมงาน',
  family: 'ครอบครัว',
};

export const TOKEN_LIMITS: Record<RelationshipType, number> = {
  romantic: 2500,
  talking: 2000,
  friend: 1800,
  boss: 1800,
  coworker: 1800,
  family: 2000,
};

/** Shared prose bounds for the report sections. */
export const thaiProse = (min: number, max: number) => z.string().trim().min(min).max(max);

export const COMPATIBILITY_VIEWS = ['teaser', 'full'] as const;
export type CompatibilityView = (typeof COMPATIBILITY_VIEWS)[number];

/**
 * Compatibility report: overview, then parts, then detail.
 *
 * The facts are computed in lib/astrology/compatibility-report.ts (four
 * dimension scores, the pair archetype, three month labels); the model writes
 * only the prose around them. What a reader sees is decided by
 * `shapeCompatibilityView`: the teaser view is the cover
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

// ---------------------------------------------------------------- model output

const chapter = {
  summary: thaiProse(40, 320),
  /** One line that carries the chapter, set large as a pull quote. */
  pullQuote: thaiProse(15, 200),
  detail: thaiProse(350, 1600),
  move: thaiProse(20, 280),
};

/**
 * A locked hint's length cap. 243 distinct passing hints from the v4 sample
 * runs (2026-09-27, ten result sets) measured 63 to 145 characters, median
 * 101, p95 130; the cap is about 1.3 × p95. The old 150 predates hints that
 * name the partner and a situation, and failed live checks.
 */
export const V4_HINT_MAX = 170;

/**
 * The no-astrology-terms rule for hint text is checked at generation, with the
 * partner's name masked (hintJargon in horo-be src/lib/compatibility-text.ts):
 * a schema can't know the name, and a partner called ดาว would fail every hint.
 */
const hint = z.object({
  text: thaiProse(20, V4_HINT_MAX),
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
 * sections (see V4_DETAIL_SPLIT in horo-be src/lib/llm.ts); the stored content is
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
/**
 * One person on the cover. MBTI is deliberately absent: it steers the prose as
 * behaviour ("มักจะ...") and is never shown or sent to a client; it lives only in
 * the stored input snapshot. Older stored teasers carry `mbti` here; parsing drops it.
 */
const PersonSchema = z.object({
  element: z.enum(ELEMENTS),
  yinYang: z.enum(['yin', 'yang']),
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
  /** Both people's day masters, for the cover. Free. */
  people: z.object({ reader: PersonSchema, partner: PersonSchema }),
  /** Both spouse palaces, the computed basis of the attraction chapter. Paid. */
  palace: z.object({ reader: PalaceSchema, partner: PalaceSchema }),
  /** Estimated minutes to read the paid report, computed from its text. */
  readingMinutes: z.number().int().min(1),
  /** Scores only: which inputs fed each score (MBTI among them) steers the prompt and is not kept. */
  dimensions: z.array(V4DimensionSchema.omit({ basis: true })).length(V4_DIMENSION_KEYS.length),
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

/** Takes the full content or a stored teaser: both carry the free fields. */
export function shareCompatibilityV4(content: Pick<CompatibilityV4Content, 'archetype' | 'people' | 'cover' | 'dimensions'>): CompatibilityV4Share {
  return {
    contentVersion: 4,
    archetype: content.archetype,
    people: coverPeople(content.people),
    verdict: content.cover.verdict,
    dimensions: content.dimensions.map(({ key, label, score }) => ({ key, label, score })),
  };
}
export type CompatibilityV4Shaped = CompatibilityV4Content | CompatibilityV4Teaser;

// ---------------------------------------------------------------- teaser-first storage

/**
 * The report is stored in two parts (horo-be docs/compatibility-response-fix.md,
 * "Locked mode"). The teaser is written at check time; the detail is written on unlock
 * (or at check time while the lock flag is off) and patched into the same row.
 * Together they are exactly CompatibilityV4Content, the full view.
 */
export const V4TeaserPartSchema = CompatibilityV4ContentSchema.pick({
  generatedOn: true,
  archetype: true,
  people: true,
  dimensions: true,
  cover: true,
});
export type V4TeaserPart = z.infer<typeof V4TeaserPartSchema>;

export const V4DetailPartSchema = CompatibilityV4ContentSchema.pick({
  palace: true,
  readingMinutes: true,
  overview: true,
  chapters: true,
  calendar: true,
  plan: true,
});
export type V4DetailPart = z.infer<typeof V4DetailPartSchema>;

/**
 * Both people's inputs when the teaser was written. The reader's profile can be
 * edited later, and the detail must be written for the same charts the teaser shows.
 */
export const V4InputsSnapshotSchema = z.object({
  reader: z.object({
    /** Kept with the teaser so a later unlock speaks in the same personal voice. */
    name: z.string().min(1).max(100).optional(),
    birthDate: z.string().datetime(),
    birthHour: z.number().int().min(0).max(23).nullable(),
    gender: GenderSchema.nullable(),
    mbti: z.string().nullable(),
  }),
  partner: z.object({ birthDate: z.string().datetime(), mbti: z.string().nullable() }),
});
export type V4InputsSnapshot = z.infer<typeof V4InputsSnapshotSchema>;

/** The stored `analysis` JSON of every current row (content_version 4). Never sent to a client. */
export const CompatibilityV4StoredSchema = z.object({
  contentVersion: z.literal(4),
  /** The insight plan both parts are written from. */
  plan: V4InsightPlanSchema,
  inputs: V4InputsSnapshotSchema,
  teaser: V4TeaserPartSchema,
  /** null until unlocked. */
  detail: V4DetailPartSchema.nullable(),
  detailGeneratedAt: z.string().datetime().optional(),
});
export type CompatibilityV4Stored = z.infer<typeof CompatibilityV4StoredSchema>;

/** Reading time shown until a locked report's detail has been written. */
export const COMPATIBILITY_LOCKED_READING_MINUTES = 11;

/**
 * The one place that decides which fields a report may expose. Both views are
 * allowlists, so neither the insight plan, the input snapshot (with both
 * people's MBTI) nor unwritten paid text can leak when the contract grows.
 */
export function shapeCompatibilityView(content: CompatibilityV4Stored, view: CompatibilityView): CompatibilityV4Shaped {
  if (view === 'teaser') {
    return teaserView(content.teaser, content.detail?.readingMinutes ?? COMPATIBILITY_LOCKED_READING_MINUTES);
  }
  if (!content.detail) throw new Error('A locked compatibility report has no full view');
  const { people, ...teaser } = content.teaser;
  return { contentVersion: 4, ...teaser, people: coverPeople(people), ...content.detail };
}

/** The cover's people, rebuilt field by field: a stored teaser may still carry `mbti`. */
function coverPeople(people: V4TeaserPart['people']): V4TeaserPart['people'] {
  const person = ({ element, yinYang }: V4TeaserPart['people']['reader']) => ({ element, yinYang });
  return { reader: person(people.reader), partner: person(people.partner) };
}

function teaserView(teaser: V4TeaserPart, readingMinutes: number): CompatibilityV4Shaped {
  return {
    contentVersion: 4,
    generatedOn: teaser.generatedOn,
    archetype: teaser.archetype,
    cover: teaser.cover,
    people: coverPeople(teaser.people),
    readingMinutes,
    dimensions: teaser.dimensions.map(({ key, label, score }) => ({ key, label, score })),
  };
}
