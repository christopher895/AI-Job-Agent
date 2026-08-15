import OpenAI from "openai";
import { z } from "zod";
import { callClaudeCli } from "./claude-cli";
import { CancelledError, isCancelledError } from "./cancellation";

/**
 * Shared LLM helper. Returns JSON validated against a Zod schema, with a
 * self-correcting retry (the validation error is fed back to the model).
 * Reused by the tailorer, critic, and scorer. Dispatches on LLM_PROVIDER:
 * "claude" (default) — headless `claude -p`, authenticated via
 *   CLAUDE_CODE_OAUTH_TOKEN, subscription usage not metered API billing.
 * "openai" — manual fallback, metered API billing.
 * See docs/superpowers/specs/2026-07-02-claude-headless-tailoring-design.md.
 */

export const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? "claude") as "claude" | "openai";

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

async function callOpenAIOnce(
  system: string,
  user: string,
  model: string,
  temperature: number,
  signal?: AbortSignal
): Promise<string> {
  const res = await client().chat.completions.create(
    {
      model,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    { signal }
  );
  return res.choices[0]?.message?.content ?? "";
}

// Bring-your-own-key path only (the playground). The raw API takes model ids,
// not the CLI's tier aliases, so this one is pinned and needs bumping by hand.
const ANTHROPIC_MODEL = "claude-opus-5";

async function callAnthropicWithKey(
  system: string,
  user: string,
  apiKey: string,
  temperature: number
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Anthropic API response had no text content");
  }
  return textBlock.text;
}

export async function completeJSON<T>(
  // `any` for the input type so schemas using `.default()` (output ≠ input) infer T as the output.
  schema: z.ZodType<T, z.ZodTypeDef, any>,
  opts: {
    system: string;
    user: string;
    model?: string;
    temperature?: number;
    maxRetries?: number;
    /** When set, calls Anthropic's API directly with this key instead of the
     *  server's own LLM_PROVIDER dispatch — used only by the public playground,
     *  where the visitor brings their own key. Omit for every other call site. */
    anthropicApiKey?: string;
    /** Aborts the in-flight provider call AND the retry loop — see ai/cancellation.ts. */
    signal?: AbortSignal;
  }
): Promise<T> {
  const { system, user, model, temperature = 0.4, maxRetries = 2, anthropicApiKey, signal } = opts;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Checked per attempt, not just once up front: without this a cancel that
    // lands mid-call would kill attempt 1 and then immediately start attempt 2.
    if (signal?.aborted) throw new CancelledError();

    const userContent =
      attempt === 0
        ? user
        : `${user}\n\nYour previous reply failed validation: ${lastError}\nReturn ONLY valid JSON matching the requested schema.`;

    const startedAt = Date.now();
    try {
      const parsed = anthropicApiKey
        ? JSON.parse(await callAnthropicWithKey(system, userContent, anthropicApiKey, temperature))
        : LLM_PROVIDER === "openai"
          ? JSON.parse(await callOpenAIOnce(system, userContent, model ?? DEFAULT_MODEL, temperature, signal))
          // Model resolution (explicit → CLAUDE_MODEL → "opus" alias) lives in
          // claude-cli.ts so every caller of that path gets the same default.
          : await callClaudeCli(schema, { system, user: userContent, model, signal });
      const provider = anthropicApiKey ? "anthropic-key" : LLM_PROVIDER;
      console.log(`[llm] provider=${provider} attempt=${attempt + 1} ok in ${Date.now() - startedAt}ms`);
      return schema.parse(parsed);
    } catch (err) {
      // A cancel is not a validation failure — never feed it back for a retry.
      if (isCancelledError(err) || signal?.aborted) throw new CancelledError();
      const provider = anthropicApiKey ? "anthropic-key" : LLM_PROVIDER;
      console.log(`[llm] provider=${provider} attempt=${attempt + 1} FAILED in ${Date.now() - startedAt}ms`);
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`LLM JSON failed validation after ${maxRetries + 1} attempts: ${lastError}`);
}
