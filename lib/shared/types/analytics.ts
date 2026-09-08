import type { RelationshipType } from './compatibility';
import { FortuneCategoryKeySchema, type FortuneCategoryKey } from './astrology';

/**
 * Dashboard surfaces whose daily opens are counted.
 *
 * The single source of truth for both the API's body validation and the
 * frontend's tracking hook, so adding a surface is one edit here plus a
 * `bun run sync:types`.
 *
 * Deliberately NOT widened to the newer surfaces: the legacy
 * `POST /api/analytics/view` route validates its body against exactly these two
 * literals, so adding a member here would type-check while the route kept
 * rejecting it at runtime. New surfaces go in TRACKED_EVENT_SURFACES instead.
 */
export const TRACKED_SURFACES = ['today', 'fortune'] as const;

export type TrackedSurface = (typeof TRACKED_SURFACES)[number];

/**
 * Surfaces the generic product-event pipeline understands. A superset of
 * TRACKED_SURFACES — `surface_viewed` covers the whole dashboard, while
 * category/tab/share events only make sense on the reading surfaces.
 */
export const TRACKED_EVENT_SURFACES = ['today', 'fortune', 'compatibility', 'settings'] as const;

export type TrackedEventSurface = (typeof TRACKED_EVENT_SURFACES)[number];

/**
 * Fortune category keys, reused from the astrology schema rather than redefined
 * — that zod enum already is the backend's source of truth for the six areas,
 * and a second list would be free to drift from it.
 *
 * Re-exported here so the event vocabulary reads as one unit, and so
 * `horo-fe/src/lib/fortune-category-config.ts` can derive its key type from
 * lib/shared instead of owning the list itself.
 */
export const FORTUNE_CATEGORY_KEYS = FortuneCategoryKeySchema.options;

export type { FortuneCategoryKey };

/** Tabs on the fortune (full chart) surface. */
export const FORTUNE_TABS = ['overview', 'readings', 'details'] as const;

export type FortuneTabKey = (typeof FORTUNE_TABS)[number];

/**
 * Cross-surface calls to action worth counting, named `<from>_<to>`.
 *
 * Deliberately a short closed list rather than a free-form string: an id typed
 * at a call site would land in the table misspelled and quietly split one CTA's
 * numbers across two rows. Every button that moves a reader from one surface to
 * another gets an entry here first.
 *
 * Not every clickable thing belongs here — a control that only changes what is
 * already on screen is a `tab_opened`, and a click that produces a reading has
 * its own event. This is for "left this surface for that one".
 */
export const TRACKED_CTAS = [
  /** /dashboard/today → /dashboard/fortune, the monthly-reading band. */
  'today_monthly_chart',
  /** /dashboard/fortune → /dashboard/compatibility, from the read-next block. */
  'fortune_compatibility',
  /** /dashboard/fortune → /dashboard/today, from the read-next block. */
  'fortune_today',
] as const;

export type TrackedCta = (typeof TRACKED_CTAS)[number];

export const COMPATIBILITY_FAILURE_CLASSES = [
  'rate_limited',
  'timeout',
  'validation',
  'authentication',
  'profile_missing',
  'network',
  'server',
  'unknown',
] as const;

export type CompatibilityFailureClass = (typeof COMPATIBILITY_FAILURE_CLASSES)[number];

export const COMPATIBILITY_RESULT_ORIGINS = ['fresh', 'cache', 'history'] as const;

export type CompatibilityResultOrigin = (typeof COMPATIBILITY_RESULT_ORIGINS)[number];

export const COMPATIBILITY_SHARE_PLATFORMS = ['line', 'facebook', 'twitter', 'copy'] as const;

export type CompatibilitySharePlatform = (typeof COMPATIBILITY_SHARE_PLATFORMS)[number];

export const TRACKED_EVENT_NAMES = [
  'surface_viewed',
  'category_opened',
  'tab_opened',
  'cta_clicked',
  'relationship_selected',
  'calculation_started',
  'calculation_failed',
  'compatibility_checked',
  'result_opened',
  'guidance_opened',
  'compatibility_share_initiated',
  'reading_shared',
] as const;

export type TrackedEventName = (typeof TRACKED_EVENT_NAMES)[number];

/**
 * Every product event the app may record. Carries no birth data, names, or
 * generated prose — only which part of the product was opened.
 */
export type TrackedEvent =
  | { event: 'surface_viewed'; surface: TrackedEventSurface }
  | { event: 'category_opened'; surface: 'today' | 'fortune'; category: FortuneCategoryKey }
  | { event: 'tab_opened'; surface: 'fortune'; tab: FortuneTabKey }
  | { event: 'cta_clicked'; surface: TrackedEventSurface; cta: TrackedCta }
  | { event: 'relationship_selected'; relationshipType: RelationshipType }
  | { event: 'calculation_started'; relationshipType: RelationshipType }
  | {
      event: 'calculation_failed';
      relationshipType: RelationshipType;
      failureClass: CompatibilityFailureClass;
    }
  | { event: 'compatibility_checked'; relationshipType: RelationshipType }
  | {
      event: 'result_opened';
      relationshipType: RelationshipType;
      origin: CompatibilityResultOrigin;
    }
  | { event: 'guidance_opened'; relationshipType: RelationshipType }
  | {
      event: 'compatibility_share_initiated';
      relationshipType: RelationshipType;
      platform: CompatibilitySharePlatform;
    }
  | { event: 'reading_shared'; surface: 'today' | 'fortune' };

/**
 * The dedup identity of an event within one Bangkok day, or null when every
 * occurrence should be counted.
 *
 * Defined here — not in the route or the client — because both sides must agree
 * exactly: the client skips a repeat request using this key, and the DB's unique
 * index on (user, event, dedupKey, viewDate) is the backstop. Two copies of this
 * rule would drift and silently double-count.
 *
 * Returning null is what makes a non-deduped event insertable repeatedly:
 * Postgres treats NULLs as distinct, so those rows never collide.
 */
export function dedupKeyFor(event: TrackedEvent): string | null {
  switch (event.event) {
    case 'surface_viewed':
      return event.surface;
    case 'category_opened':
      return `${event.surface}:${event.category}`;
    case 'tab_opened':
      return event.tab;
    case 'relationship_selected':
      return event.relationshipType;
    case 'guidance_opened':
      return `next_steps:${event.relationshipType}`;
    // Every check, every share and every CTA click is a distinct action worth
    // counting, so these deliberately opt out of dedup.
    case 'cta_clicked':
    case 'calculation_started':
    case 'calculation_failed':
    case 'compatibility_checked':
    case 'result_opened':
    case 'compatibility_share_initiated':
    case 'reading_shared':
      return null;
  }
}
