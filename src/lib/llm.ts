import { z } from "zod";
import { config } from "../config";
import { SYSTEM_PROMPT } from "./prompts";
import {
  CompatibilityStructuredContentSchema,
  CompatibilityV3GeneratedSchema,
  COMPATIBILITY_V3_HINT_SECTIONS,
  COMPATIBILITY_V3_TIMING_BASIS,
  V4InsightPlanSchema,
  V4AllSectionsSchema,
  foreignTokenIn,
  type CompatibilityStructuredContent,
  type V4InsightPlan,
  type V4SectionKey,
  type V4Sections,
} from "../../lib/shared";

type CompatibilityV3Generated = z.infer<typeof CompatibilityV3GeneratedSchema>;
import { CHART_BUDGET, DAILY_BUDGET } from "../../lib/shared/types/generation-budget";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MAX_TOKENS_CAP = 8192; // deepseek-chat hard limit

/**
 * Error thrown when the DeepSeek HTTP call itself fails (non-2xx response).
 * Carries the HTTP status so isRetryableError can classify it the same way
 * gemini.ts classified Google's RESOURCE_EXHAUSTED/PERMISSION_DENIED/INVALID_ARGUMENT.
 */
class DeepSeekApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "DeepSeekApiError";
  }
}

/**
 * Check if a DeepSeek error is worth retrying.
 * Billing/quota/auth/bad-request errors fail fast — retrying won't help.
 * Mirrors gemini.ts's policy (fail fast on auth/quota/invalid-argument,
 * retry everything else) but keyed to DeepSeek's OpenAI-compatible HTTP statuses.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof DeepSeekApiError) {
    // 401 unauthorized, 403 forbidden, 402 insufficient balance, 400 bad request
    if ([400, 401, 402, 403].includes(error.status)) return false;
    return true; // 429 rate limit, 5xx server errors — retryable
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("insufficient balance") || message.includes("402")) return false;
  if (message.includes("401") || message.includes("403")) return false;
  return true;
}

function clampMaxTokens(requested: number): number {
  return Math.min(requested, MAX_TOKENS_CAP);
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Low-level DeepSeek chat-completions call. One HTTP attempt — callers handle retries.
 * Uses AbortController per attempt so a retry gets a fresh, unfired signal.
 */
async function callDeepSeek(
  messages: ChatMessage[],
  options: {
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    jsonMode?: boolean;
  },
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.deepseek.apiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseek.model,
        messages,
        temperature: options.temperature,
        max_tokens: clampMaxTokens(options.maxTokens),
        ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new DeepSeekApiError(
        response.status,
        `DeepSeek API error ${response.status}: ${body || response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number };
    };
    if (data.usage) {
      console.log(
        `[DeepSeek] usage: prompt=${data.usage.prompt_tokens} (cache_hit=${data.usage.prompt_cache_hit_tokens ?? 0}) completion=${data.usage.completion_tokens} model=${config.deepseek.model}`,
      );
    }
    const text = data.choices?.[0]?.message?.content;

    if (!text) {
      throw new Error("Empty response from DeepSeek");
    }

    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate a fortune reading using DeepSeek Chat
 *
 * All fortune readings use the same mystical narrator system prompt
 * to ensure consistent tone and voice across all features.
 *
 * The LLM NEVER runs on the frontend - all calls go through this backend API.
 */
export async function generateFortuneReading(
  prompt: string,
  maxTokens: number = 500,
): Promise<string> {
  const maxRetries = 2;
  let lastError: Error | null = null;
  const timeoutMs = maxTokens <= 300 ? 15_000 : 20_000;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callDeepSeek(messages, {
        maxTokens,
        temperature: 0.8,
        timeoutMs,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[DeepSeek] Fortune reading attempt ${attempt + 1}/${maxRetries + 1} failed:`,
        lastError.message
      );

      if (!isRetryableError(error)) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw new Error(
    `Failed to generate fortune reading after ${maxRetries + 1} attempts: ${lastError?.message}`
  );
}

