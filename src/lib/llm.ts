import { config } from "../config";
import { SYSTEM_PROMPT } from "./prompts";
import {
  CompatibilityStructuredContentSchema,
  type CompatibilityStructuredContent,
} from "../../lib/shared";

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
  role: "system" | "user";
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
  "advice": string
}
Do not include the score, markdown, or any text outside this JSON object.`;

/** Generate the compact narrative portion of compatibility v2. */
export async function generateStructuredCompatibilityReading(
  prompt: string,
  maxTokens: number = 1000,
): Promise<Pick<
  CompatibilityStructuredContent,
  'verdict' | 'chemistry' | 'caution' | 'advice'
>> {
  let effectivePrompt = `${prompt}\n${STRUCTURED_COMPATIBILITY_SHAPE}`;
  let validationRetryUsed = false;
  let transportFailures = 0;

  while (true) {
    let text: string;
    try {
      text = await callDeepSeek(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: effectivePrompt },
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
      const result = CompatibilityStructuredContentSchema.pick({
        verdict: true,
        chemistry: true,
        caution: true,
        advice: true,
      }).safeParse(parsed);
      if (result.success) return result.data;

      if (validationRetryUsed) throw new Error(`Invalid compatibility JSON: ${result.error.message}`);
      validationRetryUsed = true;
      effectivePrompt = `${effectivePrompt}\n\nYour previous response did not match the required fields or length limits. Return all four fields as valid JSON.`;
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

function validateStructuredFortuneReading(data: Record<string, unknown>): string | null {
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
      for (const field of ["pillarKey", "interpretation", "pillarRelationships"]) {
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
      for (const field of ["key", "score", "reading", "tips", "warnings"]) {
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

/** Shape description appended to the prompt so DeepSeek's json_object mode
 * (which has no server-side schema enforcement, unlike Gemini's responseSchema)
 * knows exactly what to produce. Faithful translation of gemini.ts's responseSchema. */
const STRUCTURED_FORTUNE_SHAPE = `
Return valid JSON matching exactly this shape (all fields required):
{
  "personalityTraits": string[],
  "pillarInterpretations": [
    { "pillarKey": string, "interpretation": string, "pillarRelationships": string }
  ],
  "birthStarDetails": {
    "planetDescription": string,
    "luckyColorTooltip": string,
    "luckyNumberTooltip": string,
    "luckyDirectionTooltip": string,
    "luckyDayTooltip": string
  },
  "fortuneReadings": [
    { "key": string, "score": integer (0-100, provided; copy it exactly), "reading": string, "tips": string[], "warnings": string[] }
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
        // Structured chart responses run 3-5k output tokens; DeepSeek streams
        // ~25-60 tok/s, so anything under ~2min guarantees an abort mid-generation.
        timeoutMs: 180_000,
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

      const validationError = validateStructuredFortuneReading(parsed);
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
        timeoutMs: 120_000,
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
