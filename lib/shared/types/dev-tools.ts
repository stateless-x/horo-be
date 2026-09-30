import { z } from 'zod';
import {
  COMPATIBILITY_VIEWS,
  RelationshipTypeSchema,
  type CompatibilityV4Shaped,
  type RelationshipType,
} from './compatibility';

/**
 * Contracts for the dev-only generator tools (horo-be `/api/dev/generate/*`,
 * horo-fe `/dev/*`). Never mounted or rendered in production.
 */

/** Every dev generate endpoint answers with this envelope. */
export interface DevGenerateResponse<TOutput, TContent = TOutput> {
  /** What the real product surface would receive (for compatibility: the shaped view). */
  output: TOutput;
  /** Everything that was generated, before any view shaping. */
  content: TContent;
  /** The exact prompt sent to the model. */
  prompt: string;
  promptChars: number;
  outputChars: number;
  /** Model calls made, including transport retries and the validation repair. */
  modelCalls: number;
  timings: { calcMs: number; llmMs: number; totalMs: number };
}

export interface DevGenerateError {
  error: string;
  detail?: string;
}

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const MbtiCodeSchema = z.string().regex(/^[IE][NS][TF][JP]$/, 'Use a 4-letter MBTI code');

export const DevCompatibilityPersonSchema = z.object({
  /** Display only (the report cover); never sent to the model. */
  name: z.string().trim().min(1).max(40).optional(),
  birthDate: IsoDateSchema,
  /** 0-23, omitted when unknown. */
  birthHour: z.number().int().min(0).max(23).optional(),
  gender: z.enum(['male', 'female']),
  mbti: MbtiCodeSchema.optional(),
});
export type DevCompatibilityPerson = z.infer<typeof DevCompatibilityPersonSchema>;

export const DevCompatibilityPartnerSchema = z.object({
  name: z.string().trim().min(1).max(40),
  birthDate: IsoDateSchema,
  mbti: MbtiCodeSchema.optional(),
});
export type DevCompatibilityPartner = z.infer<typeof DevCompatibilityPartnerSchema>;

export const DevCompatibilityRequestSchema = z.object({
  reader: DevCompatibilityPersonSchema,
  partner: DevCompatibilityPartnerSchema,
  relationshipType: RelationshipTypeSchema,
  view: z.enum(COMPATIBILITY_VIEWS),
});
export type DevCompatibilityRequest = z.infer<typeof DevCompatibilityRequestSchema>;

/** What the compatibility result surface needs to render a reading. */
export interface DevCompatibilityOutput {
  score: number;
  relationshipType: RelationshipType;
  readerName: string | null;
  partnerName: string;
  structuredContent: CompatibilityV4Shaped;
  /** Quality checks that still failed after the one repair turn. */
  qualityFlags?: string[];
}

/**
 * Synthetic pairs used by the current prompt tests and dev-tool presets. No
 * real person's data.
 */
export const COMPATIBILITY_DEV_FIXTURES: ReadonlyArray<{
  id: string;
  label: string;
  relationshipType: RelationshipType;
  reader: DevCompatibilityPerson;
  partner: DevCompatibilityPartner;
}> = [
  {
    id: 'romantic-both-mbti',
    label: 'คนรัก, MBTI ทั้งคู่',
    relationshipType: 'romantic',
    reader: { birthDate: '1996-03-14', birthHour: 8, gender: 'female', mbti: 'INFP' },
    partner: { name: 'ต้น', birthDate: '1993-11-02', mbti: 'ESTJ' },
  },
  {
    id: 'talking-reader-mbti-only',
    label: 'คนคุย, MBTI เฉพาะคุณ',
    relationshipType: 'talking',
    reader: { birthDate: '1999-06-05', birthHour: 21, gender: 'male', mbti: 'ENFP' },
    partner: { name: 'มายด์', birthDate: '1998-07-21' },
  },
  {
    id: 'friend-no-mbti',
    label: 'เพื่อน, ไม่มี MBTI',
    relationshipType: 'friend',
    reader: { birthDate: '1994-12-18', gender: 'female' },
    partner: { name: 'บีม', birthDate: '1995-01-09' },
  },
  {
    id: 'boss-both-mbti',
    label: 'หัวหน้า, MBTI ทั้งคู่',
    relationshipType: 'boss',
    reader: { birthDate: '1997-09-27', birthHour: 14, gender: 'female', mbti: 'ISFJ' },
    partner: { name: 'คุณวิภา', birthDate: '1980-05-30', mbti: 'ENTJ' },
  },
  {
    id: 'family-partner-mbti-only',
    label: 'ครอบครัว, MBTI เฉพาะอีกฝ่าย',
    relationshipType: 'family',
    reader: { birthDate: '1992-02-11', gender: 'male' },
    partner: { name: 'แม่', birthDate: '1965-09-12', mbti: 'ISTJ' },
  },
];
