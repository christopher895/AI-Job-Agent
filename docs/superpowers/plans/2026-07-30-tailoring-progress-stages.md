# Real Progress Stages for Resume Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic spinner on the resume-pending screen with a 4-segment stepper (Drafting → Critiquing → Revising → Finalizing) that reflects the real state of the generate→critique→revise pipeline, for both job-tailored and general resumes.

**Architecture:** The backend pipeline (`chain.ts`'s loop, plus the two callers in `tailor.ts` and `general-resume.ts`) reports its current stage through an `onProgress` callback into a new `stage TEXT` column on `tailored_resumes`. The existing 4-second poll in `ResumeEditor.tsx` picks up `stage` and drives a stepper component that maps stage strings to one of 4 fixed segments by prefix match.

**Tech Stack:** TypeScript, Express, PostgreSQL (`pg`), Next.js/React, `tsx` for running standalone test/smoke scripts (this repo has no Jest/Vitest — see Global Constraints).

## Global Constraints

- No test runner (Jest/Vitest) exists anywhere in the repo. The established pattern for backend tests is a standalone script under `src/**/test-*.ts`, added as an `npm run test:*` script in `packages/agent/package.json`, run via `tsx`, printing per-assertion booleans plus a final `PASS`/`FAIL` line and a matching `process.exit` code (see `packages/agent/src/db/test-general-resume.ts` for the exact convention — reuse it verbatim).
- Do not introduce a percentage/progress-bar number anywhere — stages are label-only (spec decision).
- Do not add PDF rendering as a tracked stage — it happens after `status` flips to `'ready'`, after which the frontend already stops polling (out of scope, unchanged).
- Do not change the 4-second poll interval or move to SSE/websockets.
- `stage` is nullable, no default, and is not part of `updated_at` bumps (a stage write is a high-frequency internal signal, not a content change).

---

### Task 1: DB column + queries for stage tracking

**Files:**
- Modify: `packages/agent/src/db/schema.ts` (add migration after line 154, before the `CREATE INDEX` block at line 156)
- Modify: `packages/agent/src/db/queries.ts` (`TailoredResumeRow` type at line 5-21, `TAILORED_RESUME_COLUMNS` at line 131, add `updateResumeStage` near `setPdfError`, update `upsertPendingGeneralResume` at line 213-222)
- Create: `packages/agent/src/db/test-stage-tracking.ts`
- Modify: `packages/agent/package.json` (add `test:stage-tracking` script)

**Interfaces:**
- Produces: `updateResumeStage(id: string, stage: string): Promise<void>` — exported from `packages/agent/src/db/queries.ts`, used by Task 3 and Task 4.
- Produces: `TailoredResumeRow.stage: string | null` — used by Task 3, Task 4, and the API routes that already spread `TAILORED_RESUME_COLUMNS` results directly into JSON responses (`resumes.ts`, `general-resume.ts` routes — no route code changes needed since they return the row as-is).

- [ ] **Step 1: Add the `stage` column migration**

In `packages/agent/src/db/schema.ts`, insert this block right after the `idx_tailored_resumes_one_general` block (after line 154) and before the `CREATE INDEX idx_tailored_resumes_created` block:

```ts
  // Tracks which real step of the generate->critique->revise pipeline a
  // pending row is on (e.g. "Drafting resume (pass 1)", "Critiquing draft"),
  // so the pending-state UI can show real progress instead of a generic
  // spinner. Only meaningful transiently while status = 'pending'.
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS stage TEXT;
  `);
