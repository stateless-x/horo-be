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

export const TRACKED_EVENT_NAMES = [
  'surface_viewed',
  'category_opened',
  'tab_opened',
  'compatibility_checked',
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
  | { event: 'compatibility_checked'; relationshipType: RelationshipType }
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
    // Every check and every share is a distinct action worth counting, so these
    // deliberately opt out of dedup.
    case 'compatibility_checked':
    case 'reading_shared':
      return null;
  }
}
