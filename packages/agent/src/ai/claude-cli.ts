import { z } from "zod";
import { zodToJsonSchema as zodToJsonSchemaImpl } from "zod-to-json-schema";

/**
 * Headless `claude -p` backend for completeJSON(), authenticated via
 * CLAUDE_CODE_OAUTH_TOKEN (subscription usage, not metered API billing).
 * See docs/superpowers/specs/2026-07-02-claude-headless-tailoring-design.md.
 */

const STDIN_INSTRUCTION = "Follow the system prompt using the content provided on stdin.";

/**
 * zod-to-json-schema's exported type signature recurses through zod's
 * generic ZodType structure deeply enough to hit TS2589 ("Type
 * instantiation is excessively deep and possibly infinite") under
 * zod 3.25.x + strict mode, even for trivial schemas. The function's
 * *runtime* behavior is unaffected; we just widen its type once, here,
 * to stop TS from re-deriving the deep conditional return type on every
 * call site.
 */
const zodToJsonSchema = zodToJsonSchemaImpl as unknown as (
  schema: z.ZodTypeAny,
  options?: unknown
) => Record<string, unknown>;

/** Pure: builds the `claude` CLI argv (excluding the binary path itself). */
export function buildClaudeCliArgs(schema: z.ZodTypeAny, opts: { system: string; model?: string }): string[] {
  const jsonSchema = zodToJsonSchema(schema);
  const args = [
    "-p",
    STDIN_INSTRUCTION,
    "--system-prompt",
    opts.system,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(jsonSchema),
  ];
  if (opts.model) args.push("--model", opts.model);
  return args;
}

type ClaudeCliResponse = {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
};

/** Pure: parses the CLI's raw stdout, or throws a descriptive Error. */
export function parseClaudeCliOutput(stdout: string): unknown {
  let response: ClaudeCliResponse;
  try {
    response = JSON.parse(stdout);
  } catch {
    throw new Error(`claude CLI returned non-JSON output: ${stdout.slice(0, 500)}`);
  }
  if (response.is_error) {
    throw new Error(`claude CLI returned an error: ${response.result ?? "unknown error"}`);
  }
  if (response.structured_output === undefined) {
    throw new Error("claude CLI response had no structured_output field");
  }
  return response.structured_output;
}