const STRUCTURED_COMPATIBILITY_SHAPE = `
Return valid JSON matching exactly this shape (all fields required):
{
  "verdict": string,
  "chemistry": string,
  "caution": string,
  "advice": string,
  "nextSteps": {
    "action": string,
    "conversationStarter": string,
    "watchFor": string
  }
}
Length limits: verdict 1 to 180 characters (one sentence), chemistry, caution and advice 1 to 500 characters each, action 1 to 180 characters, conversationStarter 1 to 220 characters, watchFor 1 to 180 characters.
Do not include the score, markdown, or any text outside this JSON object.`;

type GeneratedCompatibilityContent = Pick<
  CompatibilityStructuredContent,
  'verdict' | 'chemistry' | 'caution' | 'advice'
> & {
  nextSteps: NonNullable<CompatibilityStructuredContent['nextSteps']>;
};

const GeneratedCompatibilityContentSchema = CompatibilityStructuredContentSchema.pick({
  verdict: true,
  chemistry: true,
  caution: true,
  advice: true,
  nextSteps: true,
}).required();

/** Called once per model request, retries included. Lets a caller count calls without changing the result. */
export type OnModelCall = () => void;

/**
 * The compatibility generation loop, shared by v2 and v3: JSON mode, 60 s per
 * call, up to two transport retries with backoff, and one validation repair
 * that re-asks with a short correction appended.
 */
async function generateValidatedCompatibilityJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  maxTokens: number,
  /**
   * Describes what failed for the repair turn: the model sees its own reply
   * and this description, and corrects that reply. Regenerating from scratch
   * repeated the same slips.
   */
  describeInvalid: (problems: string[]) => string,
  onModelCall?: OnModelCall,
  /**
   * Quality checks that are worth one repair but not worth failing the
   * reading over: they go into the repair turn with the schema problems, and
   * whatever still fails after it is returned as `softIssues`, not thrown.
   */
  softCheck?: (data: T) => string[],
  /**
   * Repair turns allowed for rule failures. v2 and v3 keep one; the v4
   * section calls allow two, because a long reply that fixes one slip
   * sometimes makes another (a stray Chinese word in a fixed plan step).
   */
  maxRepairs = 1,
): Promise<{ data: T; softIssues: string[] }> {
  let effectivePrompt = prompt;
  let repairTurn: ChatMessage[] = [];
  let repairsUsed = 0;
  let transportFailures = 0;

  while (true) {
    let text: string;
    try {
      onModelCall?.();
      text = await callDeepSeek(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: effectivePrompt },
          ...repairTurn,
        ],
        {
          maxTokens,
          temperature: 0.7,
          timeoutMs: 60_000,
          jsonMode: true,
        },
      );
    } catch (error) {
      if (!isRetryableError(error) || transportFailures >= 2) throw error;
      transportFailures += 1;
      await new Promise(resolve => setTimeout(resolve, 1000 * transportFailures));
      continue;
    }

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const result = schema.safeParse(parsed);
      if (result.success) {
        const softIssues = softCheck?.(result.data) ?? [];
        // Quality issues get one repair, and only as the first one.
        if (softIssues.length === 0 || repairsUsed > 0) return { data: result.data, softIssues };
        repairsUsed += 1;
        repairTurn = [
          { role: "assistant", content: text },
          { role: "user", content: describeInvalid(softIssues) },
        ];
        continue;
      }

      if (repairsUsed >= maxRepairs) throw new Error(`Invalid compatibility JSON: ${result.error.message}`);
      repairsUsed += 1;
      repairTurn = [
        { role: "assistant", content: text },
        { role: "user", content: describeInvalid(result.error.issues.map(issueLine)) },
      ];
    } catch (error) {
      if (repairsUsed >= maxRepairs) throw error;
      repairsUsed += 1;
      effectivePrompt = `${effectivePrompt}\n\nYour previous response was not valid JSON. Return only the complete JSON object.`;
    }
  }
}

/**
 * The repair turn for either version: names each failed field (and, for v3,
 * the offending token), so the model fixes that instead of guessing. v2 used
 * to repair with a generic hint that never said which field; a verdict over
 * 180 characters then failed twice in a row.
 */
