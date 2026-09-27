import { z } from 'zod';

/**
 * Compatibility reading v3: one generation, two views.
 *
 * The model writes a short free `teaser` and a long `detail` in a single JSON
 * object. What a reader sees is decided afterwards by `shapeCompatibilityView`,
 * so the teaser view and the full view always come from the same stored text.
 * v2 (`CompatibilityStructuredContentSchema` in reading.ts) is unchanged and
 * saved v2 rows keep rendering as v2.
 *
 * Length bounds are calibrated against 45 real DeepSeek generations (prototype
 * run, 2026-09-27): each max is about 1.3x the longest observed `.length`.
 * `.length` counts UTF-16 units, so Thai vowel and tone marks inflate it
 * relative to what a reader sees. Minimums sit well under the shortest
 * observed output; they exist to catch a truncated or empty field.
 */

export const COMPATIBILITY_V3_DETAIL_SECTIONS = [
  'dynamic',
  'understandingPartner',
  'yourSide',
  'communication',
  'friction',
  'timing',
  'longTerm',
] as const;
export type CompatibilityV3DetailSection = (typeof COMPATIBILITY_V3_DETAIL_SECTIONS)[number];

/** The birth data a `timing` recommendation may cite, p1 being the reader. */
export const COMPATIBILITY_V3_TIMING_BASIS = [
  'p1ThaiDay',
  'p1Planet',
  'p1Element',
  'p2ThaiDay',
  'p2Planet',
  'p2Element',
] as const;
export type CompatibilityV3TimingBasis = (typeof COMPATIBILITY_V3_TIMING_BASIS)[number];

/**
 * Anything that is not Thai script, a digit, whitespace or plain punctuation,
 * once MBTI codes and the word MBTI are removed. DeepSeek occasionally drops
 * stray English, Portuguese or Chinese tokens into long Thai output
 * ("boulevard", "enquanto", "补齐"); the raw day-master code "ding" leaked the
 * same way. A match fails validation, which buys one repair call.
 */
const ALLOWED_LATIN = /(?<![A-Za-z])(?:[IE][NS][TF][JP]|MBTI)(?![A-Za-z])/g;
const FOREIGN_SCRIPT = /[^฀-๿0-9\s.,:;!?()"'%/]/;

export function foreignTokenIn(text: string): string | null {
  const stripped = text.replace(ALLOWED_LATIN, '');
  const match = stripped.match(new RegExp(`${FOREIGN_SCRIPT.source}+`));
  return match ? match[0] : null;
}

const thaiProse = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .superRefine((value, ctx) => {
      const token = foreignTokenIn(value);
      if (token) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Non-Thai text in prose: "${token}"` });
      }
    });

export const CompatibilityV3TeaserSchema = z.object({
  verdict: thaiProse(20, 200),
  hook: thaiProse(40, 260),
  lockedHints: z
    .array(
      z.object({
        text: thaiProse(20, 150),
        section: z.enum(COMPATIBILITY_V3_DETAIL_SECTIONS),
      }),
    )
    .length(3)
    .refine((hints) => new Set(hints.map((hint) => hint.section)).size === 3, {
      message: 'Each locked hint must point to a different section',
    }),
});
export type CompatibilityV3Teaser = z.infer<typeof CompatibilityV3TeaserSchema>;

export const CompatibilityV3DetailSchema = z.object({
  dynamic: thaiProse(200, 950),
  understandingPartner: thaiProse(150, 750),
  yourSide: thaiProse(120, 650),
  communication: z
    .array(z.object({ do: thaiProse(20, 220), avoid: thaiProse(20, 180) }))
    .length(3),
  friction: z
    .array(
      z.object({
        scenario: thaiProse(30, 220).refine((value) => value.startsWith('ถ้า'), {
          message: 'A friction scenario must start with ถ้า',
        }),
        repair: thaiProse(30, 220),
      }),
    )
    .length(2),
  timing: z.object({
    advice: thaiProse(100, 600),
    basis: z.array(z.enum(COMPATIBILITY_V3_TIMING_BASIS)).min(1).max(6),
  }),
  longTerm: thaiProse(100, 520),
  nextSteps: z.object({
    action: thaiProse(1, 180),
    conversationStarter: thaiProse(1, 220),
    watchFor: thaiProse(1, 180),
  }),
});
export type CompatibilityV3Detail = z.infer<typeof CompatibilityV3DetailSchema>;

/** What the model must return. */
export const CompatibilityV3GeneratedSchema = z.object({
  detail: CompatibilityV3DetailSchema,
  teaser: CompatibilityV3TeaserSchema,
});

/** What gets stored: the generated text plus the deterministic score line. */
export const CompatibilityV3ContentSchema = CompatibilityV3GeneratedSchema.extend({
  contentVersion: z.literal(3),
  scoreExplanation: z.string().min(1).max(240),
});
export type CompatibilityV3Content = z.infer<typeof CompatibilityV3ContentSchema>;

export const COMPATIBILITY_VIEWS = ['teaser', 'full'] as const;
export type CompatibilityView = (typeof COMPATIBILITY_VIEWS)[number];

/** A v3 reading as one view shows it: `detail` is absent in the teaser view. */
export type CompatibilityV3Shaped = Omit<CompatibilityV3Content, 'detail'> & {
  detail?: CompatibilityV3Detail;
};

/**
 * The one place that decides what a view contains. The server must call this
 * before responding, so a teaser response never carries the detail text.
 */
export function shapeCompatibilityView(
  content: CompatibilityV3Content,
  view: CompatibilityView,
): CompatibilityV3Shaped {
  if (view === 'full') return content;
  // An allowlist, not a spread-and-delete: a field added to the content later
  // stays out of the teaser view until someone decides it belongs there.
  return {
    contentVersion: content.contentVersion,
    scoreExplanation: content.scoreExplanation,
    teaser: content.teaser,
  };
}
