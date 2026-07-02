import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Headless `claude -p` backend for completeJSON(), authenticated via
 * CLAUDE_CODE_OAUTH_TOKEN (subscription usage, not metered API billing).
 * See docs/superpowers/specs/2026-07-02-claude-headless-tailoring-design.md.
 */

const STDIN_INSTRUCTION = "Follow the system prompt using the content provided on stdin.";

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
