import { z } from "zod";

import { completeJSON } from "./llm";

const Schema = z.object({ ok: z.boolean() });

/**
 * Mocks global.fetch to verify completeJSON's NEW dispatch branch: when
 * anthropicApiKey is provided, it must call the Anthropic Messages API
 * directly with that key, and must NOT fall through to the LLM_PROVIDER
 * dispatch (callClaudeCli/OpenAI). No real network call happens.
 *
 * The "omitting anthropicApiKey preserves existing behavior" half of this
 * requirement is verified separately by re-running the existing
 * test:suggest-keywords / test:import-master-resume scripts unchanged —
 * their code path (LLM_PROVIDER dispatch) is untouched by this task, so
 * those passing is the regression check for the omitted case.
 */
async function main() {
  const originalFetch = global.fetch;
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};

  global.fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    return {
      ok: true,
      json: async () => ({ content: [{ type: "text", text: '{"ok": true}' }] }),
    } as Response;
  }) as typeof fetch;

  let result: { ok: boolean } | null = null;
  let threw: unknown = null;
  try {
    result = await completeJSON(Schema, {
      system: "test system",
      user: "test user",
      anthropicApiKey: "sk-ant-test-key-not-real",
    });
  } catch (err) {
    threw = err;
  } finally {
    global.fetch = originalFetch;
  }

  const calledAnthropicDirectly = capturedUrl === "https://api.anthropic.com/v1/messages";
  const sentTheProvidedKey = capturedHeaders["x-api-key"] === "sk-ant-test-key-not-real";
  const parsedCorrectly = result?.ok === true;

  console.log(`called Anthropic API directly: ${calledAnthropicDirectly} (url: ${capturedUrl})`);
  console.log(`sent the provided key: ${sentTheProvidedKey}`);
  console.log(`parsed response correctly: ${parsedCorrectly}`);
  if (threw) console.log(`unexpected throw: ${threw}`);

  const pass = calledAnthropicDirectly && sentTheProvidedKey && parsedCorrectly && !threw;
  console.log(pass ? "\n✓ anthropic-key-path test PASSED" : "\n✗ anthropic-key-path test FAILED");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
