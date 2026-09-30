import { CompatibilityV4StoredSchema, type CompatibilityV4Stored } from '../../lib/shared';
import type { compatibility } from '../../lib/db';

/** 4: the canonical report. Rows with any other content_version (NULL) are legacy and never served. */
export const COMPATIBILITY_CONTENT_VERSION = 4;

/**
 * The stored `analysis` of a current row: the two-part report (teaser, and
 * detail once unlocked). Call it only on a row whose content_version is 4; a
 * row that says 4 and does not parse is corrupt, so this throws instead of
 * guessing.
 */
export function parseCompatibilityContent(row: Pick<typeof compatibility.$inferSelect, 'id' | 'analysis' | 'contentVersion'>): CompatibilityV4Stored {
  if (row.contentVersion !== COMPATIBILITY_CONTENT_VERSION) {
    throw new Error(`Compatibility ${row.id} is a legacy row (content_version ${row.contentVersion}) and is not served`);
  }
  return CompatibilityV4StoredSchema.parse(JSON.parse(row.analysis));
}

/** A row the app may serve. Legacy rows are kept in the table and treated as not found. */
export function isCurrentCompatibility(row: Pick<typeof compatibility.$inferSelect, 'contentVersion'>): boolean {
  return row.contentVersion === COMPATIBILITY_CONTENT_VERSION;
}
