import { GoogleGenAI } from "@google/genai";
import { config } from "../config";
import { SYSTEM_PROMPT } from "./prompts";

const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

/**
 * Check if a Gemini error is worth retrying.
 * Billing/quota/auth errors fail fast — retrying won't help.
 */
function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('RESOURCE_EXHAUSTED') || message.includes('spending cap')) return false;
  if (message.includes('PERMISSION_DENIED') || message.includes('403')) return false;
  if (message.includes('INVALID_ARGUMENT') || message.includes('400')) return false;
  return true;
}

/**
 * Generate a fortune reading using Gemini 2.5 Flash
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

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          maxOutputTokens: maxTokens,
          temperature: 0.8,
          thinkingConfig: {
            thinkingBudget: 0, // Disable thinking — creative writing, not reasoning
          },
          httpOptions: {
            timeout: timeoutMs,
          },
        },
      });

      const text = response.text;

      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      return text;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[Gemini] Fortune reading attempt ${attempt + 1}/${maxRetries + 1} failed:`,
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

/**
 * Generate a structured fortune reading using Gemini's JSON mode.
 * Uses responseMimeType: "application/json" with a responseSchema
 * to ensure reliable structured output.
 *
 * Includes retry logic (max 2 retries) if JSON parsing fails.
 */
export async function generateStructuredFortuneReading(
  prompt: string,
  systemPrompt: string,
): Promise<Record<string, unknown>> {
  const responseSchema = {
    type: "object" as const,
    properties: {
      personalityTraits: {
        type: "array" as const,
        items: { type: "string" as const },
      },
      pillarInterpretations: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            pillarKey: { type: "string" as const },
            interpretation: { type: "string" as const },
            pillarRelationships: { type: "string" as const },
          },
          required: ["pillarKey", "interpretation", "pillarRelationships"],
        },
      },
      birthStarDetails: {
        type: "object" as const,
        properties: {
          planetDescription: { type: "string" as const },
          luckyColorTooltip: { type: "string" as const },
          luckyNumberTooltip: { type: "string" as const },
          luckyDirectionTooltip: { type: "string" as const },
          luckyDayTooltip: { type: "string" as const },
        },
        required: [
          "planetDescription",
          "luckyColorTooltip",
          "luckyNumberTooltip",
          "luckyDirectionTooltip",
          "luckyDayTooltip",
        ],
      },
      fortuneReadings: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            key: { type: "string" as const },
            score: { type: "integer" as const },
            reading: { type: "string" as const },
            tips: {
              type: "array" as const,
              items: { type: "string" as const },
            },
            warnings: {
              type: "array" as const,
              items: { type: "string" as const },
            },
          },
          required: ["key", "score", "reading", "tips", "warnings"],
        },
      },
      recommendations: {
        type: "object" as const,
        properties: {
          luckyColors: {
            type: "array" as const,
            items: { type: "string" as const },
          },
          luckyNumbers: {
            type: "array" as const,
            items: { type: "integer" as const },
          },
          luckyDirection: { type: "string" as const },
          luckyDay: { type: "string" as const },
          monthlyHighlights: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                month: { type: "string" as const },
                rating: { type: "integer" as const },
                note: { type: "string" as const },
              },
              required: ["month", "rating", "note"],
            },
          },
          dos: {
            type: "array" as const,
            items: { type: "string" as const },
          },
          donts: {
            type: "array" as const,
            items: { type: "string" as const },
          },
        },
        required: [
          "luckyColors",
          "luckyNumbers",
          "luckyDirection",
          "luckyDay",
          "monthlyHighlights",
          "dos",
          "donts",
        ],
      },
    },
    required: [
      "personalityTraits",
      "pillarInterpretations",
      "birthStarDetails",
      "fortuneReadings",
      "recommendations",
    ],
  };

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 8000,
          temperature: 0.75,
          responseMimeType: "application/json",
          responseSchema,
          thinkingConfig: {
            thinkingBudget: 0, // Disable thinking — creative writing, not reasoning
          },
          httpOptions: {
            timeout: 30_000, // 30s timeout for large structured output (8000 tokens)
          },
        },
      });

      const text = response.text;

      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      return JSON.parse(text);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[Gemini] Structured generation attempt ${attempt + 1}/${maxRetries + 1} failed:`,
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

/**
 * Generate a structured daily reading using Gemini's JSON mode.
 * Lighter schema than the full chart - focused on today's fortune only.
 */
export async function generateStructuredDailyReading(
  prompt: string,
  systemPrompt: string,
): Promise<Record<string, unknown>> {
  const responseSchema = {
    type: "object" as const,
    properties: {
      overallReading: { type: "string" as const },
      categories: {
        type: "object" as const,
        properties: {
          career: {
            type: "object" as const,
            properties: {
              reading: { type: "string" as const },
              score: { type: "integer" as const },
              tip: { type: "string" as const },
            },
            required: ["reading", "score", "tip"],
          },
          love: {
            type: "object" as const,
            properties: {
              reading: { type: "string" as const },
              score: { type: "integer" as const },
              tip: { type: "string" as const },
            },
            required: ["reading", "score", "tip"],
          },
          finance: {
            type: "object" as const,
            properties: {
              reading: { type: "string" as const },
              score: { type: "integer" as const },
              tip: { type: "string" as const },
            },
            required: ["reading", "score", "tip"],
          },
          health: {
            type: "object" as const,
            properties: {
              reading: { type: "string" as const },
              score: { type: "integer" as const },
              tip: { type: "string" as const },
            },
            required: ["reading", "score", "tip"],
          },
        },
        required: ["career", "love", "finance", "health"],
      },
      dos: {
        type: "array" as const,
        items: { type: "string" as const },
      },
      donts: {
        type: "array" as const,
        items: { type: "string" as const },
      },
      luckyMoment: { type: "string" as const },
    },
    required: ["overallReading", "categories", "dos", "donts", "luckyMoment"],
  };

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 3000,
          temperature: 0.8,
          responseMimeType: "application/json",
          responseSchema,
          thinkingConfig: {
            thinkingBudget: 0, // Disable thinking — creative writing, not reasoning
          },
          httpOptions: {
            timeout: 25_000, // 25s timeout for daily reading (3000 tokens)
          },
        },
      });

      const text = response.text;

      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      return JSON.parse(text);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[Gemini] Structured daily generation attempt ${attempt + 1}/${maxRetries + 1} failed:`,
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
    `Failed to generate structured daily reading after ${maxRetries + 1} attempts: ${lastError?.message}`
  );
}

