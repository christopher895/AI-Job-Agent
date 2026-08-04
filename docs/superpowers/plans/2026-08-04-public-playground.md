# Public Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public `/playground` route where a visitor pastes their own resume and a job description, brings their own Anthropic API key, and runs the same suggest-and-review tailoring pipeline Christopher uses himself — fully stateless server-side, rate-limited, with only an anonymous usage count persisted.

**Architecture:** Three new stateless agent endpoints (parse-resume, suggest, apply) reuse the existing pure pipeline functions (`importMasterResume`, `suggestKeywords`, `applySuggestions`, `renderMarkdown`, `fitToOnePage`) with a new optional visitor-supplied Anthropic API key threaded through `completeJSON`. A new set of Next.js route handlers under `/api/playground/*` skip the session check (unlike the private `/api/proxy/*`) but still attach the same internal shared secret when calling the agent. The browser holds all in-progress state (parsed resume, suggestions) across the 3-step flow and resends it — nothing is written to the database except one hashed-IP+timestamp row per run, used for both rate limiting and usage visibility.

**Tech Stack:** Same as the rest of the app — Express, Next.js App Router, Zod, Postgres. No new external dependencies (the Anthropic API call uses a plain `fetch`, no SDK).

## Global Constraints

- Anthropic API key only — no OpenAI key support in the playground.
- The visitor's API key is read from the request body per-call, used only for that call's LLM invocation(s), and never written to a log, file, or database row.
- No playground resume text, JD text, suggestions, or output is ever persisted. The only new table (`playground_usage`) stores `(ip_hash, created_at)` only.
- Existing behavior for Christopher's own usage must be unchanged: every modified function's new parameter is optional, and omitting it must preserve today's exact behavior (`LLM_PROVIDER` env-var dispatch).
- Rate limit: reject a `parse-resume` call with 429 if the requesting IP's hash already has 5 or more `playground_usage` rows in the last hour. Check happens before any LLM/PDF work.
- Reuse the existing pure pipeline functions (`importMasterResume`, `suggestKeywords`, `applySuggestions`, `renderMarkdown`, `fitToOnePage`) rather than reimplementing their logic.
- Reuse the design tokens already established in the app redesign: `bg-paper`, `text-paper-ink`, `text-paper-muted`, `border-paper-border`, `font-serif` (Fraunces) for headings, `font-mono` (Geist Mono) for meta text, violet as the accent.
- Work happens in an isolated git worktree, branched fresh off `main` (this plan's spec and plan docs are already committed there via PR #119 — check whether that branch is still current or has been merged before continuing on it).

---

### Task 1: `playground_usage` table + rate-limit/usage queries

**Files:**
- Modify: `packages/agent/src/db/schema.ts`
- Modify: `packages/agent/src/db/queries.ts`
- Create: `packages/agent/src/db/test-playground-usage.ts`
- Modify: `packages/agent/package.json` (add `test:playground-usage` script)

**Interfaces:**
- Produces: `hashIp(ip: string): string`, `logPlaygroundUsage(ipHash: string): Promise<void>`, `countRecentPlaygroundUsage(ipHash: string): Promise<number>` — all exported from `packages/agent/src/db/queries.ts`. Task 3's playground routes consume all three.

- [ ] **Step 1: Add the table to schema.ts**

In `packages/agent/src/db/schema.ts`, add before the final `await seedMasterResume();` line:
```ts
  await pool.query(`
    CREATE TABLE IF NOT EXISTS playground_usage (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ip_hash    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_playground_usage_ip_hash_created
      ON playground_usage (ip_hash, created_at)
  `);
```

- [ ] **Step 2: Write the failing test**

Create `packages/agent/src/db/test-playground-usage.ts`:
```ts
import { pool } from "./pool";
import { initSchema } from "./schema";
import { hashIp, logPlaygroundUsage, countRecentPlaygroundUsage } from "./queries";

async function main() {
  await initSchema();

  const hashA = hashIp("203.0.113.1");
  const hashB = hashIp("203.0.113.1");
  const hashDifferent = hashIp("203.0.113.2");

  const sameInputSameHash = hashA === hashB;
  const differentInputDifferentHash = hashA !== hashDifferent;

  const testHash = `test-${Date.now()}`;
  const before = await countRecentPlaygroundUsage(testHash);
  await logPlaygroundUsage(testHash);
  await logPlaygroundUsage(testHash);
  const after = await countRecentPlaygroundUsage(testHash);

  console.log(`hash consistent for same input: ${sameInputSameHash}`);
  console.log(`hash differs for different input: ${differentInputDifferentHash}`);
  console.log(`count before: ${before}, after 2 logs: ${after}`);

  const pass = sameInputSameHash && differentInputDifferentHash && before === 0 && after === 2;

  await pool.query("DELETE FROM playground_usage WHERE ip_hash = $1", [testHash]);
  await pool.end();

  console.log(pass ? "\n✓ playground-usage test PASSED" : "\n✗ playground-usage test FAILED");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Edit `packages/agent/package.json`, add to `"scripts"`:
```json
"test:playground-usage": "tsx src/db/test-playground-usage.ts"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:playground-usage --workspace=packages/agent`
Expected: FAIL — `hashIp`/`logPlaygroundUsage`/`countRecentPlaygroundUsage` are not exported from `./queries` yet (TypeScript/runtime error).

- [ ] **Step 4: Implement the queries**

In `packages/agent/src/db/queries.ts`, add near the top (after the existing imports) and at the end of the file:
```ts
import crypto from "crypto";
```
(add to the top import block alongside the existing `pool`/`ai/types`/`config` imports)

At the end of the file:
```ts
const PLAYGROUND_IP_PEPPER = process.env.PLAYGROUND_IP_PEPPER ?? "dev-only-pepper-set-a-real-one-in-prod";

/** Hashes an IP with a server-only pepper so raw IPs never sit in the DB. */
export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(`${PLAYGROUND_IP_PEPPER}:${ip}`).digest("hex");
}

export async function logPlaygroundUsage(ipHash: string): Promise<void> {
  await pool.query(`INSERT INTO playground_usage (ip_hash) VALUES ($1)`, [ipHash]);
}

export async function countRecentPlaygroundUsage(ipHash: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM playground_usage WHERE ip_hash = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [ipHash]
  );
  return rows[0].count;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:playground-usage --workspace=packages/agent`
Expected: all three checks print `true`/expected counts, final line `✓ playground-usage test PASSED`, exit code 0. (Requires local Postgres running — `docker-compose up -d` from repo root if not already up.)

- [ ] **Step 6: Add the env var to `.env.example`**

In `.env.example`, add near the other auth-adjacent vars:
```
# Playground — pepper for hashing visitor IPs (rate-limit + anonymous usage count only)
PLAYGROUND_IP_PEPPER=
```

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/db/schema.ts packages/agent/src/db/queries.ts packages/agent/src/db/test-playground-usage.ts packages/agent/package.json .env.example
git commit -m "feat: add playground_usage table for rate-limiting and anonymous usage count"
```

---

### Task 2: Thread a visitor-supplied Anthropic API key through the LLM call chain

**Files:**
- Modify: `packages/agent/src/ai/llm.ts`
- Modify: `packages/agent/src/ai/import-master-resume.ts`
- Modify: `packages/agent/src/ai/suggest-keywords.ts`
- Modify: `packages/agent/src/ai/fit-page.ts`
- Create: `packages/agent/src/ai/test-anthropic-key-path.ts`
- Modify: `packages/agent/package.json` (add `test:anthropic-key-path` script)

**Interfaces:**
- Produces: `completeJSON<T>(schema, opts)` gains an optional `opts.anthropicApiKey?: string`. `importMasterResume(rawText: string, apiKey?: string)`, `suggestKeywords(jd: string, master: MasterResume, apiKey?: string)`, `fitToOnePage(markdown: string, opts?: { skipWidowFix?: boolean; apiKey?: string })` — all gain an optional trailing/opts key. Task 3's playground routes consume all of these with a real visitor key.

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/ai/test-anthropic-key-path.ts`:
```ts
import { z } from "zod";

// Import after setting env so llm.ts's module-level LLM_PROVIDER read (if any
// code path relies on it at call time, not just import time) reflects "claude"
// — the default, unrelated to the new key param being tested.
import { completeJSON } from "./llm";

const Schema = z.object({ ok: z.boolean() });

/**
 * Mocks global.fetch to verify completeJSON's NEW dispatch branch: when
 * anthropicApiKey is provided, it must call the Anthropic Messages API
 * directly with that key, and must NOT fall through to the LLM_PROVIDER
 * dispatch (callClaudeCli/OpenAI). No real network call happens.
 *
 * The "omitting anthropicApiKey preserves existing behavior" half of this
 * requirement is verified separately in Step 9 by re-running the existing
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
```

Edit `packages/agent/package.json`, add to `"scripts"`:
```json
"test:anthropic-key-path": "tsx src/ai/test-anthropic-key-path.ts"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:anthropic-key-path --workspace=packages/agent`
Expected: FAIL — TypeScript compile error (`anthropicApiKey` does not exist on the `opts` type yet), since this is a literal object passed directly to `completeJSON`'s call site and TypeScript's excess-property check catches it.

- [ ] **Step 3: Implement the Anthropic direct-call path in `llm.ts`**

In `packages/agent/src/ai/llm.ts`, add after the existing `callOpenAIOnce` function:
```ts
const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

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
```

- [ ] **Step 4: Add the optional parameter and dispatch branch to `completeJSON`**

In `packages/agent/src/ai/llm.ts`, replace the `completeJSON` function:
```ts
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
  }
): Promise<T> {
  const { system, user, model, temperature = 0.4, maxRetries = 2, anthropicApiKey } = opts;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userContent =
      attempt === 0
        ? user
        : `${user}\n\nYour previous reply failed validation: ${lastError}\nReturn ONLY valid JSON matching the requested schema.`;

    const startedAt = Date.now();
    try {
      const parsed = anthropicApiKey
        ? JSON.parse(await callAnthropicWithKey(system, userContent, anthropicApiKey, temperature))
        : LLM_PROVIDER === "openai"
          ? JSON.parse(await callOpenAIOnce(system, userContent, model ?? DEFAULT_MODEL, temperature))
          : await callClaudeCli(schema, { system, user: userContent, model: model ?? process.env.CLAUDE_MODEL });
      const provider = anthropicApiKey ? "anthropic-key" : LLM_PROVIDER;
      console.log(`[llm] provider=${provider} attempt=${attempt + 1} ok in ${Date.now() - startedAt}ms`);
      return schema.parse(parsed);
    } catch (err) {
      const provider = anthropicApiKey ? "anthropic-key" : LLM_PROVIDER;
      console.log(`[llm] provider=${provider} attempt=${attempt + 1} FAILED in ${Date.now() - startedAt}ms`);
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`LLM JSON failed validation after ${maxRetries + 1} attempts: ${lastError}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:anthropic-key-path --workspace=packages/agent`
Expected: all three checks print `true`, no unexpected throw logged, final line `✓ anthropic-key-path test PASSED`, exit code 0.

- [ ] **Step 6: Thread the optional key through `importMasterResume`**

In `packages/agent/src/ai/import-master-resume.ts`, replace the final function:
```ts
export async function importMasterResume(rawText: string, apiKey?: string): Promise<MasterResume> {
  const parsed = await completeJSON(MasterResumeSchema, {
    system: SYSTEM_PROMPT,
    user: rawText,
    temperature: 0.1,
    anthropicApiKey: apiKey,
  });
  return dedupeIds(parsed);
}
```

- [ ] **Step 7: Thread the optional key through `suggestKeywords`**

In `packages/agent/src/ai/suggest-keywords.ts`, replace the final function:
```ts
export async function suggestKeywords(jd: string, master: MasterResume, apiKey?: string): Promise<RawSuggestion[]> {
  const result = await completeJSON(ResponseSchema, {
    system: SYSTEM_PROMPT,
    user: [
      "=== JOB DESCRIPTION ===",
      jd.trim(),
      "=== RÉSUMÉ (fixed, one page — reference bullets by id) ===",
      JSON.stringify(tailorableSlice(master)),
    ].join("\n\n"),
    temperature: 0.3,
    anthropicApiKey: apiKey,
  });
  return result.suggestions;
}
```

- [ ] **Step 8: Thread the optional key through `fitToOnePage`/`trimToOnePage`**

In `packages/agent/src/ai/fit-page.ts`, replace `trimToOnePage`:
```ts
async function trimToOnePage(markdown: string, overflowLines: number, apiKey?: string): Promise<string> {
  const result = await completeJSON(TrimSchema, {
    system: `You are editing a résumé that overflows onto a second page by approximately ${overflowLines} printed lines.

Shorten it to fit one page by:
- Removing the least relevant bullet from one or more roles/projects under ## Experience or ## Projects (prefer older or less relevant roles)
- Shortening verbose bullets under ## Experience or ## Projects by cutting filler words (never remove facts, metrics, or technologies)

Do NOT change font, margins, section headers, names, titles, companies, dates, or URLs.
Do NOT modify ## Education, ## Extracurriculars, or ## Skills in any way — those sections must stay byte-for-byte identical to the input, even if that means the résumé stays slightly over one page.
Do NOT add any content.
Return the complete résumé markdown as JSON: { "markdown": "..." }`,
    user: markdown,
    temperature: 0.15,
    anthropicApiKey: apiKey,
  });
  return result.markdown;
}
```

Replace the `fitToOnePage` function signature and its trim-loop call site:
```ts
export async function fitToOnePage(
  markdown: string,
  opts: { skipWidowFix?: boolean; apiKey?: string } = {},
): Promise<{ markdown: string; pdf: Buffer }> {
  let current = markdown;
  let pdf = await renderPdf(current);

  // Page overflow trim loop (max 2 extra LLM passes)
  let pages = await countPdfPages(pdf);
  for (let attempt = 0; attempt < 2 && pages > 1; attempt++) {
    const overflowLines = Math.ceil((pages - 1) * 50);
    current = await trimToOnePage(current, overflowLines, opts.apiKey);
    pdf = await renderPdf(current);
    pages = await countPdfPages(pdf);
  }
  if (pages > 1) {
    console.warn(`[fit-page] resume still ${pages} pages after 2 trim passes`);
  }

  // Widow word fix (one pass after page is stable). Skipped for flows where
  // bullets must stay verbatim except for explicitly-approved edits (the
  // suggestion-based tailoring flow) — an unconditional LLM rewording pass
  // here would silently undo that guarantee.
  const widows = opts.skipWidowFix ? [] : findWidowBullets(current);
  if (widows.length > 0) {
    current = await fixWidowBullets(current, widows);
    pdf = await renderPdf(current);
  }

  if (current !== markdown) {
    console.warn(`[fit-page] content modified during fit (page-count trim and/or widow-fix) for a resume that may have expected to stay verbatim`);
  }

  return { markdown: current, pdf };
}
```
(`fixWidowBullets` is unchanged — it's never reached by the playground since `apply` always passes `skipWidowFix: true`, matching the private suggestion-flow's existing convention.)

- [ ] **Step 9: Verify the whole agent package still builds and existing tests still pass**

Run:
```bash
npm run build --workspace=packages/agent
npm run test:suggest-keywords --workspace=packages/agent
npm run test:import-master-resume --workspace=packages/agent
```
Expected: build succeeds, both existing tests still pass unchanged (they don't pass the new optional param, confirming default behavior is untouched).

- [ ] **Step 10: Commit**

```bash
git add packages/agent/src/ai/llm.ts packages/agent/src/ai/import-master-resume.ts packages/agent/src/ai/suggest-keywords.ts packages/agent/src/ai/fit-page.ts packages/agent/src/ai/test-anthropic-key-path.ts packages/agent/package.json
git commit -m "feat: add visitor-supplied Anthropic API key path to the LLM call chain"
```

---

### Task 3: Agent-side playground routes

**Files:**
- Create: `packages/agent/src/api/routes/playground.ts`
- Modify: `packages/agent/src/api/index.ts`

**Interfaces:**
- Consumes: `hashIp`, `logPlaygroundUsage`, `countRecentPlaygroundUsage` (Task 1); `importMasterResume`, `suggestKeywords`, `applySuggestions`, `labelGroundedness`, `renderMarkdown`, `fitToOnePage` all with their new optional key params (Task 2); `fetchJd` from `../../scraper/fetch-jd` (existing, unchanged).
- Produces: HTTP endpoints `POST /api/playground/parse-resume`, `POST /api/playground/fetch-jd`, `POST /api/playground/suggest`, `POST /api/playground/apply`, consumed by Task 5's web proxy routes.

- [ ] **Step 1: Write the route file**

Create `packages/agent/src/api/routes/playground.ts`:
```ts
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { importMasterResume } from "../../ai/import-master-resume";
import { suggestKeywords } from "../../ai/suggest-keywords";
import { applySuggestions, labelGroundedness } from "../../ai/apply-suggestions";
import { renderMarkdown } from "../../ai/format";
import { fitToOnePage } from "../../ai/fit-page";
import { MasterResumeSchema, SuggestionSchema } from "../../ai/types";
import { fetchJd } from "../../scraper/fetch-jd";
import { hashIp, logPlaygroundUsage, countRecentPlaygroundUsage } from "../../db/queries";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const RATE_LIMIT_PER_HOUR = 5;

function clientIp(req: import("express").Request): string {
  // Railway terminates TLS at the edge and forwards the real client IP via
  // X-Forwarded-For; req.ip alone would be Railway's internal proxy address.
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip ?? "unknown";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function requireApiKey(req: import("express").Request, res: import("express").Response): string | null {
  const apiKey = (req.body as { apiKey?: string })?.apiKey;
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    res.status(400).json({ error: "An Anthropic API key is required." });
    return null;
  }
  return apiKey.trim();
}

// POST /api/playground/parse-resume — multipart (file) or JSON (text). Rate-limited entry point.
router.post("/parse-resume", upload.single("file"), async (req, res) => {
  const ipHash = hashIp(clientIp(req));
  const recentCount = await countRecentPlaygroundUsage(ipHash);
  if (recentCount >= RATE_LIMIT_PER_HOUR) {
    res.status(429).json({ error: "Playground rate limit reached — try again in a bit." });
    return;
  }

  const apiKey = requireApiKey(req, res);
  if (!apiKey) return;

  let rawText: string;
  if (req.file) {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: req.file.buffer });
      const parsed = await parser.getText({ pageJoiner: "" });
      await parser.destroy();
      rawText = parsed.text;
    } catch (err) {
      console.error("[playground] pdf text extraction failed:", err);
      res.status(400).json({ error: "Could not read text from the uploaded PDF." });
      return;
    }
  } else if (typeof req.body?.text === "string" && req.body.text.trim()) {
    rawText = req.body.text;
  } else {
    res.status(400).json({ error: "Provide resume text or upload a PDF file." });
    return;
  }

  if (!rawText.trim()) {
    res.status(400).json({ error: "No text could be extracted — try pasting plain text instead." });
    return;
  }

  const MAX_IMPORT_TEXT_CHARS = 60_000;
  if (rawText.length > MAX_IMPORT_TEXT_CHARS) {
    rawText = rawText.slice(0, MAX_IMPORT_TEXT_CHARS);
  }

  await logPlaygroundUsage(ipHash);

  try {
    const master = await importMasterResume(rawText, apiKey);
    res.json(master);
  } catch (err) {
    console.error("[playground] parse-resume failed:", err);
    res.status(502).json({ error: `Could not parse your resume: ${errorMessage(err)}` });
  }
});

// POST /api/playground/fetch-jd — no key needed, no LLM call, reuses the existing scraper.
router.post("/fetch-jd", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }
  let result;
  try {
    result = await fetchJd(url);
  } catch (err) {
    res.status(400).json({ error: errorMessage(err), method: "failed" });
    return;
  }
  if (result.method === "failed") {
    res.status(400).json({ error: "Could not fetch job description from this URL", method: "failed" });
    return;
  }
  res.json({
    text: result.text,
    method: result.method,
    title: result.title,
    company: result.company,
    location: result.location,
  });
});

const SuggestBodySchema = z.object({
  masterResume: MasterResumeSchema,
  jd: z.string().min(1),
  apiKey: z.string().min(1),
});

// POST /api/playground/suggest
router.post("/suggest", async (req, res) => {
  const parsed = SuggestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { masterResume, jd, apiKey } = parsed.data;

  try {
    const raw = await suggestKeywords(jd, masterResume, apiKey);
    const suggestions = raw.map((s) => ({
      ...s,
      groundedness: labelGroundedness(masterResume, s),
      accepted: null as boolean | null,
    }));
    res.json({ suggestions });
  } catch (err) {
    console.error("[playground] suggest failed:", err);
    res.status(502).json({ error: `Could not generate suggestions: ${errorMessage(err)}` });
  }
});

const ApplyBodySchema = z.object({
  masterResume: MasterResumeSchema,
  accepted: z.array(SuggestionSchema),
  apiKey: z.string().min(1),
});

// POST /api/playground/apply
router.post("/apply", async (req, res) => {
  const parsed = ApplyBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { masterResume, accepted, apiKey } = parsed.data;

  try {
    const relabeledAccepted = accepted.map((s) => ({
      ...s,
      groundedness: labelGroundedness(masterResume, s),
    }));
    const { master: adjustedMaster, tailored } = applySuggestions(masterResume, relabeledAccepted);
    let markdown = renderMarkdown(adjustedMaster, tailored);

    let pdfBase64: string | null = null;
    try {
      const fitted = await fitToOnePage(markdown, { skipWidowFix: true, apiKey });
      markdown = fitted.markdown;
      pdfBase64 = fitted.pdf.toString("base64");
    } catch (err) {
      console.error("[playground] fitToOnePage failed, returning markdown without PDF:", err);
    }

    res.json({ markdown, pdfBase64 });
  } catch (err) {
    console.error("[playground] apply failed:", err);
    res.status(502).json({ error: `Could not finalize your resume: ${errorMessage(err)}` });
  }
});

export default router;
```

- [ ] **Step 2: Mount the router**

In `packages/agent/src/api/index.ts`, add the import and mount line alongside the existing routers:
```ts
import playgroundRouter from "./routes/playground";
```
```ts
router.use("/playground", playgroundRouter);
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build --workspace=packages/agent`
Expected: build succeeds.

- [ ] **Step 4: Manual verification against a running agent**

Set `PLAYGROUND_IP_PEPPER` in `packages/agent/.env` (any string for local dev), start the agent:
```bash
npm run dev --workspace=packages/agent
```

In another terminal, use a real (personal/test) Anthropic API key:
```bash
export TESTKEY="sk-ant-..."

curl -s -X POST http://localhost:3001/api/playground/parse-resume \
  -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"Jane Doe. Software Engineer at Acme Corp, 2020-2024. Built a React dashboard used by 10k users daily. Skills: TypeScript, React, Node.js.\", \"apiKey\": \"$TESTKEY\"}"
```
Expected: 200, a JSON `MasterResume` object with `basics.name: "Jane Doe"` and an experience entry for Acme Corp.

```bash
curl -s -X POST http://localhost:3001/api/playground/parse-resume \
  -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"...\", \"apiKey\": \"invalid-key\"}"
```
Expected: 502 with a clear error message, not a 500 or a hang.

Repeat the first `parse-resume` call 4 more times (5 total), then a 6th:
Expected: the 6th call returns 429.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/api/routes/playground.ts packages/agent/src/api/index.ts
git commit -m "feat: add public playground routes (parse-resume, fetch-jd, suggest, apply)"
```

---

### Task 4: Web middleware — allow `/playground` and `/api/playground` without a session

**Files:**
- Modify: `packages/web/middleware.ts`

**Interfaces:**
- None new — modifies existing routing logic only.

- [ ] **Step 1: Update the public-path checks**

In `packages/web/middleware.ts`, replace:
```ts
  const isPublicPage = pathname === "/login";
  const isAuthApi = pathname.startsWith("/api/auth");
  const isApiRoute = pathname.startsWith("/api/");
```
with:
```ts
  const isPublicPage = pathname === "/login" || pathname === "/playground";
  const isAuthApi = pathname.startsWith("/api/auth");
  const isPublicApi = pathname.startsWith("/api/playground");
  const isApiRoute = pathname.startsWith("/api/");
```

Then update the early-return condition — replace:
```ts
  if (isAuthApi) {
    return;
  }
```
with:
```ts
  if (isAuthApi || isPublicApi) {
    return;
  }
```

(The rest of the function is unchanged — `isPublicPage` now also covers `/playground` for the "already signed in, don't show a public/login page" redirect-to-`/` behavior, matching how `/login` already works today. That's fine: if Christopher himself visits `/playground` while signed in, redirecting him to `/` is harmless and consistent.)

- [ ] **Step 2: Verify it builds**

Run: `npm run build --workspace=packages/web`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/web/middleware.ts
git commit -m "feat: allow unauthenticated access to /playground and /api/playground"
```

---

### Task 5: Web proxy routes for the playground (no session required)

**Files:**
- Create: `packages/web/app/api/playground/[...path]/route.ts`

**Interfaces:**
- Consumes: `process.env.AGENT_API_URL`, `process.env.INTERNAL_API_SECRET` (existing).
- Produces: HTTP endpoint `/api/playground/*`, consumed by Task 6's client.

- [ ] **Step 1: Write the proxy route handler**

Create `packages/web/app/api/playground/[...path]/route.ts`:
```ts
import { NextRequest } from "next/server";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:3001/api";

async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path } = await params;
  const targetUrl = `${AGENT_API_URL}/playground/${path.join("/")}${req.nextUrl.search}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  const headers: Record<string, string> = {
    "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "",
  };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;

  let agentRes: Response;
  try {
    agentRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody && body && body.byteLength > 0 ? body : undefined,
    });
  } catch {
    return Response.json({ error: "Playground service unreachable" }, { status: 502 });
  }

  const resHeaders = new Headers();
  const outContentType = agentRes.headers.get("content-type");
  if (outContentType) resHeaders.set("content-type", outContentType);

  return new Response(agentRes.body, { status: agentRes.status, headers: resHeaders });
}

export { handle as POST };
```

Note: unlike the private `/api/proxy/*` route, this deliberately does **not** call `auth()` — that's the entire point of this route existing separately. It still never exposes the agent's real URL or the internal secret to the browser, and it forwards to a fixed `/playground/*` prefix on the agent, so it can't be used to reach any other agent endpoint.

- [ ] **Step 2: Verify it builds**

Run: `npm run build --workspace=packages/web`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/api/playground
git commit -m "feat: add unauthenticated web proxy for playground requests"
```

---

### Task 6: Web API client for the playground

**Files:**
- Create: `packages/web/lib/playground-api.ts`

**Interfaces:**
- Produces: `playgroundApi.parseResumeText(text, apiKey)`, `playgroundApi.parseResumeFile(file, apiKey)`, `playgroundApi.fetchJd(url)`, `playgroundApi.suggest(masterResume, jd, apiKey)`, `playgroundApi.apply(masterResume, accepted, apiKey)` — all exported from `packages/web/lib/playground-api.ts`. Tasks 7-9's components consume these.
- Consumes: types from `packages/web/lib/api.ts` (`MasterResume`) — re-exported/reused, not redefined.

- [ ] **Step 1: Write the client module**

Create `packages/web/lib/playground-api.ts`:
```ts
import { MasterResume } from "./api";

const BASE = "/api/playground";

export type RawSuggestion = {
  id: string;
  kind: "bullet-rewrite" | "skill-addition";
  targetId: string;
  keyword: string;
  originalText?: string;
  suggestedText: string;
  rationale: string;
};

export type PlaygroundSuggestion = RawSuggestion & {
  groundedness: "grounded" | "extrapolated";
  accepted: boolean | null;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function postForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const playgroundApi = {
  parseResumeText: (text: string, apiKey: string) =>
    post<MasterResume>("/parse-resume", { text, apiKey }),

  parseResumeFile: (file: File, apiKey: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("apiKey", apiKey);
    return postForm<MasterResume>("/parse-resume", fd);
  },

  fetchJd: (url: string) =>
    post<{ text: string; method: string; title?: string; company?: string; location?: string }>(
      "/fetch-jd",
      { url }
    ),

  suggest: (masterResume: MasterResume, jd: string, apiKey: string) =>
    post<{ suggestions: PlaygroundSuggestion[] }>("/suggest", { masterResume, jd, apiKey }),

  apply: (masterResume: MasterResume, accepted: PlaygroundSuggestion[], apiKey: string) =>
    post<{ markdown: string; pdfBase64: string | null }>("/apply", {
      masterResume,
      accepted,
      apiKey,
    }),
};
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build --workspace=packages/web`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/web/lib/playground-api.ts
git commit -m "feat: add typed web client for the playground API"
```

---

### Task 7: Playground landing page + input step

**Files:**
- Create: `packages/web/app/playground/page.tsx`
- Create: `packages/web/components/PlaygroundFlow.tsx`

**Interfaces:**
- Consumes: `playgroundApi` (Task 6).
- Produces: the `/playground` page. Task 8 extends `PlaygroundFlow.tsx` with the review step; Task 9 extends it with the result step.

- [ ] **Step 1: Write the landing page**

Create `packages/web/app/playground/page.tsx`:
```tsx
import PlaygroundFlow from "../../components/PlaygroundFlow";

export default function PlaygroundPage() {
  return (
    <div className="relative min-h-full w-full overflow-hidden bg-ink-950 px-6 py-16">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 0%, rgba(124,58,237,0.22), transparent 55%),
            linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
          `,
          backgroundSize: "auto, 42px 42px, 42px 42px",
        }}
      />
      <div className="relative mx-auto max-w-2xl">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-400">
          Public playground
        </p>
        <h1 className="mt-2 font-serif text-4xl text-white">Try the tailoring pipeline</h1>
        <p className="mt-3 text-sm text-white/60">
          Paste your resume and a job description, bring your own{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 underline underline-offset-2 hover:text-violet-300"
          >
            Anthropic API key
          </a>
          , and get a real tailored resume back. Nothing you paste here is stored —
          your resume, job description, and API key are used only for this
          request and never saved.
        </p>
        <div className="mt-8">
          <PlaygroundFlow />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the input step of the flow component**

Create `packages/web/components/PlaygroundFlow.tsx`:
```tsx
"use client";
import { useState } from "react";
import { playgroundApi, PlaygroundSuggestion } from "../lib/playground-api";
import { MasterResume } from "../lib/api";

type Step = "input" | "review" | "result";

export default function PlaygroundFlow() {
  const [step, setStep] = useState<Step>("input");
  const [resumeText, setResumeText] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [fetchStatus, setFetchStatus] = useState<"idle" | "fetching" | "done" | "failed">("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [masterResume, setMasterResume] = useState<MasterResume | null>(null);
  const [suggestions, setSuggestions] = useState<PlaygroundSuggestion[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);

  async function handleFetchJd() {
    const trimmed = jobUrl.trim();
    if (!trimmed) return;
    setFetchStatus("fetching");
    setError(null);
    try {
      const { text } = await playgroundApi.fetchJd(trimmed);
      setJdText(text);
      setFetchStatus("done");
    } catch {
      setFetchStatus("failed");
      setError("Couldn't fetch this page — paste the job description below.");
    }
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if ((!resumeText.trim() && !resumeFile) || !apiKey.trim() || !jdText.trim()) {
      setError("Provide your resume (paste or upload), an API key, and a job description first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const parsed = resumeFile
        ? await playgroundApi.parseResumeFile(resumeFile, apiKey)
        : await playgroundApi.parseResumeText(resumeText, apiKey);
      setMasterResume(parsed);
      const { suggestions: raw } = await playgroundApi.suggest(parsed, jdText, apiKey);
      setSuggestions(raw);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "input") {
    return (
      <form onSubmit={handleStart} className="bg-paper border border-paper-border rounded-xl p-6 flex flex-col gap-5">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-paper-ink">Your resume</label>
            <label className="text-xs text-violet-700 hover:text-violet-900 cursor-pointer underline underline-offset-2">
              {resumeFile ? `Uploaded: ${resumeFile.name} (change)` : "Upload a PDF instead"}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setResumeFile(file ?? null);
                  if (file) setResumeText("");
                }}
              />
            </label>
          </div>
          {!resumeFile && (
            <textarea
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              placeholder="Paste your resume text here…"
              rows={8}
              className="w-full border border-paper-border rounded-lg px-3 py-2.5 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white resize-y"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Anthropic API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            className="w-full border border-paper-border rounded-lg px-3 py-2 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          />
          <p className="text-xs text-paper-muted mt-1.5">Never stored — used only for this request.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Job URL (optional)</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={jobUrl}
              onChange={(e) => {
                setJobUrl(e.target.value);
                if (fetchStatus !== "idle") setFetchStatus("idle");
              }}
              placeholder="https://boards.greenhouse.io/company/jobs/1234567"
              className="flex-1 border border-paper-border rounded-lg px-3 py-2 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
            />
            <button
              type="button"
              onClick={handleFetchJd}
              disabled={fetchStatus === "fetching" || !jobUrl.trim()}
              className="flex-shrink-0 px-4 py-2 border border-paper-border rounded-lg text-sm font-medium text-paper-ink hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors bg-white"
            >
              {fetchStatus === "fetching" ? "Fetching…" : "Fetch JD"}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Job description</label>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the job description here…"
            rows={8}
            className="w-full border border-paper-border rounded-lg px-3 py-2.5 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white resize-y"
          />
        </div>

        {error && (
          <div className="bg-red-100 border border-red-300 text-red-800 rounded-lg px-3 py-2.5 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Generating suggestions…" : "Generate suggestions"}
        </button>
      </form>
    );
  }

  // Review and result steps are added in Tasks 8 and 9.
  return null;
}
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build --workspace=packages/web`
Expected: build succeeds. `/playground` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/playground packages/web/components/PlaygroundFlow.tsx
git commit -m "feat: add playground landing page and input step"
```

---

### Task 8: Review step (suggestion checklist)

**Files:**
- Modify: `packages/web/components/PlaygroundFlow.tsx`

**Interfaces:**
- Consumes: `playgroundApi.apply` (Task 6).
- Produces: the review step's UI and the transition into Task 9's result step (`markdown`/`pdfBase64` state, already declared in Task 7).

- [ ] **Step 1: Add the review step**

In `packages/web/components/PlaygroundFlow.tsx`, replace the final `return null;` (the placeholder for review/result) with:
```tsx
  function toggleSuggestion(id: string) {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, accepted: !s.accepted } : s))
    );
  }

  function editSuggestionText(id: string, text: string) {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, suggestedText: text } : s))
    );
  }

  async function handleApply() {
    if (!masterResume) return;
    setLoading(true);
    setError(null);
    try {
      const accepted = suggestions.filter((s) => s.accepted);
      const { markdown: finalMarkdown, pdfBase64: finalPdf } = await playgroundApi.apply(
        masterResume,
        accepted,
        apiKey
      );
      setMarkdown(finalMarkdown);
      setPdfBase64(finalPdf);
      setStep("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "review") {
    const acceptedCount = suggestions.filter((s) => s.accepted).length;
    return (
      <div className="bg-paper border border-paper-border rounded-xl p-6 flex flex-col gap-4">
        <p className="text-sm text-paper-muted">
          Review each suggested change before it&apos;s applied. Uncheck anything you
          don&apos;t want, or edit the wording directly.
        </p>

        {suggestions.length === 0 ? (
          <p className="text-sm text-paper-muted">
            No keyword suggestions found for this job description — your resume already covers it well.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {suggestions.map((s) => (
              <label
                key={s.id}
                className="flex gap-3 border border-paper-border rounded-xl p-3 bg-white hover:border-violet-300 transition-colors cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!!s.accepted}
                  onChange={() => toggleSuggestion(s.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-paper-ink">{s.keyword}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        s.groundedness === "grounded"
                          ? "bg-green-100 text-green-800 border border-green-300"
                          : "bg-amber-100 text-amber-800 border border-amber-300"
                      }`}
                    >
                      {s.groundedness}
                    </span>
                  </div>
                  {s.kind === "bullet-rewrite" ? (
                    <textarea
                      value={s.suggestedText}
                      onChange={(e) => editSuggestionText(s.id, e.target.value)}
                      rows={2}
                      onClick={(e) => e.preventDefault()}
                      className="w-full text-sm font-mono border border-paper-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none bg-white text-paper-ink"
                    />
                  ) : (
                    <p className="text-sm font-medium text-paper-ink">
                      Add &quot;{s.suggestedText}&quot; to {s.targetId}
                    </p>
                  )}
                  <p className="text-xs text-paper-muted mt-1">{s.rationale}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-100 border border-red-300 text-red-800 rounded-lg px-3 py-2.5 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleApply}
          disabled={loading}
          className="bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading
            ? "Finalizing…"
            : suggestions.length === 0
            ? "Continue with resume as-is"
            : `Apply ${acceptedCount} selected`}
        </button>
      </div>
    );
  }

  return null;
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build --workspace=packages/web`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/web/components/PlaygroundFlow.tsx
git commit -m "feat: add playground review step (suggestion checklist)"
```

---

### Task 9: Result step (PDF preview + download)

**Files:**
- Modify: `packages/web/components/PlaygroundFlow.tsx`

**Interfaces:** None new — final step of the existing component.

- [ ] **Step 1: Add the result step**

In `packages/web/components/PlaygroundFlow.tsx`, replace the final `return null;` with:
```tsx
  const pdfDataUrl = pdfBase64 ? `data:application/pdf;base64,${pdfBase64}` : null;

  function handleStartOver() {
    setStep("input");
    setResumeText("");
    setResumeFile(null);
    setJobUrl("");
    setJdText("");
    setFetchStatus("idle");
    setMasterResume(null);
    setSuggestions([]);
    setMarkdown("");
    setPdfBase64(null);
    setError(null);
  }

  return (
    <div className="bg-paper border border-paper-border rounded-xl p-6 flex flex-col gap-4">
      <p className="text-sm text-paper-muted">Your tailored resume is ready.</p>

      {pdfDataUrl ? (
        <div className="border border-paper-border rounded-lg overflow-hidden" style={{ height: "70vh" }}>
          <iframe src={pdfDataUrl} className="w-full h-full border-0" title="Tailored resume PDF" />
        </div>
      ) : (
        <div className="border border-paper-border rounded-lg p-4 bg-white">
          <pre className="text-xs font-mono whitespace-pre-wrap text-paper-ink">{markdown}</pre>
        </div>
      )}

      <div className="flex gap-3">
        {pdfDataUrl && (
          <a
            href={pdfDataUrl}
            download="tailored-resume.pdf"
            className="flex-1 text-center bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-lg text-sm transition-colors"
          >
            Download PDF
          </a>
        )}
        <button
          onClick={handleStartOver}
          className="flex-1 border border-paper-border hover:bg-black/5 text-paper-ink font-medium py-3 rounded-lg text-sm transition-colors bg-white"
        >
          Start over
        </button>
      </div>
    </div>
  );
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build --workspace=packages/web`
Expected: build succeeds.

- [ ] **Step 3: Manual end-to-end verification, via `/run`**

Start both services locally with `PLAYGROUND_IP_PEPPER` and a real (personal/test) `apiKey` on hand:
1. Visit `http://localhost:3000/playground` while **signed out** — confirm it loads (no redirect to `/login`).
2. Paste a short resume, a real Anthropic API key, and a JD (try both the paste path and the URL-fetch path across two runs).
3. Confirm the review step shows suggestions with grounded/extrapolated badges; uncheck one, edit the wording on another.
4. Click through to the result step; confirm the PDF preview renders and reflects only the accepted (and edited) changes.
5. Download the PDF, open it, confirm it matches.
6. Click "Start over," confirm the flow resets cleanly to the input step.
7. `curl` the agent directly (`http://localhost:3001/api/playground/parse-resume`, no `X-Internal-Secret`) — confirm 401, same protection as every other agent route.
8. Query the local DB (`psql` or any client) and confirm `tailored_resumes` and `master_resume` have zero new rows from the playground run, and `playground_usage` has exactly the expected number of rows (one per `parse-resume` call made during testing).

- [ ] **Step 4: Commit**

```bash
git add packages/web/components/PlaygroundFlow.tsx
git commit -m "feat: add playground result step (PDF preview + download)"
```
