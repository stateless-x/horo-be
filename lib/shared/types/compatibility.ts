import { z } from 'zod';

export const RELATIONSHIP_TYPES = ['romantic', 'talking', 'friend', 'boss', 'coworker', 'family'] as const;
export const RelationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  romantic: 'ความรัก',
  talking: 'คนคุย',
  friend: 'เพื่อน',
  boss: 'หัวหน้า',
  coworker: 'เพื่อนร่วมงาน',
  family: 'ครอบครัว',
};

export const TOKEN_LIMITS: Record<RelationshipType, number> = {
  romantic: 1200,
  talking: 1000,
  friend: 900,
  boss: 800,
  coworker: 800,
  family: 1000,
};
