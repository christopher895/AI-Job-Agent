import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
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

const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH || "claude";
// A hung/stalled claude CLI call (e.g. waiting on a prompt that can never be
// answered headlessly) must not block a request forever with no feedback —
// bound it well above normal latency (the UI's own copy says "~30s") and
// fail loudly instead.
const DEFAULT_TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS) || 120_000;

/** Impure: spawns `claude`, writes `input` to stdin, resolves stdout or rejects. */
function runClaudeCliProcess(args: string[], cwd: string, input: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms and was killed`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    // Prevent an EPIPE (or other write error) on stdin from throwing as an
    // uncaught exception, which would crash the whole process. The real
    // diagnostic/rejection is produced by the `error`/`close` handlers below;
    // this listener's only job is to swallow the stdin-specific error event.
    child.stdin.on("error", () => {});
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${(stderr || stdout).slice(0, 1000)}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Calls `claude -p` for one structured-output turn. Runs from a fresh scratch
 * directory so Claude Code doesn't auto-load this repo's CLAUDE.md/memory/
 * skills into every call, which otherwise inflates token usage substantially
 * (--bare isn't usable here since it requires ANTHROPIC_API_KEY and ignores
 * CLAUDE_CODE_OAUTH_TOKEN).
 */
export async function callClaudeCli(
  schema: z.ZodTypeAny,
  opts: { system: string; user: string; model?: string }
): Promise<unknown> {
  const args = buildClaudeCliArgs(schema, { system: opts.system, model: opts.model });
  const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-cli-"));
  try {
    const stdout = await runClaudeCliProcess(args, scratchDir, opts.user);
    return parseClaudeCliOutput(stdout);
  } finally {
    await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  }
}
