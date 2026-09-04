import {
  CompatibilityStructuredContentSchema,
  type CompatibilityStructuredContent,
} from '../../lib/shared';

export function parseCompatibilityContent(analysis: string): CompatibilityStructuredContent | null {
  try {
    const result = CompatibilityStructuredContentSchema.safeParse(JSON.parse(analysis));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
