import OpenAI from "openai";
import { z } from "zod";

/**
 * Shared OpenAI helper. Returns JSON validated against a Zod schema, with a
 * self-correcting retry (the validation error is fed back to the model).
 * Reused by the tailorer, critic, and scorer.
 */

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set — cannot call the model.");
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

export async function completeJSON<T>(
  // `any` for the input type so schemas using `.default()` (output ≠ input) infer T as the output.
  schema: z.ZodType<T, z.ZodTypeDef, any>,
  opts: {
    system: string;
    user: string;
    model?: string;
    temperature?: number;
    maxRetries?: number;
  }
): Promise<T> {
  const { system, user, model = DEFAULT_MODEL, temperature = 0.4, maxRetries = 2 } = opts;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userContent =
      attempt === 0
        ? user
        : `${user}\n\nYour previous reply failed validation: ${lastError}\nReturn ONLY valid JSON matching the requested schema.`;

    const res = await client().chat.completions.create({
      model,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    });

    const raw = res.choices[0]?.message?.content ?? "";
    try {
      return schema.parse(JSON.parse(raw));
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`LLM JSON failed validation after ${maxRetries + 1} attempts: ${lastError}`);
}