const issueLine = (issue: z.ZodIssue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`;

function describeInvalid(problems: string[]): string {
  return `Your JSON above failed validation: ${problems.join('; ')}. Return the complete corrected JSON object with every field of the required shape, changing only what these problems need. Write all prose in Thai; 4-letter MBTI codes are the only English allowed.`;
}

/** Generate the compact narrative portion of compatibility v2. */
export async function generateStructuredCompatibilityReading(
  prompt: string,
  maxTokens: number = 1000,
  onModelCall?: OnModelCall,
): Promise<GeneratedCompatibilityContent> {
  const { data } = await generateValidatedCompatibilityJson(
    `${prompt}\n${STRUCTURED_COMPATIBILITY_SHAPE}`,
    GeneratedCompatibilityContentSchema.superRefine(rejectForeignWords),
    maxTokens,
    describeInvalid,
    onModelCall,
  );
  return data;
}

const STRUCTURED_COMPATIBILITY_V3_SHAPE = `
Return valid JSON matching exactly this shape (all fields required, write "detail" before "teaser"):
{
  "detail": {
    "dynamic": string,
    "understandingPartner": string,
    "yourSide": string,
    "communication": [ { "do": string, "avoid": string } ],
    "friction": [ { "scenario": string, "repair": string } ],
    "timing": { "advice": string, "basis": [string] },
    "longTerm": string,
    "nextSteps": { "action": string, "conversationStarter": string, "watchFor": string }
  },
  "teaser": {
    "verdict": string,
    "hook": string,
    "lockedHints": [ { "text": string, "section": string } ]
  }
}
communication has exactly 3 items. friction has exactly 2 items and every scenario starts with "ถ้า".
timing.basis values come only from: ${COMPATIBILITY_V3_TIMING_BASIS.join(', ')}.
lockedHints has exactly 3 items; each section is a different one of: ${COMPATIBILITY_V3_HINT_SECTIONS.join(', ')}.
Length limits: nextSteps.action 1 to 180 characters, conversationStarter 1 to 220 characters, watchFor 1 to 180 characters.
Do not include the score, markdown, comments, or any text outside this JSON object.`;

/**
 * Output token ceiling for v3. Measured completions ran 1,300 to 1,970
 * tokens (prototype, 60 runs); 3,000 leaves room without letting a runaway
 * reply eat the 60 s budget.
 */
const COMPATIBILITY_V3_MAX_TOKENS = 3000;

/**
 * Generate compatibility v3: the free teaser and the full detail in one call.
 * `pairCheck` adds rules that depend on this pair (e.g. which elements may be
 * named); its failures go through the same repair turn as schema failures.
 */
export async function generateStructuredCompatibilityReadingV3(
  prompt: string,
  onModelCall?: OnModelCall,
  pairCheck?: (content: CompatibilityV3Generated, ctx: z.RefinementCtx) => void,
): Promise<CompatibilityV3Generated> {
  const { data } = await generateValidatedCompatibilityJson(
    `${prompt}\n${STRUCTURED_COMPATIBILITY_V3_SHAPE}`,
    pairCheck ? CompatibilityV3GeneratedSchema.superRefine(pairCheck) : CompatibilityV3GeneratedSchema,
    COMPATIBILITY_V3_MAX_TOKENS,
    describeInvalid,
    onModelCall,
  );
  return data;
}

/**
 * v2's schema is also the stored-content schema, which old rows with English
 * in them must still parse against, so the foreign-word rule lives here, on
 * generation only. v2 leaked "naturally" into Thai output in the samples.
 */
function rejectForeignWords(content: GeneratedCompatibilityContent, ctx: z.RefinementCtx) {
  const fields: Array<[string, string]> = [
    ['verdict', content.verdict],
    ['chemistry', content.chemistry],
    ['caution', content.caution],
    ['advice', content.advice],
    ['nextSteps.action', content.nextSteps.action],
    ['nextSteps.conversationStarter', content.nextSteps.conversationStarter],
    ['nextSteps.watchFor', content.nextSteps.watchFor],
  ];
  for (const [path, text] of fields) {
    const token = foreignTokenIn(text);
    if (token) ctx.addIssue({ code: z.ZodIssueCode.custom, path: path.split('.'), message: `Non-Thai text in prose: "${token}"` });
  }
}

// ---------------------------------------------------------------- v4 report

const V4_PLAN_SHAPE = `
Return valid JSON matching exactly this shape:
{ "insights": [ { "text": string, "basis": [string], "chapter": string } ] }
insights has 6 to 8 items. Do not include markdown or any text outside this JSON object.`;

/** The JSON each section contributes to a call's shape, plus its count rules. */
const V4_SECTION_SHAPES: Record<V4SectionKey, { json: string; rules?: string }> = {
  cover: {
    json: '"cover": { "verdict": string, "lockedHints": [ { "text": string, "chapter": string } ] }',
    rules: 'lockedHints has exactly 3 items, each chapter a different one of: partner, you, communication, friction.',
  },
  overview: {
    json: '"overview": { "story": string, "dimensionLines": { "chemistry": string, "communication": string, "trust": string, "rhythm": string } }',
  },
  attraction: { json: '"attraction": { "summary": string, "detail": string, "move": string }' },
  partner: { json: '"partner": { "summary": string, "detail": string, "move": string }' },
  you: { json: '"you": { "summary": string, "detail": string, "move": string }' },
  communication: {
    json: '"communication": { "summary": string, "detail": string, "move": string, "pairs": [ { "do": string, "avoid": string } ], "lines": [string] }',
    rules: 'communication.pairs has exactly 3 items and communication.lines exactly 3.',
  },
  friction: {
    json: '"friction": { "summary": string, "detail": string, "move": string, "scenarios": [ { "scenario": string, "repair": string } ] }',
    rules: 'friction.scenarios has 2 or 3 items and every scenario starts with "ถ้า".',
  },
  future: {
    json: '"future": { "summary": string, "detail": string, "move": string, "goSignals": [string], "slowSignals": [string], "nextStep": { "month": "YYYY-MM", "step": string } }',
    rules: 'future.goSignals and future.slowSignals have 2 or 3 items each.',
  },
  calendar: {
    json: '"calendar": [ { "month": "YYYY-MM", "text": string } ]',
    rules: 'calendar has exactly 3 items, one per given month, in order.',
  },
  plan: {
    json: '"plan": [ { "day": number, "action": string, "conversationStarter": string, "watchFor": string } ]',
    rules: 'plan has exactly 3 items with day from 1 to 7 in increasing order.',
  },
};

function v4Shape(sections: readonly V4SectionKey[]): string {
  const rules = sections.map((key) => V4_SECTION_SHAPES[key].rules).filter(Boolean);
  return `
Return valid JSON matching exactly this shape (all fields required):
{
${sections.map((key) => `  ${V4_SECTION_SHAPES[key].json}`).join(',\n')}
}
${rules.join('\n')}
Do not include the score, markdown, comments, or any text outside this JSON object.`;
}

export interface V4PartOptions<T> {
  onModelCall?: OnModelCall;
  /** Pair-specific rules that must hold (they fail the reading if the repair doesn't fix them). */
  pairCheck?: (content: T, ctx: z.RefinementCtx) => void;
  /** Quality rules worth one repair; see generateValidatedCompatibilityJson. */
  softCheck?: (content: T) => string[];
}

/**
 * How the report's sections are split across parallel calls, after the
 * insight plan. Measured on the five fixtures (see the report samples): three
 * calls of about 1,500 to 1,900 output tokens each finish together in about
 * the time one 2,300-token half took.
 */
export const V4_SPLIT: ReadonlyArray<readonly V4SectionKey[]> = [
  ['cover', 'partner', 'you', 'plan'],
  ['communication', 'friction'],
  ['overview', 'attraction', 'future', 'calendar'],
];

/**
 * Output ceilings: the plan measured about 900 tokens and each section call
 * up to about 2,300. The ceilings leave room without letting a runaway reply
 * eat the 60 s per-call budget.
 */
const V4_MAX_TOKENS = { plan: 1500, sections: 3500 } as const;

export function generateCompatibilityV4Plan(prompt: string, options: V4PartOptions<V4InsightPlan>) {
  return generateValidatedCompatibilityJson(
    `${prompt}\n${V4_PLAN_SHAPE}`,
    options.pairCheck ? V4InsightPlanSchema.superRefine(options.pairCheck) : V4InsightPlanSchema,
    V4_MAX_TOKENS.plan,
    describeInvalid,
    options.onModelCall,
    options.softCheck,
    2,
  );
}

export function generateCompatibilityV4Sections(
  prompt: string,
  sections: readonly V4SectionKey[],
  options: V4PartOptions<Partial<V4Sections>>,
) {
  const mask: Partial<Record<V4SectionKey, true>> = Object.fromEntries(sections.map((key) => [key, true]));
  const schema: z.ZodType<Partial<V4Sections>> = V4AllSectionsSchema.pick(mask);
  return generateValidatedCompatibilityJson(
    `${prompt}\n${v4Shape(sections)}`,
    options.pairCheck ? schema.superRefine(options.pairCheck) : schema,
    V4_MAX_TOKENS.sections,
    describeInvalid,
    options.onModelCall,
    options.softCheck,
    2,
  );
}

const TEASER_SHAPE = `
Return valid JSON matching exactly this shape (all fields required):
{
  "threeWay": string,
  "reading": string
}
threeWay: ประโยคสั้นหนึ่งประโยค ไม่เกินประมาณ 15 คำ อ่านจบในหนึ่งลมหายใจ. reading: ประมาณ 2 ประโยค ไม่ยาวเกินไป.
Do not include markdown or any text outside this JSON object.`;

/**
 * Bounds are deliberately wide relative to the prompt's "one short sentence" /
 * "about 2 sentences" targets: the model cannot measure JS string length, and
 * Thai vowel/tone marks each count as their own UTF-16 code unit, so a request
 * for "~90 characters" in the prompt can measure well over 200 in .length.
 * These bounds are calibrated to what real DeepSeek output measures.
 *
 * threeWay's max was tightened from 160 to 120: threeWay renders as a mobile
 * hero line, and observed outputs before the ~15-word prompt guidance ran
 * 52-132 characters — several 100+ wrapped to ~5 lines at heading size. The
 * prompt now asks for one short, single-breath sentence (~15 words); 120
 * keeps headroom above the accepted ~54-62 range without allowing a reply
 * long enough to wrap that badly.
 */
const TeaserContentSchema = z.object({
  threeWay: z.string().min(10).max(120),
  reading: z.string().min(60).max(320),
});

export type TeaserContent = z.infer<typeof TeaserContentSchema>;

/**
 * Generate the teaser v2 narrative (threeWay + reading) using DeepSeek's JSON
 * mode. Same pattern as generateStructuredCompatibilityReading: JSON mode,
 * zod validation, one validation retry, a few transport retries — but the
 * teaser sits before auth on a shared-IP rate limit, so attempts stay short
 * enough that the whole call fits inside the route's single-flight lock.
 *
 * `userName` guards a single, cheap-to-check copy rule: threeWay must not
 * open with the user's own name (the reading already does that).
 */
export async function generateTeaserReading(
  prompt: string,
  userName: string,
  onModelCall?: OnModelCall,
): Promise<TeaserContent> {
  let effectivePrompt = `${prompt}\n${TEASER_SHAPE}`;
  let validationRetryUsed = false;
  let transportFailures = 0;

  while (true) {
    let text: string;
    try {
      onModelCall?.();
      text = await callDeepSeek(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: effectivePrompt },
        ],
        {
          maxTokens: 600,
          temperature: 0.8,
          timeoutMs: 15_000,
          jsonMode: true,
        },
      );
    } catch (error) {
      if (!isRetryableError(error) || transportFailures >= 1) throw error;
      transportFailures += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const result = TeaserContentSchema.safeParse(parsed);
      if (result.success && !result.data.threeWay.trimStart().startsWith(userName)) {
        return result.data;
      }

      if (validationRetryUsed) {
        throw new Error(
          result.success
            ? "threeWay started with the user's name"
            : `Invalid teaser JSON: ${result.error.message}`,
        );
      }
      validationRetryUsed = true;
      effectivePrompt = `${effectivePrompt}\n\nYour previous response did not match the required fields, length limits, or started threeWay with the user's name ("${userName}"). Return valid JSON with both fields, following every rule.`;
    } catch (error) {
      if (validationRetryUsed) throw error;
      validationRetryUsed = true;
      effectivePrompt = `${effectivePrompt}\n\nYour previous response was not valid JSON. Return only the complete JSON object.`;
    }
  }
}