```

- [ ] **Step 2: Add `stage` to the `TailoredResumeRow` type and `TAILORED_RESUME_COLUMNS`**

In `packages/agent/src/db/queries.ts`, update the type (currently lines 5-21):

```ts
export type TailoredResumeRow = {
  id: string;
  job_title: string | null;
  company: string | null;
  location: string | null;
  job_url: string | null;
  jd_text: string | null;
  markdown: string;
  critic_score: number | null;
  /** Error from the most recent PDF render attempt; null if the last attempt succeeded. */
  pdf_error: string | null;
  /** 'pending' while the generate->critique->revise pipeline is still running in the background. */
  status: "pending" | "ready" | "failed";
  /** Error from the tailoring pipeline itself, set when status = 'failed'. */
  error: string | null;
  /** Current pipeline step while status = 'pending' (e.g. "Drafting resume (pass 1)"); null otherwise. */
  stage: string | null;
  created_at: Date;
  updated_at: Date;
};
```

And update the column list (currently line 131):

```ts
const TAILORED_RESUME_COLUMNS =
  "id, job_title, company, location, job_url, jd_text, markdown, critic_score, pdf_error, status, error, stage, created_at, updated_at";
```

- [ ] **Step 3: Add `updateResumeStage` query**

In `packages/agent/src/db/queries.ts`, add this function directly above `export async function storePdf` (currently line 241):

```ts
/** Records the pipeline's current step for a pending row. Fire-and-forget by callers — a failed write must never abort generation. */
export async function updateResumeStage(id: string, stage: string): Promise<void> {
  await pool.query("UPDATE tailored_resumes SET stage = $1 WHERE id = $2", [stage, id]);
}
```

- [ ] **Step 4: Clear `stage` on general-resume regeneration**

In `packages/agent/src/db/queries.ts`, update `upsertPendingGeneralResume` (currently lines 213-222) so the `ON CONFLICT` path clears any stale stage from a previous run:

```ts
export async function upsertPendingGeneralResume(): Promise<TailoredResumeRow> {
  const { rows } = await pool.query(
    `INSERT INTO tailored_resumes (job_title, company, markdown, status, kind)
     VALUES ('General Software Engineer', NULL, '', 'pending', 'general')
     ON CONFLICT ((true)) WHERE kind = 'general'
     DO UPDATE SET status = 'pending', error = NULL, stage = NULL, updated_at = NOW()
     RETURNING ${TAILORED_RESUME_COLUMNS}`
  );
  return rows[0];
}
```

- [ ] **Step 5: Write the DB test script**

Create `packages/agent/src/db/test-stage-tracking.ts`, following the exact convention of `test-general-resume.ts` (real DB, self-cleaning, boolean assertions, `PASS`/`FAIL` line, matching exit code):

```ts
import { pool } from "./pool";
import { initSchema } from "./schema";
import {
  createPendingResume,
  updateResumeStage,
  getTailoredResume,
  upsertPendingGeneralResume,
  getGeneralResume,
} from "./queries";

