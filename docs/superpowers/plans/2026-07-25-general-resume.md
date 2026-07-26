# General (JD-less) Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-page, JD-less "General Resume" that's AI-curated from the Master Resume, editable independently, and re-syncable on demand — reusing the existing `tailored_resumes` pipeline and `ResumeEditor` UI instead of building a parallel stack.

**Architecture:** The general resume is a singleton row in the existing `tailored_resumes` table (`kind='general'`, DB-enforced via a partial unique index). Generation reuses `generateBestResume()` unmodified with a canned generic prompt standing in for a JD, then runs the result through `fitToOnePage()` (existing, currently-unwired code) for a hard one-page guarantee. Every other capability — editing, PDF preview, download, email, async pending/ready polling — comes free from the existing `/api/resume/:id` routes and `ResumeEditor.tsx`, untouched. `/resume/master` gains a Master/General mode toggle; General mode is a thin wrapper (`GeneralResumeTab.tsx`) around `ResumeEditor`.

**Tech Stack:** Express + `pg` (agent API), Next.js App Router + React (web), PostgreSQL, `tsx` for standalone verification scripts (this repo's existing test convention — no Jest/Vitest present).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-general-resume-design.md`
- The tailorer's scope for the general resume is IDENTICAL to job-tailored resumes: only experience/projects/skills(languages/frameworks/tools) are AI-curated. Education, extracurriculars, interests, and contact info are always copied verbatim from Master — this is already how `tailorResume()`/`tailorableSlice()` work today and must not change.
- At most one `kind='general'` row may ever exist — enforced at the DB level via a partial unique index, not just application logic.
- Syncing (generation) is always an explicit user action (a button), never automatic on Master save.
- `ResumeEditor.tsx` is reused completely unmodified.
- `generateBestResume()` and `tailorResume()` (in `chain.ts`/`tailor.ts`) are reused completely unmodified — the only new AI-side code is the canned prompt and the `fitToOnePage()` call around it.
- This codebase has no Jest/Vitest — its own test convention is standalone `tsx`-run scripts under `src/*/test-*.ts` with boolean assertions and `process.exit(pass ? 0 : 1)`, wired up as `npm run test:*` scripts. Follow that convention; do not introduce a new test framework.

---

### Task 1: DB schema + general-resume queries

**Files:**
- Modify: `packages/agent/src/db/schema.ts` (insert after the `status`/`error` migration block, currently ending at line 136, before the `CREATE INDEX IF NOT EXISTS idx_tailored_resumes_created ...` block at line 138–142)
- Modify: `packages/agent/src/db/queries.ts` (add after `listTailoredResumes()`, currently ending at line 197)
- Create: `packages/agent/src/db/test-general-resume.ts`
- Modify: `packages/agent/package.json` (add `test:general-resume` script)

**Interfaces:**
- Produces: `getGeneralResume(): Promise<TailoredResumeRow | null>`, `upsertPendingGeneralResume(): Promise<TailoredResumeRow>` (both exported from `queries.ts`) — Task 4's route consumes these directly.
- Produces: `listTailoredResumes()` now excludes `kind='general'` rows — the `/` dashboard (existing `resumesRouter`) picks this up automatically, no route change needed.

- [ ] **Step 1: Write the failing verification script**

Create `packages/agent/src/db/test-general-resume.ts`:

```ts
import { pool } from "./pool";
import { initSchema } from "./schema";
import {
  listTailoredResumes,
  getGeneralResume,
  upsertPendingGeneralResume,
  createPendingResume,
  completeTailoredResume,
} from "./queries";

async function main() {
  await initSchema();

  // Clean slate for repeat runs of this script.
  await pool.query(
    "DELETE FROM tailored_resumes WHERE job_title IN ($1, $2)",
    ["General Software Engineer", "__test_tailored__"]
  );

  const beforeAny = await getGeneralResume();
  const noneYet = beforeAny === null;

  const first = await upsertPendingGeneralResume();
  const firstOk = first.status === "pending" && first.job_title === "General Software Engineer";

  const second = await upsertPendingGeneralResume();
  const singleton = second.id === first.id;

  await completeTailoredResume(first.id, { markdown: "# Test General Resume", criticScore: 90 });
  const afterComplete = await getGeneralResume();
  const completedOk =
    afterComplete !== null &&
    afterComplete.status === "ready" &&
    afterComplete.markdown === "# Test General Resume";

  const tailored = await createPendingResume({ jobTitle: "__test_tailored__", company: "Acme" });
  const list = await listTailoredResumes();
  const listExcludesGeneral = !list.some((r) => r.id === first.id);
  const listIncludesTailored = list.some((r) => r.id === tailored.id);

  // Clean up this run's rows.
  await pool.query("DELETE FROM tailored_resumes WHERE id = ANY($1)", [[first.id, tailored.id]]);

  const pass =
    noneYet && firstOk && singleton && completedOk && listExcludesGeneral && listIncludesTailored;

  console.log(
    `noneYet:${noneYet} firstOk:${firstOk} singleton:${singleton} completedOk:${completedOk} ` +
    `listExcludesGeneral:${listExcludesGeneral} listIncludesTailored:${listIncludesTailored}`
  );
  console.log(pass ? "\n✓ general-resume DB test PASSED" : "\n✗ general-resume DB test FAILED");

  await pool.end();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Add the script entry to `packages/agent/package.json`, in the `scripts` block right after `"test:critic": "tsx src/ai/test-critic.ts",`:

```json
    "test:general-resume": "tsx src/db/test-general-resume.ts",
```

- [ ] **Step 2: Run it to confirm it fails**

Requires local Postgres running (`docker-compose up -d` from the repo root if not already up).

Run: `cd packages/agent && npm run test:general-resume`
Expected: FAIL — `getGeneralResume`, `upsertPendingGeneralResume` don't exist yet (TypeScript/import error), or the DB call errors because the `kind` column doesn't exist.

- [ ] **Step 3: Add the schema migration**

In `packages/agent/src/db/schema.ts`, insert immediately after this existing block (ends at line 136):

```ts
  await pool.query(`
    ALTER TABLE tailored_resumes DROP CONSTRAINT IF EXISTS tailored_resumes_status_check;
    ALTER TABLE tailored_resumes ADD CONSTRAINT tailored_resumes_status_check
      CHECK (status IN ('pending','ready','failed'));
  `);
```

add:

```ts
  // The general resume: a JD-less, one-page resume synced from Master, reusing
  // this same table/pipeline/editor as job-tailored resumes rather than a
  // parallel stack. 'kind' distinguishes the (at most one) general row from
  // ordinary tailored ones; the partial unique index makes "at most one"
  // a DB-level guarantee, not just application discipline.
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'tailored';
  `);
  await pool.query(`
    ALTER TABLE tailored_resumes DROP CONSTRAINT IF EXISTS tailored_resumes_kind_check;
    ALTER TABLE tailored_resumes ADD CONSTRAINT tailored_resumes_kind_check
      CHECK (kind IN ('tailored', 'general'));
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tailored_resumes_one_general
      ON tailored_resumes ((true)) WHERE kind = 'general';
  `);
```

- [ ] **Step 4: Add the queries**

In `packages/agent/src/db/queries.ts`, insert immediately after `listTailoredResumes()` (ends at line 197):

```ts
/** The singleton general (JD-less) resume, or null if never generated. */
export async function getGeneralResume(): Promise<TailoredResumeRow | null> {
  const { rows } = await pool.query(
    `SELECT ${TAILORED_RESUME_COLUMNS} FROM tailored_resumes WHERE kind = 'general' LIMIT 1`
  );
  return rows[0] ?? null;
}

/**
 * Upserts the singleton general-resume row to 'pending', reusing the same
 * row id across every regeneration (so its URL/PDF link never changes).
 * The ON CONFLICT target matches idx_tailored_resumes_one_general exactly —
 * Postgres requires the inference expression/predicate to match the index.
 */
export async function upsertPendingGeneralResume(): Promise<TailoredResumeRow> {
  const { rows } = await pool.query(
    `INSERT INTO tailored_resumes (job_title, company, markdown, status, kind)
     VALUES ('General Software Engineer', NULL, '', 'pending', 'general')
     ON CONFLICT ((true)) WHERE kind = 'general'
     DO UPDATE SET status = 'pending', error = NULL, updated_at = NOW()
     RETURNING ${TAILORED_RESUME_COLUMNS}`
  );
  return rows[0];
}
```

Modify `listTailoredResumes()` (lines 191–197) to exclude the general resume:

```ts
export async function listTailoredResumes(): Promise<ResumeListItem[]> {
  const { rows } = await pool.query(
    `SELECT id, job_title, company, location, job_url, critic_score, pdf_error, status, error, created_at, updated_at
     FROM tailored_resumes WHERE kind = 'tailored' ORDER BY created_at DESC`
  );
  return rows;
}
```

- [ ] **Step 5: Run it to confirm it passes**

Run: `cd packages/agent && npm run test:general-resume`
Expected: PASS — `✓ general-resume DB test PASSED`, exit code 0.

If Postgres rejects the `ON CONFLICT ((true)) WHERE kind = 'general'` clause
in `upsertPendingGeneralResume()` (the inference target must match the
partial index's expression and predicate exactly, which can be
version-sensitive) — as a fallback, drop the `ON CONFLICT` clause entirely
and instead do it in two statements: `SELECT id FROM tailored_resumes WHERE
kind = 'general' LIMIT 1`, then either `UPDATE ... WHERE id = $1` (found) or
`INSERT ...` (not found), inside a single `pool.query` transaction if
`pg`'s `pool.connect()`/`client.query('BEGIN')` pattern is already used
elsewhere in this file (it isn't today — every other write here is a lone
`pool.query` call, so a plain sequential select-then-write, same as
`getMasterResume()`'s "seed if missing" pattern at `queries.ts:87-99`, is
consistent with the codebase's existing style and fine given this endpoint
is never called concurrently with itself in practice).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/db/schema.ts packages/agent/src/db/queries.ts \
        packages/agent/src/db/test-general-resume.ts packages/agent/package.json
git commit -m "feat: add kind column + singleton queries for the general resume"
```

---

### Task 2: Wire `fitToOnePage()` into the existing tailored-resume pipeline

**Files:**
- Modify: `packages/agent/src/api/routes/tailor.ts:79-114` (`runTailorPipeline`)

**Interfaces:**
- Consumes: `fitToOnePage(markdown: string): Promise<{ markdown: string; pdf: Buffer }>` from `../../ai/fit-page` (existing, currently unused elsewhere).

- [ ] **Step 1: Replace `runTailorPipeline`**

This is the pre-existing gap noted in the design spec: `fitToOnePage()` was built but never wired in. Regular tailored resumes land near one page today only via prompt-level bullet-count constraints, not any actual page-fit check. This wires it in as a safety net, preserving the existing graceful-degradation behavior (a PDF/page-fit failure surfaces as `pdf_error`, not a failed resume).

In `packages/agent/src/api/routes/tailor.ts`, add the import at the top (after the existing `renderPdf` import on line 11):

```ts
import { fitToOnePage } from "../../ai/fit-page";
```

Replace the whole `runTailorPipeline` function (lines 79–114):

```ts
async function runTailorPipeline(
  id: string,
  jd: string,
  opts: { jobTitle?: string; company?: string }
) {
  let result;
  try {
    result = await generateBestResume(jd, opts);
  } catch (err) {
    console.error("[tailor] pipeline error:", err);
    const credentialHint =
      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    await failTailoredResume(id, `Tailoring failed — ${credentialHint} and try again.`);
    return;
  }

  // Fit to one page (page-count check + LLM trim/widow-fix loop). A failure
  // here degrades gracefully — the resume still completes with the
  // un-fitted markdown, and the PDF render further down reports the error
  // via pdf_error, same as any other PDF render failure.
  let finalMarkdown = result.markdown;
  let fittedPdf: Buffer | null = null;
  try {
    const fitted = await fitToOnePage(result.markdown);
    finalMarkdown = fitted.markdown;
    fittedPdf = fitted.pdf;
  } catch (err) {
    console.error("[tailor] fitToOnePage failed, continuing with un-fitted markdown:", err);
  }

  try {
    await completeTailoredResume(id, {
      markdown: finalMarkdown,
      criticScore: result.critic.finalScore,
    });
  } catch (err) {
    console.error("[tailor] db error saving result:", err);
    await failTailoredResume(id, "Failed to save resume — database error.").catch(() => {});
    return;
  }

  // Store the PDF fitToOnePage already rendered, if it succeeded; otherwise
  // fall back to rendering the un-fitted markdown directly, same as before
  // this change. Either way this runs in the background — /pdf generates
  // on-demand if not ready yet.
  if (fittedPdf) {
    storePdf(id, fittedPdf).catch((err) => {
      console.error("[tailor] pdf store failed:", err);
      setPdfError(id, err instanceof Error ? err.message : String(err)).catch(() => {});
    });
  } else {
    renderPdf(finalMarkdown)
      .then((pdf) => storePdf(id, pdf))
      .catch((err) => {
        console.error("[tailor] pdf render failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        setPdfError(id, message).catch(() => {});
      });
  }
}
```

- [ ] **Step 2: Typecheck**

No automated test exists for this LLM-calling pipeline in this codebase (same as `chain.ts`/`tailor.ts`, which have no `test-*.ts` script either) — verify with a typecheck instead.

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/api/routes/tailor.ts
git commit -m "fix: wire fitToOnePage() into the tailored-resume pipeline as a one-page safety net"
```

(End-to-end confirmation that a real tailored resume still renders correctly happens in Task 8's manual verification pass.)

---

### Task 3: Generic-prompt generation module

**Files:**
- Create: `packages/agent/src/ai/general-resume.ts`

**Interfaces:**
- Consumes: `generateBestResume(jd: string, opts?: GenerateOptions): Promise<GenerateResult>` from `./chain` (unmodified); `fitToOnePage(markdown: string): Promise<{ markdown: string; pdf: Buffer }>` from `./fit-page`.
- Produces: `GENERIC_SWE_PROMPT: string` and `generateGeneralResume(): Promise<{ markdown: string; pdf: Buffer; criticScore: number }>` — Task 4's route consumes `generateGeneralResume()`.

- [ ] **Step 1: Write the module**

```ts
import { generateBestResume } from "./chain";
import { fitToOnePage } from "./fit-page";

/**
 * Stands in for a real job description when there's no specific posting to
 * tailor against. Fed through the exact same generateBestResume() pipeline
 * as a job-tailored resume — this is the only thing that makes the general
 * resume "general" rather than a raw, uncurated dump of the master resume.
 */
export const GENERIC_SWE_PROMPT = `General Software Engineer — no specific job posting.

This resume isn't tailored to one job description; it's a general-purpose,
one-page resume for cold outreach, career fairs, and "send me your resume"
requests. Select and rank the strongest, most broadly impressive experience
across backend, full-stack, and systems engineering: distributed systems,
APIs and services, cloud infrastructure (AWS/GCP/Azure), databases (SQL and
NoSQL), CI/CD, containers and orchestration (Docker, Kubernetes), testing
and observability, and modern web frameworks (React, Node.js, TypeScript,
Python, Go, Java). Favor bullets with the clearest, most quantified impact
over ones that are merely broad in scope. Lead with what would impress the
widest range of software engineering hiring managers, not what matches any
single company's stack.`;

export type GeneralResumeResult = {
  markdown: string;
  pdf: Buffer;
  criticScore: number;
};

/**
 * Generates the general resume: the standard generate->critique->revise
 * loop against GENERIC_SWE_PROMPT, then a hard one-page fit pass. Unlike
 * job-tailored resumes there's no JD to naturally narrow content down to a
 * page, so fitToOnePage() is load-bearing here, not just a safety net.
 */
export async function generateGeneralResume(): Promise<GeneralResumeResult> {
  const result = await generateBestResume(GENERIC_SWE_PROMPT, {
    jobTitle: "General Software Engineer",
  });
  const fitted = await fitToOnePage(result.markdown);
  return {
    markdown: fitted.markdown,
    pdf: fitted.pdf,
    criticScore: result.critic.finalScore,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/ai/general-resume.ts
git commit -m "feat: add generateGeneralResume() with a canned generic-SWE prompt"
```

---

### Task 4: `/api/general-resume` routes

**Files:**
- Create: `packages/agent/src/api/routes/general-resume.ts`
- Modify: `packages/agent/src/api/index.ts:1-18`

**Interfaces:**
- Consumes: `getGeneralResume`, `upsertPendingGeneralResume`, `completeTailoredResume`, `failTailoredResume`, `storePdf`, `setPdfError` from `../../db/queries` (all exist; first two from Task 1); `generateGeneralResume` from `../../ai/general-resume` (Task 3); `LLM_PROVIDER` from `../../ai/llm` (existing).
- Produces: `GET /api/general-resume` (200 row | 404 `{ error: "Not found" }`), `POST /api/general-resume/generate` (202 `{ id, status: "pending" }`).

- [ ] **Step 1: Write the route**

```ts
import { Router } from "express";
import {
  getGeneralResume,
  upsertPendingGeneralResume,
  completeTailoredResume,
  failTailoredResume,
  storePdf,
  setPdfError,
} from "../../db/queries";
import { generateGeneralResume } from "../../ai/general-resume";
import { LLM_PROVIDER } from "../../ai/llm";

const router = Router();

// GET /api/general-resume
router.get("/", async (_req, res) => {
  const row = await getGeneralResume();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

// POST /api/general-resume/generate — (re)generate the singleton general
// resume from the current saved Master Resume. Same async shape as
// POST /api/tailor: the generate->critique->revise loop plus the one-page
// fit pass routinely run past Railway's ~300s edge-proxy timeout.
router.post("/generate", async (_req, res) => {
  let row;
  try {
    row = await upsertPendingGeneralResume();
  } catch (err) {
    console.error("[general-resume] db error:", err);
    res.status(500).json({ error: "Failed to start generation — database error." });
    return;
  }

  res.status(202).json({ id: row.id, status: "pending" });

  runGeneralResumePipeline(row.id).catch((err) => {
    console.error("[general-resume] background pipeline crashed:", err);
  });
});

async function runGeneralResumePipeline(id: string) {
  let result;
  try {
    result = await generateGeneralResume();
  } catch (err) {
    console.error("[general-resume] pipeline error:", err);
    const credentialHint =
      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    await failTailoredResume(id, `Generation failed — ${credentialHint} and try again.`);
    return;
  }

  try {
    await completeTailoredResume(id, { markdown: result.markdown, criticScore: result.criticScore });
  } catch (err) {
    console.error("[general-resume] db error saving result:", err);
    await failTailoredResume(id, "Failed to save resume — database error.").catch(() => {});
    return;
  }

  try {
    await storePdf(id, result.pdf);
  } catch (err) {
    console.error("[general-resume] pdf store failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    await setPdfError(id, message).catch(() => {});
  }
}

export default router;
```

- [ ] **Step 2: Mount the router**

In `packages/agent/src/api/index.ts`, add the import after `import placesRouter from "./routes/places";` (line 7):

```ts
import generalResumeRouter from "./routes/general-resume";
```

Add the mount after `router.use("/places", placesRouter);` (line 16):

```ts
router.use("/general-resume", generalResumeRouter);
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Requires the agent dev server running (`cd packages/agent && npm run dev`) against a local Postgres with Task 1's migration applied (it applies automatically on boot via `initSchema()`).

```bash
curl -i http://localhost:3001/api/general-resume
# Expected: HTTP 404, {"error":"Not found"}

curl -i -X POST http://localhost:3001/api/general-resume/generate
# Expected: HTTP 202, {"id":"...","status":"pending"}

sleep 5 && curl -s http://localhost:3001/api/general-resume | head -c 300
# Expected: status "pending" (generation takes a few minutes) or, once
# finished, "ready" with non-empty markdown.
```

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/api/routes/general-resume.ts packages/agent/src/api/index.ts
git commit -m "feat: add GET/POST /api/general-resume routes"
```

---

### Task 5: Frontend API client additions

**Files:**
- Modify: `packages/web/lib/api.ts:154-203`

**Interfaces:**
- Consumes: existing `Resume` type (`lib/api.ts:20-23`), existing `request()` helper.
- Produces: `api.getGeneralResume(): Promise<Resume>` (throws `Error("Not found")` on 404, matching `api.getResume()`'s existing error-message convention that `ResumeEditor.tsx:264` already checks against), `api.generateGeneralResume(): Promise<{ id: string; status: "pending" }>`.

- [ ] **Step 1: Add the two methods**

In `packages/web/lib/api.ts`, inside the `export const api = { ... }` object, add after the existing `putMasterResume` entry (line 181):

```ts
  getGeneralResume: () => request<Resume>("GET", "/general-resume"),
  generateGeneralResume: () => request<{ id: string; status: "pending" }>("POST", "/general-resume/generate"),
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/lib/api.ts
git commit -m "feat: add getGeneralResume/generateGeneralResume to the web API client"
```

---

### Task 6: `GeneralResumeTab` component

**Files:**
- Create: `packages/web/components/GeneralResumeTab.tsx`

**Interfaces:**
- Consumes: `api.getGeneralResume`, `api.generateGeneralResume` (Task 5); `Resume` type from `../lib/api`; `ResumeEditor` (default export) from `./ResumeEditor` — used exactly as-is, no props beyond the existing `resume: Resume`.
- Produces: `GeneralResumeTab` default export, a self-contained component taking no props — Task 7 renders `<GeneralResumeTab />` with nothing else to wire up.

- [ ] **Step 1: Write the component**

```tsx
"use client";
import { useState, useEffect, useCallback } from "react";
import { api, Resume } from "../lib/api";
import ResumeEditor from "./ResumeEditor";

export default function GeneralResumeTab() {
  const [resume, setResume] = useState<Resume | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const row = await api.getGeneralResume();
      setResume(row);
    } catch (e) {
      if (e instanceof Error && e.message === "Not found") {
        setNotFound(true);
      } else {
        setLoadError(e instanceof Error ? e.message : "Failed to load the general resume.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleGenerate(isResync: boolean) {
    if (
      isResync &&
      !window.confirm("Regenerating will overwrite your manual edits to the general resume. Continue?")
    ) {
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      await api.generateGeneralResume();
      await load();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Failed to start generation.");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading…</div>
    );
  }

  if (loadError) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-red-600 px-6 text-center">
        {loadError}
      </div>
    );
  }

  if (notFound || !resume) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-gray-500 max-w-sm">
          No general resume yet. Generate a one-page, JD-less resume from your Master Resume — good
          for career fairs, cold outreach, or anywhere you don&apos;t have a specific job description.
        </p>
        <button
          onClick={() => handleGenerate(false)}
          disabled={generating}
          className="text-sm px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {generating ? "Generating…" : "Generate General Resume"}
        </button>
        {genError && <p className="text-xs text-red-600">{genError}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200 px-4 py-2 flex items-center justify-between flex-shrink-0 bg-white">
        <span className="text-xs font-medium text-gray-600">General Resume — synced from Master</span>
        <div className="flex items-center gap-2">
          {genError && <span className="text-xs text-red-600">{genError}</span>}
          <button
            onClick={() => handleGenerate(true)}
            disabled={generating}
            className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {generating ? "Syncing…" : "Sync from Master ⟳"}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResumeEditor resume={resume} key={resume.updated_at} />
      </div>
    </div>
  );
}
```

The `key={resume.updated_at}` forces `ResumeEditor` to fully remount whenever the row's `updated_at` changes — in particular right after a sync, when `upsertPendingGeneralResume()` bumps `updated_at` and flips `status` back to `'pending'`. `ResumeEditor` only initializes its local state from props on mount, so without the fresh `key` it would keep showing the previous (stale) `'ready'` state instead of picking up the new pending row and starting to poll.

- [ ] **Step 2: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/components/GeneralResumeTab.tsx
git commit -m "feat: add GeneralResumeTab, wrapping ResumeEditor for the general resume"
```

---

### Task 7: Master/General mode toggle on `/resume/master`

**Files:**
- Modify: `packages/web/components/MasterResumeForm.tsx`

**Interfaces:**
- Consumes: `GeneralResumeTab` (Task 6, default export, no props); `api.generateGeneralResume` (Task 5).

- [ ] **Step 1: Add imports and state**

Add the import after the existing `SortableSection` import (line 5):

```tsx
import GeneralResumeTab from "./GeneralResumeTab";
```

Inside the `MasterResumeForm` component, add new state right after the existing `hasAttemptedPreviewRef` declaration (line 101):

```tsx
  const [mode, setMode] = useState<"master" | "general">("master");
  const [dirty, setDirty] = useState(false);
  const isFirstRenderRef = useRef(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Any edit to the Master form marks it dirty; "Sync to General" is
  // disabled while dirty because syncing always reads the DB-persisted
  // master resume (same source getMasterResume() uses everywhere else),
  // so unsaved form edits would silently not be reflected in a sync.
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    setDirty(true);
  }, [resume]);
```

- [ ] **Step 2: Clear `dirty` on successful save and add the sync handler**

Modify the existing `save()` function (lines 103–115) — add `setDirty(false);` right after `setSaved(true);`:

```tsx
  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.putMasterResume(resume);
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }
```

Add a new `syncToGeneral` function right after `save()`:

```tsx
  async function syncToGeneral() {
    setSyncing(true);
    setSyncError(null);
    try {
      await api.generateGeneralResume();
      setMode("general");
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }
```

- [ ] **Step 3: Add the mode toggle to the sidebar**

Replace the sidebar block (lines 379–395):

```tsx
      {/* Section tabs */}
      <div className="w-44 flex-shrink-0 border-r border-gray-200 bg-white px-3 py-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">Sections</p>
        {SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
              activeSection === s
                ? "bg-violet-50 text-violet-700 font-medium"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
```

with:

```tsx
      {/* Section tabs */}
      <div className="w-44 flex-shrink-0 border-r border-gray-200 bg-white px-3 py-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">Resume</p>
        {(["master", "general"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
              mode === m
                ? "bg-violet-50 text-violet-700 font-medium"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {m === "master" ? "Master Resume" : "General Resume"}
          </button>
        ))}

        {mode === "master" && (
          <>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2 mt-6">
              Sections
            </p>
            {SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
                  activeSection === s
                    ? "bg-violet-50 text-violet-700 font-medium"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                {s}
              </button>
            ))}
          </>
        )}
      </div>
```

- [ ] **Step 4: Gate the existing content pane behind `mode === "master"`, add General mode's pane**

Find the `PanelGroup` that wraps the form content and PDF preview (opens at line 398: `<PanelGroup direction="horizontal" className="flex-1 min-w-0">`, closes at line 730: `</PanelGroup>`). Wrap it in a `mode === "master"` conditional and add the General-mode branch right after. Change:

```tsx
      {/* Content + optional preview panel */}
      <PanelGroup direction="horizontal" className="flex-1 min-w-0">
```

to:

```tsx
      {/* Content + optional preview panel */}
      {mode === "general" ? (
        <div className="flex-1 min-w-0">
          <GeneralResumeTab />
        </div>
      ) : (
      <PanelGroup direction="horizontal" className="flex-1 min-w-0">
```

and change the closing:

```tsx
      </PanelGroup>
    </div>
  );
}
```

to:

```tsx
      </PanelGroup>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add the "Sync to General" button next to "Save Changes"**

In the header's button row, find the existing "Save Changes" button (lines 446–457):

```tsx
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save Changes"}
            </button>
```

Insert this immediately before it:

```tsx
            {syncError && <span className="text-xs text-red-600">{syncError}</span>}
            <button
              onClick={syncToGeneral}
              disabled={dirty || syncing}
              title={dirty ? "Save changes first" : "Regenerate the General Resume from this Master Resume"}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors font-medium"
            >
              {syncing ? "Syncing…" : "Sync to General ⟳"}
            </button>
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/web/components/MasterResumeForm.tsx
git commit -m "feat: add Master/General mode toggle and Sync to General on /resume/master"
```

---

### Task 8: End-to-end manual verification

No route/component-level automated test harness exists in this codebase (confirmed in Task 1–7: DB logic got a real `tsx` test script, everything downstream is LLM-calling or UI and is verified manually, matching how this repo has shipped prior features — e.g. `docs/superpowers/specs/2026-07-07-master-resume-drag-reorder-design.md`'s testing section explicitly relies on manual verification only).

- [ ] **Step 1: Start the stack**

```bash
docker-compose up -d
cd packages/agent && npm run dev &
cd packages/web && npm run dev &
```

- [ ] **Step 2: Confirm the migration applied cleanly**

```bash
cd packages/agent && npm run test:general-resume
```

Expected: `✓ general-resume DB test PASSED` (re-confirms Task 1 against whatever Postgres this environment is actually running, not just the earlier run).

- [ ] **Step 3: Generate a real tailored resume, confirm one-page wiring didn't regress it**

Via the browser: go to `/tailor`, paste a real job description, generate. Confirm the resume completes with `status: ready`, download the PDF, and confirm it's a single page (this exercises Task 2's `fitToOnePage()` wiring in the live pipeline — in particular, a resume that would have landed on one page anyway should render with unchanged content, not get needlessly trimmed).

- [ ] **Step 4: Generate the general resume from `/resume/master`**

Go to `/resume/master`, click the "General Resume" tab in the sidebar. Confirm the empty state renders. Click "Generate General Resume". Confirm it shows the pending/spinner state, then flips to the editor once ready (this can take a few minutes — same generate→critique→revise loop as a tailored resume, plus the fit-to-one-page pass). Download the PDF and confirm it's exactly one page.

- [ ] **Step 5: Confirm the tailoring scope matches Master exactly**

Compare the generated general resume's Education, Extracurriculars, Skills → Interests, and contact info sections against the Master Resume tab — they should be byte-for-byte identical (verbatim), with only Experience/Projects bullet selection and Languages/Frameworks/Tools ordering differing.

- [ ] **Step 6: Edit and save the general resume**

In the General Resume editor, change a bullet, confirm the auto-save indicator flips to "Auto-saved", refresh the page, confirm the edit persisted (this is `ResumeEditor.tsx`'s existing autosave behavior, unmodified — just confirming it works for a `kind='general'` row same as any other).

- [ ] **Step 7: Confirm sync overwrites edits, from both entry points**

From the General Resume tab, click "Sync from Master ⟳", confirm the browser `confirm()` prompt appears, confirm it re-generates and the manual edit from Step 6 is gone. Then switch to the Master Resume tab, make and save a small edit (e.g., add a skill), click "Sync to General ⟳", confirm it's disabled while the form is dirty (before saving) and enabled after saving, confirm clicking it switches to the General tab and re-generates, and confirm the new skill can now appear in the regenerated output if relevant.

- [ ] **Step 8: Confirm the dashboard stays clean**

Go to `/`, confirm the general resume never appears in the resume history list (only job-tailored resumes, per Task 1's `listTailoredResumes()` filter).
