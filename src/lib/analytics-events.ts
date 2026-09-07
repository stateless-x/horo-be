import {
  dedupKeyFor,
  FORTUNE_CATEGORY_KEYS,
  FORTUNE_TABS,
  TRACKED_EVENT_SURFACES,
  type TrackedEvent,
} from '../../lib/shared/types/analytics';
import { RELATIONSHIP_TYPES } from '../../lib/shared/types/compatibility';

/** A product_events row, minus the DB-generated id/createdAt. */
export interface ProductEventRow {
  userId: string;
  event: string;
  surface: string | null;
  category: string | null;
  detail: string | null;
  viewDate: string;
  dedupKey: string | null;
}

/**
 * Maps a validated event onto the generic product_events column layout.
 *
 * Pure and DB-free so the mapping is unit-testable. Route body validation
 * already rejects unknown shapes, but this re-checks the enum members because
 * Elysia's literal unions and these const arrays are two separate lists that
 * could drift — a bad value must fail loudly here rather than land in the table
 * and quietly skew a report.
 *
 * @throws Error when the event falls outside the vocabulary.
 */
export function buildProductEventRow(
  input: TrackedEvent,
  userId: string,
  viewDate: string,
): ProductEventRow {
  const base = { userId, event: input.event, viewDate, dedupKey: dedupKeyFor(input) };

  switch (input.event) {
    case 'surface_viewed':
      assertMember(TRACKED_EVENT_SURFACES, input.surface, 'surface');
      return { ...base, surface: input.surface, category: null, detail: null };

    case 'category_opened':
      assertMember(['today', 'fortune'] as const, input.surface, 'surface');
      assertMember(FORTUNE_CATEGORY_KEYS, input.category, 'category');
      return { ...base, surface: input.surface, category: input.category, detail: null };

    case 'tab_opened':
      assertMember(FORTUNE_TABS, input.tab, 'tab');
      return { ...base, surface: 'fortune', category: null, detail: input.tab };

    case 'compatibility_checked':
      assertMember(RELATIONSHIP_TYPES, input.relationshipType, 'relationshipType');
      // No surface: the check is the action, not a page open. The compatibility
      // page's own open is a separate surface_viewed row.
      return { ...base, surface: null, category: null, detail: input.relationshipType };

    case 'reading_shared':
      assertMember(['today', 'fortune'] as const, input.surface, 'surface');
      return { ...base, surface: input.surface, category: null, detail: null };

    default: {
      // Unreachable while TrackedEvent is exhaustive; guards a future member
      // added to the union but forgotten here.
      const unknown = input as { event?: string };
      throw new Error(`[Analytics] Unknown event: ${String(unknown.event)}`);
    }
  }
}

function assertMember(allowed: readonly string[], value: string, field: string): void {
  if (!allowed.includes(value)) {
    throw new Error(`[Analytics] Invalid ${field}: ${value}`);
  }
}