/**
 * Generate an enhanced daily reading with MBTI integration using Gemini's JSON mode.
 * Extended schema includes luckyNumbers, luckyColor, warnings, and suggestions.
 */
export async function generateEnhancedDailyReading(
  prompt: string,
  systemPrompt: string,
): Promise<Record<string, unknown>> {
  const categorySchema = {
    type: "object" as const,
    properties: {
      reading: { type: "string" as const },
      score: { type: "integer" as const, minimum: 1, maximum: 5 },
      tip: { type: "string" as const },
    },
    required: ["reading", "score", "tip"],
  };

  const responseSchema = {
    type: "object" as const,
    properties: {
      dailyTheme: { type: "string" as const },
      overallScore: { type: "integer" as const, minimum: 1, maximum: 5 },
      overallReading: { type: "string" as const },
      categories: {
        type: "object" as const,
        properties: {
          career: categorySchema,
          love: categorySchema,
          finance: categorySchema,
          health: categorySchema,
        },
        required: ["career", "love", "finance", "health"],
      },
      luckyNumbers: {
        type: "array" as const,
        items: { type: "integer" as const },
      },
      luckyColor: { type: "string" as const },
      luckyDirection: { type: "string" as const },
      luckyMoment: { type: "string" as const },
      warnings: {
        type: "array" as const,
        items: { type: "string" as const },
      },
      suggestions: {
        type: "array" as const,
        items: { type: "string" as const },
      },
      dos: {
        type: "array" as const,
        items: { type: "string" as const },
      },
      donts: {
        type: "array" as const,
        items: { type: "string" as const },
      },
    },
    required: [
      "dailyTheme", "overallScore", "overallReading", "categories", "luckyNumbers", "luckyColor",
      "luckyDirection", "luckyMoment", "warnings", "suggestions", "dos", "donts",
    ],
  };

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 4000,
          temperature: 0.8,
          responseMimeType: "application/json",
          responseSchema,
          thinkingConfig: {
            thinkingBudget: 0,
          },
          httpOptions: {
            timeout: 25_000,
          },
        },
      });

      const text = response.text;

      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      return JSON.parse(text);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[Gemini] Enhanced daily generation attempt ${attempt + 1}/${maxRetries + 1} failed:`,
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