async function main() {
  await initSchema();

  // Clean slate for repeat runs of this script.
  await pool.query("DELETE FROM tailored_resumes WHERE job_title = $1", ["__test_stage__"]);

  const row = await createPendingResume({ jobTitle: "__test_stage__", company: "Acme" });
  const startsNull = row.stage === null;

  await updateResumeStage(row.id, "Drafting resume (pass 1)");
  const afterFirstWrite = await getTailoredResume(row.id);
  const firstWriteOk = afterFirstWrite?.stage === "Drafting resume (pass 1)";

  await updateResumeStage(row.id, "Critiquing draft");
  const afterSecondWrite = await getTailoredResume(row.id);
  const secondWriteOk = afterSecondWrite?.stage === "Critiquing draft";

  // General-resume regeneration must clear a stale stage from a previous run.
  const firstGeneral = await upsertPendingGeneralResume();
  await updateResumeStage(firstGeneral.id, "Finalizing formatting");
  const secondGeneral = await upsertPendingGeneralResume();
  const sameRow = secondGeneral.id === firstGeneral.id;
  const staleStageCleared = secondGeneral.stage === null;
  const freshGeneral = await getGeneralResume();
  const freshGeneralClear = freshGeneral?.stage === null;

  // Clean up this run's rows.
  await pool.query("DELETE FROM tailored_resumes WHERE id = ANY($1)", [[row.id, firstGeneral.id]]);

  const pass =
    startsNull && firstWriteOk && secondWriteOk && sameRow && staleStageCleared && freshGeneralClear;

  console.log(
    `startsNull:${startsNull} firstWriteOk:${firstWriteOk} secondWriteOk:${secondWriteOk} ` +
    `sameRow:${sameRow} staleStageCleared:${staleStageCleared} freshGeneralClear:${freshGeneralClear}`
  );
  console.log(pass ? "\n✓ stage-tracking DB test PASSED" : "\n✗ stage-tracking DB test FAILED");

  await pool.end();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Register the test script**

In `packages/agent/package.json`, add this line to `"scripts"` (next to `"test:general-resume"`):

```json
    "test:stage-tracking": "tsx src/db/test-stage-tracking.ts",
```

- [ ] **Step 7: Run the test and verify it passes**

Requires local Postgres running (`docker-compose up -d` from repo root if not already up).

Run: `npm run test:stage-tracking --workspace=packages/agent`
Expected: last two lines are the boolean summary (all `true`) followed by `✓ stage-tracking DB test PASSED`, process exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/db/schema.ts packages/agent/src/db/queries.ts packages/agent/src/db/test-stage-tracking.ts packages/agent/package.json
git commit -m "feat: add stage column and updateResumeStage query for progress tracking"
```

---

### Task 2: `chain.ts` — emit draft/critique stage callbacks

**Files:**
- Modify: `packages/agent/src/ai/chain.ts` (whole file is 72 lines; loop is lines 30-71)
- Create: `packages/agent/src/ai/test-chain-progress-labels.ts`
- Modify: `packages/agent/package.json` (add `test:chain-progress-labels` script)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `GenerateOptions.onProgress?: (stage: string) => void` and the exported pure helper `draftStageLabel(iteration: number): string` — both used by Task 3 and Task 4 (which pass `onProgress` into `generateBestResume`, and by extension into `generateGeneralResume`).

- [ ] **Step 1: Write the failing test for the pure label helper**

Create `packages/agent/src/ai/test-chain-progress-labels.ts`:

```ts
import { draftStageLabel } from "./chain";

function main() {
  const pass1 = draftStageLabel(1) === "Drafting resume (pass 1)";
  const pass2 = draftStageLabel(2) === "Revising resume (pass 2)";
  const pass3 = draftStageLabel(3) === "Revising resume (pass 3)";

  const pass = pass1 && pass2 && pass3;
  console.log(`pass1:${pass1} pass2:${pass2} pass3:${pass3}`);
  console.log(pass ? "\n✓ chain progress label test PASSED" : "\n✗ chain progress label test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
```

Add to `packages/agent/package.json` `"scripts"`:

```json
    "test:chain-progress-labels": "tsx src/ai/test-chain-progress-labels.ts",
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:chain-progress-labels --workspace=packages/agent`
Expected: FAIL — `draftStageLabel` is not exported yet (TypeScript/module error, since `chain.ts` doesn't define it).

- [ ] **Step 3: Implement `draftStageLabel` and wire `onProgress` into the loop**

In `packages/agent/src/ai/chain.ts`, replace the full file contents with:

```ts
import { tailorResume, TailorOptions } from "./tailor";
import { evaluate, CriticResult } from "./critic";
import { getMasterResume } from "../db/queries";
import { TailoredResume } from "./types";
import { renderMarkdown } from "./format";

/**
 * The generate → critique → revise loop. Each pass tailors, scores with the
 * critic, and feeds the critic's fixes back into the next tailoring pass. Stops
 * when the score clears the target or iterations run out, and always returns the
 * BEST-scoring draft seen (never a regression).
 */

export type GenerateOptions = TailorOptions & {
  /** Max tailoring passes (default 3). */
  maxIterations?: number;
  /** Stop early once a non-gated draft reaches this score (default 80). */
  targetScore?: number;
  /** Reports the pipeline's current step (e.g. "Drafting resume (pass 1)") as it runs. */
  onProgress?: (stage: string) => void;
};

export type GenerateResult = {
  tailored: TailoredResume;
  critic: CriticResult;
  /** ATS-safe rendered résumé for the best draft. */
  markdown: string;
  iterations: number;
  history: { iteration: number; finalScore: number; gated: boolean }[];
};

/** Label for the draft step of a given iteration — pass 1 is a fresh draft, later passes are revisions. */
export function draftStageLabel(iteration: number): string {
  return iteration === 1 ? "Drafting resume (pass 1)" : `Revising resume (pass ${iteration})`;
}

export async function generateBestResume(jd: string, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const master = opts.master ?? await getMasterResume();
  const maxIterations = opts.maxIterations ?? 3;
  const targetScore = opts.targetScore ?? 80;

  let best: { tailored: TailoredResume; critic: CriticResult } | null = null;
  let feedback: string[] = [];
  const history: GenerateResult["history"] = [];

  for (let i = 1; i <= maxIterations; i++) {
    opts.onProgress?.(draftStageLabel(i));

    let tailored: TailoredResume;
    try {
      ({ tailored } = await tailorResume(jd, { ...opts, master, feedback }));
    } catch (err) {
      console.error(`[chain] iteration ${i} tailor step failed:`, err);
      throw err;
    }

    opts.onProgress?.("Critiquing draft");

    let critic: CriticResult;
    try {
      critic = await evaluate(master, tailored, jd, { model: opts.model });
    } catch (err) {
      console.error(`[chain] iteration ${i} critic step failed:`, err);
      throw err;
    }

    history.push({ iteration: i, finalScore: critic.finalScore, gated: critic.gated });

    if (!best || critic.finalScore > best.critic.finalScore) best = { tailored, critic };

    if (!critic.gated && critic.finalScore >= targetScore) break;
    feedback = critic.fixes; // drive the next revision
  }

  return {
    tailored: best!.tailored,
    critic: best!.critic,
    markdown: renderMarkdown(master, best!.tailored),
    iterations: history.length,
    history,
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test:chain-progress-labels --workspace=packages/agent`
Expected: `pass1:true pass2:true pass3:true` then `✓ chain progress label test PASSED`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/ai/chain.ts packages/agent/src/ai/test-chain-progress-labels.ts packages/agent/package.json
git commit -m "feat: emit onProgress stage callbacks from the generate-critique-revise loop"
```

---

### Task 3: Wire stage tracking into `/api/tailor`'s pipeline

**Files:**
- Modify: `packages/agent/src/api/routes/tailor.ts` (imports at lines 1-13; `runTailorPipeline` at lines 80-139)

**Interfaces:**
- Consumes: `updateResumeStage(id: string, stage: string): Promise<void>` from Task 1; `GenerateOptions.onProgress` from Task 2.
- Produces: nothing new consumed by later tasks (this is a leaf wiring task).

- [ ] **Step 1: Import `updateResumeStage`**

In `packages/agent/src/api/routes/tailor.ts`, update the import block (currently lines 3-9):

```ts
import {
  createPendingResume,
  completeTailoredResume,
  failTailoredResume,
  storePdf,
  setPdfError,
  updateResumeStage,
} from "../../db/queries";
```

- [ ] **Step 2: Pass `onProgress` into `generateBestResume` and emit "Finalizing formatting"**

In `packages/agent/src/api/routes/tailor.ts`, replace `runTailorPipeline` (currently lines 80-139) with:

```ts
async function runTailorPipeline(
  id: string,
  jd: string,
  opts: { jobTitle?: string; company?: string }
) {
  let result;
  try {
    result = await generateBestResume(jd, {
      ...opts,
      onProgress: (stage) => {
        updateResumeStage(id, stage).catch((err) => {
          console.error("[tailor] stage update failed:", err);
        });
      },
    });
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
  await updateResumeStage(id, "Finalizing formatting").catch((err) => {
    console.error("[tailor] stage update failed:", err);
  });
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

Note `updateResumeStage(id, "Finalizing formatting")` is awaited directly (not fire-and-forget like the callback) since it's a single call right before `fitToOnePage`, not a high-frequency signal — matches the spec's stated rationale.

- [ ] **Step 3: Type-check**

Run: `npm run build --workspace=packages/agent`
Expected: compiles with no TypeScript errors (this route file has no dedicated test harness — the DB and label logic are already covered by Tasks 1-2; this task's correctness is verified by type-checking now and by the end-to-end manual check in Task 7).

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/api/routes/tailor.ts
git commit -m "feat: report pipeline stage during POST /api/tailor generation"
```

---

### Task 4: Wire stage tracking into the general-resume pipeline

**Files:**
- Modify: `packages/agent/src/ai/general-resume.ts` (whole file, ~38 lines)
- Modify: `packages/agent/src/api/routes/general-resume.ts` (imports at lines 1-10; `runGeneralResumePipeline` at lines 42-68)

**Interfaces:**
- Consumes: `updateResumeStage` from Task 1; `GenerateOptions.onProgress` from Task 2.
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Forward `onProgress` through `generateGeneralResume`**

Replace `packages/agent/src/ai/general-resume.ts` in full:

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
export async function generateGeneralResume(
  onProgress?: (stage: string) => void
): Promise<GeneralResumeResult> {
  const result = await generateBestResume(GENERIC_SWE_PROMPT, {
    jobTitle: "General Software Engineer",
    onProgress,
  });
  onProgress?.("Finalizing formatting");
  const fitted = await fitToOnePage(result.markdown);
  return {
    markdown: fitted.markdown,
    pdf: fitted.pdf,
    criticScore: result.critic.finalScore,
  };
}
```

- [ ] **Step 2: Wire the callback in the route**

In `packages/agent/src/api/routes/general-resume.ts`, update the import block (currently lines 1-10):

```ts
import { Router } from "express";
import {
  getGeneralResume,
  upsertPendingGeneralResume,
  completeTailoredResume,
  failTailoredResume,
  storePdf,
  setPdfError,
  updateResumeStage,
} from "../../db/queries";
import { generateGeneralResume } from "../../ai/general-resume";
import { LLM_PROVIDER } from "../../ai/llm";
```

Then replace `runGeneralResumePipeline` (currently lines 42-68):

```ts
async function runGeneralResumePipeline(id: string) {
  let result;
  try {
    result = await generateGeneralResume((stage) => {
      updateResumeStage(id, stage).catch((err) => {
        console.error("[general-resume] stage update failed:", err);
      });
    });
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
```

- [ ] **Step 3: Type-check**

Run: `npm run build --workspace=packages/agent`
Expected: compiles with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/ai/general-resume.ts packages/agent/src/api/routes/general-resume.ts
git commit -m "feat: report pipeline stage during general resume generation"
```

---

### Task 5: Frontend types — add `stage` to the API surface

**Files:**
- Modify: `packages/web/lib/api.ts` (`ResumeListItem` type, currently lines 3-18)

**Interfaces:**
- Consumes: nothing (types only).
- Produces: `ResumeListItem.stage: string | null` (and by extension `Resume.stage`, since `Resume = ResumeListItem & {...}`) — used by Task 6 and Task 7.

- [ ] **Step 1: Add `stage` to `ResumeListItem`**

In `packages/web/lib/api.ts`, update the type (currently lines 3-18):

```ts
export type ResumeListItem = {
  id: string;
  job_title: string | null;
  company: string | null;
  location: string | null;
  job_url: string | null;
  critic_score: number | null;
  /** Error from the most recent PDF render attempt; null if the last attempt succeeded. */
  pdf_error: string | null;
  /** 'pending' while the generate->critique->revise pipeline is still running in the background. */
  status: "pending" | "ready" | "failed";
  /** Error from the tailoring pipeline itself, set when status = 'failed'. */
  error: string | null;
  /** Current pipeline step while status = 'pending' (e.g. "Drafting resume (pass 1)"); null otherwise. */
  stage: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: Type-check**

Run: `npm run build --workspace=packages/web`
Expected: compiles with no TypeScript errors. Adding a field to a type used only for reads doesn't break any existing call site — this step just confirms that assumption holds before Task 6/7 start consuming the new field.

- [ ] **Step 3: Commit**

```bash
git add packages/web/lib/api.ts
git commit -m "feat: add stage field to the resume API types"
```

---

### Task 6: Frontend — `segmentIndex` mapping + pure test

**Files:**
- Create: `packages/web/lib/resumeStage.ts`
- Create: `packages/web/lib/test-resume-stage.ts`
- Modify: `package.json` (root) — add `test:resume-stage` script (web package.json has no `tsx`; run from repo root where `tsx` is hoisted, per Global Constraints)

**Interfaces:**
- Produces: `STAGE_SEGMENTS: readonly string[]` (the 4 display labels, in order) and `segmentIndex(stage: string | null): number` from `packages/web/lib/resumeStage.ts` — both used by Task 7's stepper component.

- [ ] **Step 1: Write the failing test**

Create `packages/web/lib/test-resume-stage.ts`:

```ts
import { segmentIndex, STAGE_SEGMENTS } from "./resumeStage";

function main() {
  const results: Record<string, boolean> = {
    fourSegments: STAGE_SEGMENTS.length === 4,
    nullIsUnknown: segmentIndex(null) === -1,
    unrecognizedIsUnknown: segmentIndex("") === -1,
    draftingPass1: segmentIndex("Drafting resume (pass 1)") === 0,
    critiquingDraft: segmentIndex("Critiquing draft") === 1,
    revisingPass2: segmentIndex("Revising resume (pass 2)") === 2,
    revisingPass3: segmentIndex("Revising resume (pass 3)") === 2,
    finalizingFormatting: segmentIndex("Finalizing formatting") === 3,
    // segmentIndex is a pure/stateless mapping, so calling it with
    // "Critiquing draft" again after "Revising..." must land back on index 1
    // (not get "stuck" on 2) — this is what lets the stepper move its
    // highlight backward on a second critique pass.
    revisitingCritiquingAfterRevising:
      segmentIndex("Revising resume (pass 2)") === 2 && segmentIndex("Critiquing draft") === 1,
  };

  const pass = Object.values(results).every(Boolean);
  console.log(Object.entries(results).map(([k, v]) => `${k}:${v}`).join(" "));
  console.log(pass ? "\n✓ resume-stage segment test PASSED" : "\n✗ resume-stage segment test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
```

- [ ] **Step 2: Add the test script (root `package.json`)**

Add to the root `package.json` `"scripts"` block:

```json
    "test:resume-stage": "tsx packages/web/lib/test-resume-stage.ts",
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npm run test:resume-stage`
Expected: FAIL — `./resumeStage` module does not exist yet.

- [ ] **Step 4: Implement `resumeStage.ts`**

Create `packages/web/lib/resumeStage.ts`:

```ts
/** The 4 fixed stepper segments shown on the resume-pending screen, in order. */
export const STAGE_SEGMENTS = ["Drafting", "Critiquing", "Revising", "Finalizing"] as const;

/**
 * Maps a raw backend stage string (e.g. "Drafting resume (pass 1)") to one of
 * the 4 fixed segment indices above, matched by prefix rather than exact
 * string — this lets repeated passes (e.g. "Revising resume (pass 2)" and
 * "Revising resume (pass 3)") both light up the same segment, and lets a
 * later "Critiquing draft" after a revision move the highlight BACK to
 * "Critiquing" instead of erroring on an out-of-order transition.
 * Returns -1 when the stage is null or unrecognized (caller falls back to a
 * generic spinner in that case).
 */
export function segmentIndex(stage: string | null): number {
  if (!stage) return -1;
  if (stage.startsWith("Drafting")) return 0;
  if (stage.startsWith("Critiquing")) return 1;
  if (stage.startsWith("Revising")) return 2;
  if (stage.startsWith("Finalizing")) return 3;
  return -1;
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm run test:resume-stage`
Expected: all key:value pairs `true`, then `✓ resume-stage segment test PASSED`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/resumeStage.ts packages/web/lib/test-resume-stage.ts package.json
git commit -m "feat: add stage-to-segment mapping for the resume progress stepper"
```

---

### Task 7: Frontend — stepper UI + fix the pending-poll early return

**Files:**
- Modify: `packages/web/components/ResumeEditor.tsx` (imports at lines 1-5; `meta` state at lines 109-116; polling effect at lines 241-274; pending-state JSX at lines 334-360)

**Interfaces:**
- Consumes: `STAGE_SEGMENTS`, `segmentIndex` from Task 6; `Resume.stage` from Task 5.
- Produces: nothing (leaf/UI task).

**Important pre-existing bug this task fixes:** the current polling effect (`ResumeEditor.tsx:241-274`) has `if (cancelled || fresh.status === "pending") return;` — while `status` stays `"pending"`, every poll tick's result is discarded entirely, including any `stage` value. Without changing this, a stage stepper would never update. This task changes the early return to still update `meta.stage` while pending, and only does the full field sync once `status` actually leaves `"pending"`.

- [ ] **Step 1: Import the stage helpers**

In `packages/web/components/ResumeEditor.tsx`, update the import block (currently lines 1-5):

```ts
"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api, Resume } from "../lib/api";
import { STAGE_SEGMENTS, segmentIndex } from "../lib/resumeStage";
```

- [ ] **Step 2: Add `stage` to the `meta` state**

Update the `meta` state initializer (currently lines 109-116):

```ts
  const [meta, setMeta] = useState({
    status: resume.status,
    error: resume.error,
    critic_score: resume.critic_score,
    location: resume.location,
    job_url: resume.job_url,
    created_at: resume.created_at,
    stage: resume.stage,
  });
```

- [ ] **Step 3: Fix the polling effect to update `stage` while still pending**

Replace the polling `useEffect` (currently lines 241-274):

```ts
  // The tailoring pipeline runs in the background (see /api/tailor) so this page can
  // load instantly instead of holding a request open past Railway's proxy timeout.
  // Poll until it flips out of "pending".
  useEffect(() => {
    if (meta.status !== "pending") return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const fresh = await api.getResume(resume.id);
        if (cancelled) return;
        if (fresh.status === "pending") {
          // Still running — just surface the current stage, nothing else has
          // changed yet (markdown/PDF are only written once status flips).
          setMeta((m) => (m.stage === fresh.stage ? m : { ...m, stage: fresh.stage }));
          return;
        }
        // Let the PDF pane's auto-load effect retry now that a PDF might exist —
        // it latched hasAttemptedLoadRef after an earlier attempt 409'd while pending.
        hasAttemptedLoadRef.current = false;
        setMeta({
          status: fresh.status,
          error: fresh.error,
          critic_score: fresh.critic_score,
          location: fresh.location,
          job_url: fresh.job_url,
          created_at: fresh.created_at,
          stage: fresh.stage,
        });
        setMarkdown(fresh.markdown);
        setJobTitle(fresh.job_title ?? "");
        setCompany(fresh.company ?? "");
        setPdfRenderError(fresh.pdf_error);
      } catch (err) {
        if (!cancelled && err instanceof Error && err.message === "Not found") {
          setMeta((m) => ({ ...m, status: "failed", error: "This resume was deleted." }));
        }
        // otherwise assume a transient network error — keep polling
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [meta.status, resume.id]);
```

- [ ] **Step 4: Replace the pending-state UI with the stepper**

Replace the pending-state block (currently lines 334-360):

```tsx
  if (meta.status === "pending") {
    const activeIndex = segmentIndex(meta.stage);
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="border-b border-gray-200 px-6 py-3 flex-shrink-0">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1 w-fit transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div className="w-full max-w-sm">
            <p className="text-sm font-medium text-gray-900">
              Generating your tailored resume{title ? ` for ${title}` : ""}…
            </p>
            {activeIndex === -1 ? (
              <>
                <svg className="animate-spin mx-auto text-violet-600 mt-4" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <p className="text-xs text-gray-500 mt-4">
                  The generate → critique → revise loop usually takes a few minutes. This page updates automatically.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mt-6">
                  {STAGE_SEGMENTS.map((label, i) => (
                    <div key={label} className="flex-1 flex flex-col items-center">
                      <div className="flex items-center w-full">
                        {i > 0 && (
                          <div className={`h-0.5 flex-1 ${i <= activeIndex ? "bg-violet-600" : "bg-gray-200"}`} />
                        )}
                        <div
                          className={`w-3 h-3 rounded-full flex-shrink-0 ${
                            i < activeIndex
                              ? "bg-violet-600"
                              : i === activeIndex
                              ? "bg-violet-600 animate-pulse"
                              : "bg-gray-200"
                          } ${i === 0 ? "" : "ml-0"}`}
                        />
                        {i < STAGE_SEGMENTS.length - 1 && (
                          <div className={`h-0.5 flex-1 ${i < activeIndex ? "bg-violet-600" : "bg-gray-200"}`} />
                        )}
                      </div>
                      <span className={`text-[11px] mt-1.5 ${i === activeIndex ? "text-violet-700 font-medium" : "text-gray-400"}`}>
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-6">{meta.stage}</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
```

- [ ] **Step 5: Type-check and lint**

Run: `npm run build --workspace=packages/web && npm run lint --workspace=packages/web`
Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/components/ResumeEditor.tsx
git commit -m "feat: show a real progress stepper on the resume-pending screen"
```

---

### Task 8: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Start local infra and both apps**

```bash
docker-compose up -d
npm run dev:agent --workspace=packages/agent &
npm run dev:web --workspace=packages/web &
```

Confirm `packages/agent`'s `.env` has a valid `CLAUDE_CODE_OAUTH_TOKEN` (or `OPENAI_API_KEY` with `LLM_PROVIDER=openai`) — this task calls the real LLM pipeline.

- [ ] **Step 2: Trigger a real tailor request and watch the stepper**

In the browser, go to `/tailor`, paste a short real job description (2-3 paragraphs is enough), submit, and get redirected to `/resume/:id`.

Expected: the stepper renders (not the fallback spinner) within one or two 4-second poll ticks, and visibly moves: `Drafting` → `Critiquing` → (`Revising` → `Critiquing` again, if the first draft doesn't clear the critic's target score) → `Finalizing` → the editor renders with `status: "ready"`.

- [ ] **Step 3: Trigger a general-resume regeneration and confirm the same stepper**

Go to `/resume/master`, switch to General mode, click "Generate General Resume" (or "Sync to General" from Master mode if a general resume already exists).

Expected: same stepper behavior as Step 2, confirming the shared wiring in Task 4 works end-to-end.

- [ ] **Step 4: Confirm the fallback spinner still works for the edge case**

This step only needs to confirm the fallback branch's code path is reachable — it doesn't require reproducing the exact race. Read `packages/web/components/ResumeEditor.tsx`'s pending block and confirm `activeIndex === -1` (i.e. `meta.stage` is `null` or unrecognized) renders the original spinner+text markup, not a blank or broken stepper. This was written in Task 7 Step 4 — visually confirm by temporarily setting a resume row's `stage` to `NULL` in the DB while `status = 'pending'` (if a request is easy to catch mid-flight) or by code review if not.

- [ ] **Step 5: Report results to the user**

Summarize what was observed in Steps 2-4 (stages seen, timing, any visual issues) before considering this plan complete.
