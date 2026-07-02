# Headless Claude Code as Tailoring LLM Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make headless `claude -p` (authenticated via `CLAUDE_CODE_OAUTH_TOKEN`, subscription usage) the default LLM backend for the résumé-tailoring pipeline, with OpenAI kept as a manual fallback behind an env var.

**Architecture:** `completeJSON()` in `packages/agent/src/ai/llm.ts` is the single seam all three callers (`tailor.ts`, `critic.ts`, `fit-page.ts`) already go through. It grows a provider dispatch (`LLM_PROVIDER` env var, default `"claude"`) with the OpenAI path unchanged and a new Claude path implemented in a dedicated `claude-cli.ts` module that shells out to the `claude` CLI, converts each Zod schema to JSON Schema for `--json-schema`, and validates the result through the same Zod schema before returning — so no caller changes.

**Tech Stack:** TypeScript (strict), Node `child_process.spawn`, Zod, `zod-to-json-schema` (new dependency), the `@anthropic-ai/claude-code` CLI (already installed in the Docker image per PR #40).

## Global Constraints

- Zod is already at `3.25.76` in the lockfile (verified via `package-lock.json`), which satisfies `zod-to-json-schema@^3.25.2`'s peer dependency (`^3.25.28 || ^4`) — no version bump needed.
- No test framework is in use in `packages/agent` — tests are plain `tsx`-run scripts following the `check(label, ok, detail)` + `allPass` + `process.exit(0|1)` convention (see `test-critic.ts`, `test-fetch-jd.ts`). New tests follow this exact convention, not a new framework.
- `tsconfig.json` has `"strict": true` — all new code must type-check under strict mode.
- Live-network test portions skip gracefully when their required credential is absent (established pattern: `test-critic.ts` skips when `OPENAI_API_KEY` is absent), never fail the run.
- `--bare` mode is not usable for the Claude CLI calls in this plan — it requires `ANTHROPIC_API_KEY` and ignores `CLAUDE_CODE_OAUTH_TOKEN` entirely.
- No shell string interpolation for subprocess calls — always pass args as an array (`spawn(bin, argsArray, opts)`), never build a shell command string, since JD/résumé content flows into these calls.

---

### Task 1: Add the `zod-to-json-schema` dependency

**Files:**
- Modify: `packages/agent/package.json`

**Interfaces:**
- Produces: the `zod-to-json-schema` package, importable as `import { zodToJsonSchema } from "zod-to-json-schema"` in later tasks.

- [ ] **Step 1: Add the dependency**

In `packages/agent/package.json`, add to `"dependencies"` (alphabetically, after `"resend"`):

```json
    "resend": "^3.4.0",
    "zod": "^3.23.8",
    "zod-to-json-schema": "^3.25.2"
```

(Note: `"zod": "^3.23.8"` already exists in the file — just add the new line after it, keeping alphabetical order.)

- [ ] **Step 2: Install**

Run: `npm install` (from the repo root — this is an npm workspaces monorepo)
Expected: lockfile updates, `zod-to-json-schema` appears under `packages/agent` in `package-lock.json`, no peer-dependency warnings for `zod-to-json-schema`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json packages/agent/package.json
git commit -m "chore: add zod-to-json-schema dependency"
```

---

### Task 2: `buildClaudeCliArgs` — pure CLI argv builder

**Files:**
- Create: `packages/agent/src/ai/claude-cli.ts`
- Create: `packages/agent/src/ai/test-claude-cli.ts`

**Interfaces:**
- Consumes: `zodToJsonSchema` from `zod-to-json-schema` (Task 1).
- Produces: `buildClaudeCliArgs(schema: z.ZodTypeAny, opts: { system: string; model?: string }): string[]`, used internally by `callClaudeCli` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/ai/test-claude-cli.ts`:

```ts
import { z } from "zod";
import { buildClaudeCliArgs } from "./claude-cli";

let allPass = true;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) {
    allPass = false;
    console.log(`   ✗ [${label}] ${detail ?? "failed"}`);
  }
}

// --- buildClaudeCliArgs ---
{
  const schema = z.object({ foo: z.string() });
  const args = buildClaudeCliArgs(schema, { system: "be helpful" });
  check(
    "args-system-prompt",
    args.includes("--system-prompt") && args[args.indexOf("--system-prompt") + 1] === "be helpful",
    `got: ${JSON.stringify(args)}`
  );
  check(
    "args-output-format",
    args.includes("--output-format") && args[args.indexOf("--output-format") + 1] === "json"
  );
  check("args-json-schema-present", args.includes("--json-schema"));
  check("args-no-model-flag-when-unset", !args.includes("--model"), "should omit --model when opts.model is undefined");
}
{
  const schema = z.object({ foo: z.string() });
  const args = buildClaudeCliArgs(schema, { system: "be helpful", model: "claude-sonnet-5" });
  check(
    "args-model-flag-when-set",
    args.includes("--model") && args[args.indexOf("--model") + 1] === "claude-sonnet-5"
  );
}

console.log(allPass ? "\n✓ claude-cli test PASSED" : "\n✗ claude-cli test FAILED");
process.exit(allPass ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/agent/src/ai/test-claude-cli.ts`
Expected: FAIL — `Cannot find module './claude-cli'` (the file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/agent/src/ai/claude-cli.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx packages/agent/src/ai/test-claude-cli.ts`
Expected: `✓ claude-cli test PASSED`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/ai/claude-cli.ts packages/agent/src/ai/test-claude-cli.ts
git commit -m "feat: add buildClaudeCliArgs pure CLI argv builder"
```

---

### Task 3: `parseClaudeCliOutput` — pure response parser

**Files:**
- Modify: `packages/agent/src/ai/claude-cli.ts`
- Modify: `packages/agent/src/ai/test-claude-cli.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `parseClaudeCliOutput(stdout: string): unknown`, used internally by `callClaudeCli` (Task 4). Throws a descriptive `Error` on malformed JSON, `is_error: true`, or a missing `structured_output` field; otherwise returns the `structured_output` value.

- [ ] **Step 1: Write the failing test**

Add to `packages/agent/src/ai/test-claude-cli.ts`, after the `buildClaudeCliArgs` block and before the final `console.log(allPass ...)` line:

```ts
// --- parseClaudeCliOutput ---
{
  const out = parseClaudeCliOutput(JSON.stringify({ is_error: false, structured_output: { foo: "bar" } }));
  check("parse-success", JSON.stringify(out) === JSON.stringify({ foo: "bar" }), `got: ${JSON.stringify(out)}`);
}
{
  let threw = false;
  try {
    parseClaudeCliOutput(JSON.stringify({ is_error: true, result: "auth failed" }));
  } catch (e) {
    threw = e instanceof Error && e.message.includes("auth failed");
  }
  check("parse-is-error-throws", threw, "expected a throw mentioning the error result");
}
{
  let threw = false;
  try {
    parseClaudeCliOutput(JSON.stringify({ is_error: false }));
  } catch (e) {
    threw = e instanceof Error && e.message.includes("structured_output");
  }
  check("parse-missing-structured-output-throws", threw);
}
{
  let threw = false;
  try {
    parseClaudeCliOutput("not json");
  } catch (e) {
    threw = e instanceof Error;
  }
  check("parse-malformed-json-throws", threw);
}
```

And update the import line at the top of the file:

```ts
import { buildClaudeCliArgs, parseClaudeCliOutput } from "./claude-cli";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/agent/src/ai/test-claude-cli.ts`
Expected: FAIL — TypeScript error, `parseClaudeCliOutput` is not exported from `./claude-cli`.

- [ ] **Step 3: Write the minimal implementation**

Add to `packages/agent/src/ai/claude-cli.ts`, after `buildClaudeCliArgs`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx packages/agent/src/ai/test-claude-cli.ts`
Expected: `✓ claude-cli test PASSED`, exit code 0 (all 8 checks from Tasks 2+3 pass).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/ai/claude-cli.ts packages/agent/src/ai/test-claude-cli.ts
git commit -m "feat: add parseClaudeCliOutput pure response parser"
```

---

### Task 4: `callClaudeCli` — subprocess orchestration + live smoke test

**Files:**
- Modify: `packages/agent/src/ai/claude-cli.ts`
- Modify: `packages/agent/src/ai/test-claude-cli.ts`
- Modify: `packages/agent/package.json`

**Interfaces:**
- Consumes: `buildClaudeCliArgs`, `parseClaudeCliOutput` (Tasks 2, 3).
- Produces: `callClaudeCli(schema: z.ZodTypeAny, opts: { system: string; user: string; model?: string }): Promise<unknown>` — used by `llm.ts` in Task 5. Resolves with the schema-shaped (but not yet Zod-`.parse()`-validated — that happens centrally in `completeJSON`) value, or rejects with a descriptive `Error` on any process/transport/CLI-level failure.

This task's core logic (spawning a real `claude` process) can't be red/green unit-tested without the actual CLI and a valid `CLAUDE_CODE_OAUTH_TOKEN`, so it follows the codebase's existing live-integration-test convention instead (`test-critic.ts` skips gracefully when its credential is absent) — write the implementation and a live smoke test together, verified manually with a real token in Task 5's final step.

- [ ] **Step 1: Add the live smoke test (skips gracefully without a token)**

Add to `packages/agent/src/ai/test-claude-cli.ts`, replacing the final two lines (`console.log(allPass ...)` and nothing after) with:

```ts
async function main() {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.log("⏭  test-claude-cli live call skipped — no CLAUDE_CODE_OAUTH_TOKEN. (Pure logic checks above still ran.)");
  } else {
    const schema = z.object({ answer: z.string() });
    const result = await callClaudeCli(schema, {
      system: 'Reply with ONLY JSON matching this shape: { "answer": string }. No other text, no markdown fences.',
      user: "Set answer to exactly: OK",
    });
    check(
      "live-call-shape",
      typeof (result as { answer?: unknown })?.answer === "string",
      `unexpected shape: ${JSON.stringify(result)}`
    );
  }

  console.log(allPass ? "\n✓ claude-cli test PASSED" : "\n✗ claude-cli test FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Update the import line at the top of the file:

```ts
import { buildClaudeCliArgs, parseClaudeCliOutput, callClaudeCli } from "./claude-cli";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/agent/src/ai/test-claude-cli.ts`
Expected: FAIL — TypeScript error, `callClaudeCli` is not exported from `./claude-cli`.

- [ ] **Step 3: Write the implementation**

Add to `packages/agent/src/ai/claude-cli.ts`. First, update the imports at the top of the file:

```ts
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
```

Then add, after `parseClaudeCliOutput`:

```ts
const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH || "claude";

/** Impure: spawns `claude`, writes `input` to stdin, resolves stdout or rejects. */
function runClaudeCliProcess(args: string[], cwd: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx packages/agent/src/ai/test-claude-cli.ts`
Expected (no `CLAUDE_CODE_OAUTH_TOKEN` set in this environment): the 8 pure checks from Tasks 2+3 run silently (no `✗` lines), then `⏭  test-claude-cli live call skipped — no CLAUDE_CODE_OAUTH_TOKEN...`, then `✓ claude-cli test PASSED`, exit code 0.

- [ ] **Step 5: Add the npm script**

In `packages/agent/package.json`, add to `"scripts"` (after `"test:fetch-jd"`):

```json
    "test:fetch-jd": "tsx src/scraper/test-fetch-jd.ts",
    "test:claude-cli": "tsx src/ai/test-claude-cli.ts",
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/ai/claude-cli.ts packages/agent/src/ai/test-claude-cli.ts packages/agent/package.json
git commit -m "feat: add callClaudeCli subprocess orchestration + live smoke test"
```

---

### Task 5: Wire Claude into `completeJSON()` as the default provider

**Files:**
- Modify: `packages/agent/src/ai/llm.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `callClaudeCli` (Task 4).
- Produces: `completeJSON()`'s public signature is unchanged — `tailor.ts`, `critic.ts`, `fit-page.ts` need zero changes. New export: `LLM_PROVIDER: "claude" | "openai"`.

**Behavior change to call out explicitly (not a regression, a deliberate simplification):** today, an OpenAI network/auth error thrown by `client().chat.completions.create()` propagates immediately, uncaught by the retry loop — only `JSON.parse`/`schema.parse` failures get retried. After this task, the network call is inside the same `try` as parsing/validation for **both** providers, so a transient network error now gets up to `maxRetries` retries (self-healing for blips) before finally throwing, instead of failing on the first attempt. This matches the approved design spec's requirement for the Claude path and is applied symmetrically to OpenAI for one consistent code path rather than two asymmetric ones.

- [ ] **Step 1: Replace `llm.ts`**

Replace the full contents of `packages/agent/src/ai/llm.ts`:

```ts
import OpenAI from "openai";
import { z } from "zod";
import { callClaudeCli } from "./claude-cli";

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

async function callOpenAIOnce(system: string, user: string, model: string, temperature: number): Promise<string> {
  const res = await client().chat.completions.create({
    model,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
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
  }
): Promise<T> {
  const { system, user, model, temperature = 0.4, maxRetries = 2 } = opts;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userContent =
      attempt === 0
        ? user
        : `${user}\n\nYour previous reply failed validation: ${lastError}\nReturn ONLY valid JSON matching the requested schema.`;

    try {
      const parsed =
        LLM_PROVIDER === "openai"
          ? JSON.parse(await callOpenAIOnce(system, userContent, model ?? DEFAULT_MODEL, temperature))
          : await callClaudeCli(schema, { system, user: userContent, model: model ?? process.env.CLAUDE_MODEL });
      return schema.parse(parsed);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`LLM JSON failed validation after ${maxRetries + 1} attempts: ${lastError}`);
}
```

- [ ] **Step 2: Update `.env.example`**

In `.env.example`, replace:

```
# AI
OPENAI_API_KEY=sk-...
```

with:

```
# AI — LLM provider: "claude" (default, subscription usage via headless CLI) or "openai"
LLM_PROVIDER=claude

# Required when LLM_PROVIDER=claude — minted via `claude setup-token`
# (see docs/superpowers/specs/2026-07-02-claude-headless-tailoring-design.md)
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...

# Optional — pins a specific model for the claude path; omit to use the CLI's default
CLAUDE_MODEL=

# Required when LLM_PROVIDER=openai (or as a manual fallback)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
```

- [ ] **Step 3: Type-check and build**

Run: `npm run build --workspace=packages/agent`
Expected: exits 0, no TypeScript errors. This is the first point strict-mode type-checking sees `callClaudeCli(schema, ...)` receiving a `z.ZodType<T, z.ZodTypeDef, any>` where `z.ZodTypeAny` is expected — if this fails, widen `callClaudeCli`'s `schema` parameter type to match exactly what `completeJSON` passes (`z.ZodType<any, z.ZodTypeDef, any>`) rather than `z.ZodTypeAny`.

- [ ] **Step 4: Run the existing deterministic + provider-agnostic tests**

Run: `npm run test:format --workspace=packages/agent && npm run test:grounding --workspace=packages/agent`
Expected: both `PASSED` — these exercise logic entirely above `completeJSON` (rendering, linting, grounding) and must be completely unaffected by this change.

- [ ] **Step 5: Run the new claude-cli test**

Run: `npm run test:claude-cli --workspace=packages/agent`
Expected: same as Task 4 Step 4 (skips the live call without a token, pure checks pass).

- [ ] **Step 6: Manual live verification (requires a real subscription token — not automatable here)**

This step needs a real `CLAUDE_CODE_OAUTH_TOKEN` from a Claude Pro/Max/Team/Enterprise subscription, so it's a manual step for whoever runs this plan, not something a prior automated step can verify.

1. Mint a token: `claude setup-token` (opens a browser OAuth flow, prints a token starting `sk-ant-oat01-...`).
2. Run: `CLAUDE_CODE_OAUTH_TOKEN=<paste-token> npm run test:claude-cli --workspace=packages/agent`
   Expected: no `⏭` skip line this time; `✓ claude-cli test PASSED`, exit code 0.
3. Run the full live loop once with `LLM_PROVIDER` left at its default (`claude`):
   `CLAUDE_CODE_OAUTH_TOKEN=<paste-token> npm run tailor --workspace=packages/agent`
   Expected: prints `ITERATION HISTORY:` with at least one pass and a `finalScore`, same output shape as today's OpenAI-backed run — confirms the full generate → critique → revise loop works end-to-end on the Claude path, not just the smoke test.
4. Revoke the token afterward if it was only minted for this manual check (`claude.ai/settings/claude-code`), or set it as the real `CLAUDE_CODE_OAUTH_TOKEN` Railway variable on the agent service if this is going to production.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/ai/llm.ts .env.example
git commit -m "feat: default tailoring pipeline to headless Claude, keep OpenAI as manual fallback"
```

---

## Self-Review Notes

- **Spec coverage:** provider dispatch (Task 5), Claude backend with schema conversion + system/stdin split + scratch-dir cost mitigation + model flag (Tasks 2–4), auth via env var (Task 5 `.env.example`), fallback-not-automatic behavior (Task 5, unchanged — no failover code added), testing mirroring the existing skip-gracefully pattern (Tasks 2–4), error handling contract preserved for callers (Task 5) — all spec sections have a corresponding task.
- **Type consistency:** `buildClaudeCliArgs`/`parseClaudeCliOutput`/`callClaudeCli` signatures are introduced once (Tasks 2–4) and consumed with the same names/shapes in Task 5 — no renames across tasks.
- **Scope:** confined to the `completeJSON` seam and its direct dependencies; `tailor.ts`, `critic.ts`, `fit-page.ts`, and all three schemas are explicitly untouched, matching the spec's stated scope.
