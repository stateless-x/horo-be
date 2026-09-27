import {
  CompatibilityStructuredContentSchema,
  CompatibilityV4ContentSchema,
  CompatibilityV4StoredSchema,
  type CompatibilityStructuredContent,
  type CompatibilityV4Content,
  type CompatibilityV4Stored,
} from '../../lib/shared';

/**
 * The stored `analysis` column as content: v4 reports and v2 readings are
 * JSON; v1 rows are markdown and come back null (the page renders them as
 * markdown). v3 was never stored by the live route. A v4 row is the stored
 * two-part form (teaser, and detail once written), or the full content for
 * rows written before locked mode (dev databases only; v4 never shipped flat).
 */
export function parseCompatibilityContent(
  analysis: string,
): CompatibilityStructuredContent | CompatibilityV4Content | CompatibilityV4Stored | null {
  let json: unknown;
  try {
    json = JSON.parse(analysis);
  } catch {
    return null; // v1: markdown, not JSON
  }
  const version = typeof json === 'object' && json !== null && 'contentVersion' in json ? json.contentVersion : undefined;
  const schema =
    version !== 4
      ? CompatibilityStructuredContentSchema
      : typeof json === 'object' && json !== null && 'teaser' in json
        ? CompatibilityV4StoredSchema
        : CompatibilityV4ContentSchema;
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}
