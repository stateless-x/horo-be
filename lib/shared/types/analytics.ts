/**
 * Dashboard surfaces whose daily opens are counted.
 *
 * The single source of truth for both the API's body validation and the
 * frontend's tracking hook, so adding a surface is one edit here plus a
 * `bun run sync:types`.
 */
export const TRACKED_SURFACES = ['today', 'fortune'] as const;

export type TrackedSurface = (typeof TRACKED_SURFACES)[number];
