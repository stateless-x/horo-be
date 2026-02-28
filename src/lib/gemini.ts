import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { config } from "../config";
import { SYSTEM_PROMPT } from "./prompts";

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

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
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.8, // Slightly higher for more creative/mystical responses
    },
  });

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  if (!text) {
    throw new Error("Empty response from Gemini");
  }

  return text;
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
    type: SchemaType.OBJECT,
    properties: {
      personalityTraits: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
      },
      pillarInterpretations: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            pillarKey: { type: SchemaType.STRING },
            interpretation: { type: SchemaType.STRING },
            pillarRelationships: { type: SchemaType.STRING },
          },
          required: ["pillarKey", "interpretation", "pillarRelationships"],
        },
      },
      birthStarDetails: {
        type: SchemaType.OBJECT,
        properties: {
          planetDescription: { type: SchemaType.STRING },
          luckyColorTooltip: { type: SchemaType.STRING },
          luckyNumberTooltip: { type: SchemaType.STRING },
          luckyDirectionTooltip: { type: SchemaType.STRING },
          luckyDayTooltip: { type: SchemaType.STRING },
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
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            key: { type: SchemaType.STRING },
            score: { type: SchemaType.INTEGER },
            reading: { type: SchemaType.STRING },
            tips: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
            warnings: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
          },
          required: ["key", "score", "reading", "tips", "warnings"],
        },
      },
      recommendations: {
        type: SchemaType.OBJECT,
        properties: {
          luckyColors: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
          },
          luckyNumbers: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.INTEGER },
          },
          luckyDirection: { type: SchemaType.STRING },
          luckyDay: { type: SchemaType.STRING },
          monthlyHighlights: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                month: { type: SchemaType.STRING },
                rating: { type: SchemaType.INTEGER },
                note: { type: SchemaType.STRING },
              },
              required: ["month", "rating", "note"],
            },
          },
          dos: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
          },
          donts: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
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

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: 8000,
      temperature: 0.75,
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();

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
    type: SchemaType.OBJECT,
    properties: {
      overallReading: { type: SchemaType.STRING },
      categories: {
        type: SchemaType.OBJECT,
        properties: {
          career: {
            type: SchemaType.OBJECT,
            properties: {
              reading: { type: SchemaType.STRING },
              score: { type: SchemaType.INTEGER },
              tip: { type: SchemaType.STRING },
            },
            required: ["reading", "score", "tip"],
          },
          love: {
            type: SchemaType.OBJECT,
            properties: {
              reading: { type: SchemaType.STRING },
              score: { type: SchemaType.INTEGER },
              tip: { type: SchemaType.STRING },
            },
            required: ["reading", "score", "tip"],
          },
          finance: {
            type: SchemaType.OBJECT,
            properties: {
              reading: { type: SchemaType.STRING },
              score: { type: SchemaType.INTEGER },
              tip: { type: SchemaType.STRING },
            },
            required: ["reading", "score", "tip"],
          },
          health: {
            type: SchemaType.OBJECT,
            properties: {
              reading: { type: SchemaType.STRING },
              score: { type: SchemaType.INTEGER },
              tip: { type: SchemaType.STRING },
            },
            required: ["reading", "score", "tip"],
          },
        },
        required: ["career", "love", "finance", "health"],
      },
      dos: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
      },
      donts: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
      },
      luckyMoment: { type: SchemaType.STRING },
    },
    required: ["overallReading", "categories", "dos", "donts", "luckyMoment"],
  };

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: 3000,
      temperature: 0.8,
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();

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

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw new Error(
    `Failed to generate structured daily reading after ${maxRetries + 1} attempts: ${lastError?.message}`
  );
}
