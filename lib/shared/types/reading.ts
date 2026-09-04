import { z } from 'zod';

export const DailyReadingSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  date: z.string().datetime(),
  content: z.string(),
  luckyNumber: z.number().optional(),
  luckyColor: z.string().optional(),
  luckyDirection: z.string().optional(),
  elementEnergy: z.record(z.string(), z.number()), // element -> strength percentage
  createdAt: z.string().datetime(),
});
export type DailyReading = z.infer<typeof DailyReadingSchema>;

export const CompatibilityStructuredContentSchema = z.object({
  contentVersion: z.literal(2),
  scoreExplanation: z.string().min(1).max(240),
  verdict: z.string().min(1).max(180),
  chemistry: z.string().min(1).max(500),
  caution: z.string().min(1).max(500),
  advice: z.string().min(1).max(500),
});
export type CompatibilityStructuredContent = z.infer<typeof CompatibilityStructuredContentSchema>;

export const CompatibilityResultSchema = z.object({
  id: z.string().uuid(),
  profileAId: z.string().uuid(),
  partnerName: z.string(),
  partnerBirthDate: z.string(),
  relationshipType: z.string(),
  score: z.number().min(0).max(100),
  analysis: z.string(),
  contentVersion: z.number().int().optional(),
  structuredContent: CompatibilityStructuredContentSchema.nullable().optional(),
  strengths: z.array(z.string()).optional(),
  challenges: z.array(z.string()).optional(),
  userElement: z.string().optional(),
  userDayMaster: z.string().optional(),
  partnerElement: z.string().optional(),
  partnerDayMaster: z.string().optional(),
  shareToken: z.string().optional(),
  cached: z.boolean().optional(),
  createdAt: z.string(),
});
export type CompatibilityResult = z.infer<typeof CompatibilityResultSchema>;

export const TeaserResultSchema = z.object({
  elementType: z.string(),
  personality: z.string(),
  todaySnippet: z.string(),
});
export type TeaserResult = z.infer<typeof TeaserResultSchema>;