/**
 * Minimal structural validator: checks that every required field (from the
 * source Gemini responseSchema) is present. DeepSeek has no server-side
 * schema enforcement (only response_format: json_object), so this is the
 * substitute for Gemini's responseSchema validation.
 * Returns a human-readable error string, or null if valid.
 */
function findMissingFields(obj: Record<string, unknown>, requiredFields: string[]): string[] {
  return requiredFields.filter((field) => !(field in obj));
}

/**
 * Exported for tests: a generation missing a required per-category field (such
 * as the hook) must trigger the validation retry rather than reaching the DB.
 */
export function validateStructuredFortuneReading(data: Record<string, unknown>): string | null {
  const requiredTop = [
    "personalityTraits",
    "pillarInterpretations",
    "birthStarDetails",
    "fortuneReadings",
    "recommendations",
  ];
  const missing = findMissingFields(data, requiredTop);

  if (Array.isArray(data.pillarInterpretations)) {
    (data.pillarInterpretations as unknown[]).forEach((item, i) => {
      if (typeof item !== "object" || item === null) {
        missing.push(`pillarInterpretations[${i}]`);
        return;
      }
      for (const field of ["pillarKey", "interpretation", "pillarRelationships", "summary", "tips", "warning"]) {
        if (!(field in (item as object))) missing.push(`pillarInterpretations[${i}].${field}`);
      }
    });
  }

  if (typeof data.birthStarDetails === "object" && data.birthStarDetails !== null) {
    for (const field of [
      "planetDescription",
      "luckyColorTooltip",
      "luckyNumberTooltip",
      "luckyDirectionTooltip",
      "luckyDayTooltip",
    ]) {
      if (!(field in (data.birthStarDetails as object))) {
        missing.push(`birthStarDetails.${field}`);
      }
    }
  }

  if (Array.isArray(data.fortuneReadings)) {
    (data.fortuneReadings as unknown[]).forEach((item, i) => {
      if (typeof item !== "object" || item === null) {
        missing.push(`fortuneReadings[${i}]`);
        return;
      }
      for (const field of ["key", "score", "hook", "reading", "tips", "warnings"]) {
        if (!(field in (item as object))) missing.push(`fortuneReadings[${i}].${field}`);
      }
    });
  }

  if (typeof data.recommendations === "object" && data.recommendations !== null) {
    const rec = data.recommendations as Record<string, unknown>;
    for (const field of [
      "luckyColors",
      "luckyNumbers",
      "luckyDirection",
      "luckyDay",
      "monthlyHighlights",
      "dos",
      "donts",
    ]) {
      if (!(field in rec)) missing.push(`recommendations.${field}`);
    }
    if (Array.isArray(rec.monthlyHighlights)) {
      (rec.monthlyHighlights as unknown[]).forEach((item, i) => {
        if (typeof item !== "object" || item === null) {
          missing.push(`recommendations.monthlyHighlights[${i}]`);
          return;
        }
        for (const field of ["month", "rating", "note", "description"]) {
          if (!(field in (item as object))) {
            missing.push(`recommendations.monthlyHighlights[${i}].${field}`);
          }
        }
      });
    }
  }

  return missing.length > 0 ? `Missing required fields: ${missing.join(", ")}` : null;
}

