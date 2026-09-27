import {
  CompatibilityStructuredContentSchema,
  CompatibilityV4ContentSchema,
  type CompatibilityStructuredContent,
  type CompatibilityV4Content,
} from '../../lib/shared';

/**
 * The stored `analysis` column as content: v4 reports and v2 readings are
 * JSON; v1 rows are markdown and come back null (the page renders them as
 * markdown). v3 was never stored by the live route.
 */
export function parseCompatibilityContent(analysis: string): CompatibilityStructuredContent | CompatibilityV4Content | null {
  let json: unknown;
  try {
    json = JSON.parse(analysis);
  } catch {
    return null; // v1: markdown, not JSON
  }
  const version = typeof json === 'object' && json !== null && 'contentVersion' in json ? json.contentVersion : undefined;
  const result = version === 4 ? CompatibilityV4ContentSchema.safeParse(json) : CompatibilityStructuredContentSchema.safeParse(json);
  return result.success ? result.data : null;
}
