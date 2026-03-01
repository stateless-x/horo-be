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

export const CompatibilityResultSchema = z.object({
  id: z.string().uuid(),
  profileAId: z.string().uuid(),
  partnerName: z.string(),
  partnerBirthDate: z.string(),
  relationshipType: z.string(),
  score: z.number().min(0).max(100),
  analysis: z.string(),
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