/**
 * Fields the validator asks for but the schema marks optional and the frontend
 * renders a fallback for: the reading hooks and the pillar summary/tips/warning.
 * Missing them is worth ONE retry, not a failed generation.
 */
const SOFT_FIELD_RE = /^(fortuneReadings\[\d+\]\.hook|pillarInterpretations\[\d+\]\.(summary|tips|warning))$/;

/** True when every field named in a validator message is a soft field. */
export function isSoftValidationError(message: string): boolean {
  const prefix = "Missing required fields: ";
  if (!message.startsWith(prefix)) return false;
  const fields = message.slice(prefix.length).split(", ").map((f) => f.trim()).filter(Boolean);
  return fields.length > 0 && fields.every((f) => SOFT_FIELD_RE.test(f));
}

/** Shape description appended to the prompt so DeepSeek's json_object mode
 * (which has no server-side schema enforcement, unlike Gemini's responseSchema)
 * knows exactly what to produce. Faithful translation of gemini.ts's responseSchema. */
const STRUCTURED_FORTUNE_SHAPE = `
Return valid JSON matching exactly this shape (all fields required):
{
  "personalityTraits": string[],
  "pillarInterpretations": [
    { "pillarKey": string, "interpretation": string, "pillarRelationships": string, "summary": string (one sentence, max 60 Thai characters, what this pillar means for the reader), "tips": string[] (2 items, max 60 Thai characters each, concrete actions), "warning": string (one heads-up, max 120 Thai characters, a friend's tone not a threat) }
  ],
  "birthStarDetails": {
    "planetDescription": string,
    "luckyColorTooltip": string,
    "luckyNumberTooltip": string,
    "luckyDirectionTooltip": string,
    "luckyDayTooltip": string
  },
  "fortuneReadings": [
    { "key": string, "score": integer (0-100, provided; copy it exactly), "hook": string (one short line, max 40 Thai characters, previews the category for the reading month), "reading": string, "tips": string[], "warnings": string[] }
  ],
  "recommendations": {
    "luckyColors": string[],
    "luckyNumbers": integer[],
    "luckyDirection": string,
    "luckyDay": string,
    "monthlyHighlights": [
      { "month": string, "rating": integer, "note": string, "description": string, "highlights": string[], "advice": string, "warning": string }
    ],
    "dos": string[],
    "donts": string[]
  }
}
Do not include any text outside this JSON object.`;

/**
 * Generate a structured fortune reading using DeepSeek's JSON mode.
 * DeepSeek only offers response_format: json_object (no server-side schema
 * enforcement like Gemini's responseSchema), so the shape is described in
 * the prompt and validated locally after parsing.
 *
 * Retry policy: transport failures retry up to `maxRetries` (2, same as
 * gemini.ts). Parse/validation failures get exactly ONE additional retry
 * with the validation error appended to the prompt, per spec.
 */
export async function generateStructuredFortuneReading(
  prompt: string,
  systemPrompt: string,
): Promise<Record<string, unknown>> {
  const maxRetries = 2;
  let lastError: Error | null = null;
  let effectivePrompt = `${prompt}\n${STRUCTURED_FORTUNE_SHAPE}`;
  let usedValidationRetry = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: effectivePrompt },
      ];

      const text = await callDeepSeek(messages, {
        maxTokens: 8000,
        temperature: 0.75,
        // See generation-budget.ts: three attempts have to fit one 255s socket,
        // so 180s here put the ladder at 543s and made attempts 2 and 3
        // undeliverable rather than slow.
        timeoutMs: CHART_BUDGET.perAttemptMs,
        jsonMode: true,
      });

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        if (!usedValidationRetry) {
          usedValidationRetry = true;
          effectivePrompt = `${effectivePrompt}\n\nYour previous response was not valid JSON (${
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          }). Return ONLY valid JSON, no markdown fences, no extra text.`;
          continue;
        }
        throw new Error("Structured reading was not valid JSON after retry");
      }

      const validationError = validateStructuredFortuneReading(parsed);
      if (validationError) {
        if (!usedValidationRetry) {
          usedValidationRetry = true;
          effectivePrompt = `${effectivePrompt}\n\nYour previous response was invalid: ${validationError}. Return the complete JSON object with all required fields.`;
          continue;
        }
        // Second miss. If only optional-in-schema fields are absent, ship the
        // reading: the frontend falls back for each of them, and failing the
        // whole chart over a missing hook would show the user an error.
        if (isSoftValidationError(validationError)) {
          console.warn(`[DeepSeek] Accepting structured reading with soft fields missing after retry: ${validationError}`);
          return parsed;
        }
        throw new Error(`Structured reading failed validation after retry: ${validationError}`);
      }

      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[DeepSeek] Structured generation attempt ${attempt + 1}/${maxRetries + 1} failed:`,
        lastError.message
      );

      if (!isRetryableError(error)) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        // Brief delay before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw new Error(
    `Failed to generate structured fortune reading after ${maxRetries + 1} attempts: ${lastError?.message}`
  );
}

function validateEnhancedDailyReading(data: Record<string, unknown>): string | null {
  const missing = findMissingFields(data, [
    "themeKey",
    "focusKey",
    "actionTags",
    "dailyTheme",
    "hookLine",
    "overallScore",
    "overallReading",
    "categories",
    "luckyNumbers",
    "luckyColor",
    "luckyDirection",
    "luckyMoment",
    "warnings",
    "dos",
    "donts",
  ]);

  if (typeof data.themeKey !== "string" || data.themeKey.length === 0) {
    missing.push("themeKey(valid string)");
  }
  if (!["career", "love", "finance", "health"].includes(String(data.focusKey))) {
    missing.push("focusKey(valid category)");
  }
  if (
    !Array.isArray(data.actionTags)
    || data.actionTags.length !== 2
    || data.actionTags.some((tag) => typeof tag !== "string")
  ) {
    missing.push("actionTags(exactly 2 strings)");
  }
  if (typeof data.hookLine !== "string" || data.hookLine.length === 0) {
    missing.push("hookLine(valid string)");
  }

  if (typeof data.categories === "object" && data.categories !== null) {
    const categories = data.categories as Record<string, unknown>;
    for (const key of ["career", "love", "finance", "health"]) {
      if (!(key in categories)) {
        missing.push(`categories.${key}`);
        continue;
      }
      const cat = categories[key];
      if (typeof cat !== "object" || cat === null) {
        missing.push(`categories.${key}`);
        continue;
      }
      for (const field of ["reading", "score", "tip"]) {
        if (!(field in (cat as object))) missing.push(`categories.${key}.${field}`);
      }
    }
  }

  return missing.length > 0 ? `Missing required fields: ${missing.join(", ")}` : null;
}

const STRUCTURED_ENHANCED_DAILY_SHAPE = `
Return valid JSON matching exactly this shape (all fields required):
{
  "themeKey": string,
  "focusKey": "career" | "love" | "finance" | "health",
  "actionTags": string[],
  "dailyTheme": string,
  "hookLine": string,
  "overallScore": integer (0-100),
  "overallReading": string,
  "categories": {
    "career": { "reading": string, "score": integer (0-100), "tip": string },
    "love": { "reading": string, "score": integer (0-100), "tip": string },
    "finance": { "reading": string, "score": integer (0-100), "tip": string },
    "health": { "reading": string, "score": integer (0-100), "tip": string }
  },
  "luckyNumbers": integer[],
  "luckyColor": string,
  "luckyDirection": string,
  "luckyMoment": string,
  "warnings": string[],
  "dos": string[],
  "donts": string[]
}
Do not include any text outside this JSON object.`;

/**
 * Generate an enhanced daily reading with MBTI integration using DeepSeek's JSON mode.
 * Extended schema includes a shareable hook, novelty metadata, lucky attributes,
 * warnings, and actions.
 */
export async function generateEnhancedDailyReading(
  prompt: string,
  systemPrompt: string,
): Promise<Record<string, unknown>> {
  const maxRetries = 2;
  let lastError: Error | null = null;
  let effectivePrompt = `${prompt}\n${STRUCTURED_ENHANCED_DAILY_SHAPE}`;
  let usedValidationRetry = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: effectivePrompt },
      ];

      const text = await callDeepSeek(messages, {
        maxTokens: 3000,
        temperature: 0.75,
        // The v2 daily contract is deliberately compact, while retaining
        // enough headroom for Thai tokenization and valid closing JSON.
        //
        // Budgets live in lib/shared/types/generation-budget.ts, which derives
        // them from the socket ceiling and is asserted by tests. Restating a
        // number here is what let the client timeout and the loading screen's
        // escape hatch drift out of agreement with it.
        timeoutMs: DAILY_BUDGET.perAttemptMs,
        jsonMode: true,
      });

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        if (!usedValidationRetry) {
          usedValidationRetry = true;
          effectivePrompt = `${effectivePrompt}\n\nYour previous response was not valid JSON (${
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          }). Return ONLY valid JSON, no markdown fences, no extra text.`;
          continue;
        }
        throw new Error("Empty response from DeepSeek");
      }

      const validationError = validateEnhancedDailyReading(parsed);
      if (validationError) {
        if (!usedValidationRetry) {
          usedValidationRetry = true;
          effectivePrompt = `${effectivePrompt}\n\nYour previous response was invalid: ${validationError}. Return the complete JSON object with all required fields.`;
          continue;
        }
        throw new Error("Empty response from DeepSeek");
      }

      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[DeepSeek] Enhanced daily generation attempt ${attempt + 1}/${maxRetries + 1} failed:`,
        lastError.message
      );

      if (!isRetryableError(error)) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw new Error(
    `Failed to generate enhanced daily reading after ${maxRetries + 1} attempts: ${lastError?.message}`
  );
}
