# Tailoring Loading-Screen Progress Estimate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the motionless pulsing dot on the `/resume/[id]` pending screen with an honest elapsed-time-vs-typical progress bar, so a run that's actually 40s into an ~80s stage looks different from one that just started.

**Architecture:** The backend already tracks a real `stage` string on `tailored_resumes`, updated at genuine pipeline checkpoints and polled by the frontend every 4s. We add a `stage_started_at` timestamp column set atomically alongside `stage`, so the frontend can compute `elapsed = now - stage_started_at` and compare it to a hardcoded per-segment "typical duration" constant grounded in latency numbers already measured elsewhere in this codebase. The resulting percentage is capped at 92% so it never visually completes before the real stage transition (which still comes from polling, not from the estimate).

**Tech Stack:** PostgreSQL (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), Express/pg (`packages/agent`), Next.js/React (`packages/web`), the repo's plain-script test convention (`test-*.ts`, no test framework, `tsx` + exit codes).

## Global Constraints

- No new DB table, no historical/adaptive duration tracking — expected durations are hardcoded constants (spec: "DB-backed historical/adaptive expected-duration tracking — explicitly deferred").
- The progress bar must never show 100% before the real stage transition fires: cap at 92%.
- Do not split "Finalizing formatting" into separate real sub-checkpoints — out of scope per spec.
- Do not change `claude-cli.ts` or add streaming — the constraint that there's no mid-call signal is accepted, not worked around.
- New tests follow the existing plain-script `test-*.ts` pattern (see `packages/web/lib/test-resume-stage.ts`) — no new test framework/dependency.
- Spec: `docs/superpowers/specs/2026-08-07-tailoring-progress-estimate-design.md`.

---

### Task 1: Backend — `stage_started_at` column and query wiring

**Files:**
- Modify: `packages/agent/src/db/schema.ts` (add column, right after the existing `stage` column block)
- Modify: `packages/agent/src/db/queries.ts` (type, column list, `updateResumeStage`, `setSuggestions`, `beginApplyingSuggestions`)
- Modify: `packages/agent/src/db/test-phase1.ts` (extend the existing DB integration test)

**Interfaces:**
- Produces: `TailoredResumeRow.stage_started_at: Date | null`, included in every `TAILORED_RESUME_COLUMNS`-based read (`getTailoredResume`, `createPendingResume`'s `RETURNING`). Later tasks (2, 4) consume this field by name.
- Produces: `updateResumeStage(id, stage)` now also sets `stage_started_at = NOW()`. `setSuggestions(id, suggestions)` and `beginApplyingSuggestions(id)` now also null out `stage_started_at`. Signatures unchanged.

This is an integration test — it needs a live local Postgres. Start it first:

```bash
docker-compose up -d
```

- [ ] **Step 1: Extend the failing integration test**

Open `packages/agent/src/db/test-phase1.ts`. Add the three new query functions to the existing import block (currently `getMasterResume, updateMasterResume, createPendingResume, completeTailoredResume, getTailoredResume, listTailoredResumes, updateTailoredResume, storePdf, getPdf, createAppliedJob, listAppliedJobs, updateAppliedJob`):

```ts
import {
  getMasterResume,
  updateMasterResume,
  createPendingResume,
  completeTailoredResume,
  getTailoredResume,
  listTailoredResumes,
  updateTailoredResume,
  storePdf,
  getPdf,
  createAppliedJob,
  listAppliedJobs,
  updateAppliedJob,
  updateResumeStage,
  setSuggestions,
  beginApplyingSuggestions,
} from "./queries";
```

Then, right before the `console.log("\n── Cleanup ...")` block near the end of `main()`, insert a new numbered section:

```ts
  console.log("\n── 12. updateResumeStage / setSuggestions / beginApplyingSuggestions stage_started_at ──");
  const stageRow = await createPendingResume({
    jobTitle: "Stage Test Role",
    company: "StageCo",
    jobUrl: "https://stageco.com/jobs/1",
    jdText: "Testing stage timestamps.",
  });
  ok("stage_started_at starts null", stageRow.stage_started_at === null);

  await updateResumeStage(stageRow.id, "Analyzing job description");
  const afterFirstStage = await getTailoredResume(stageRow.id);
  ok("stage set", afterFirstStage?.stage === "Analyzing job description");
  ok("stage_started_at set", afterFirstStage?.stage_started_at !== null);

  await setSuggestions(stageRow.id, []);
  const afterSuggestions = await getTailoredResume(stageRow.id);
  ok("stage cleared by setSuggestions", afterSuggestions?.stage === null);
  ok("stage_started_at cleared by setSuggestions", afterSuggestions?.stage_started_at === null);

  await updateResumeStage(stageRow.id, "Applying your selections");
  const afterSecondStage = await getTailoredResume(stageRow.id);
  ok("stage set again", afterSecondStage?.stage === "Applying your selections");
  ok("stage_started_at set again", afterSecondStage?.stage_started_at !== null);

  await beginApplyingSuggestions(stageRow.id);
  const afterBegin = await getTailoredResume(stageRow.id);
  ok("stage cleared by beginApplyingSuggestions", afterBegin?.stage === null);
  ok("stage_started_at cleared by beginApplyingSuggestions", afterBegin?.stage_started_at === null);

  await cleanup(stageRow.id);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db --workspace=packages/agent`
Expected: FAIL. `tsx` doesn't type-check, so this isn't a compile error — at runtime, `TAILORED_RESUME_COLUMNS` doesn't select `stage_started_at` yet, so every `row.stage_started_at` access is `undefined`, not `null`. `ok("stage_started_at starts null", stageRow.stage_started_at === null)` evaluates to `false` (since `undefined === null` is `false`), so that assertion prints `✗` and the script exits 1.

- [ ] **Step 3: Add the column in schema.ts**

In `packages/agent/src/db/schema.ts`, find this existing block:

```ts
  // Tracks which real step of the generate->critique->revise pipeline a
  // pending row is on (e.g. "Drafting resume (pass 1)", "Critiquing draft"),
  // so the pending-state UI can show real progress instead of a generic
  // spinner. Only meaningful transiently while status = 'pending'.
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS stage TEXT;
  `);
```

Add immediately after it:

```ts

  // Timestamp of the most recent `stage` transition above — lets the
  // pending-state UI show an elapsed-time-vs-typical progress estimate
  // instead of a plain spinner. Set alongside `stage` in updateResumeStage()
  // and nulled out alongside it in setSuggestions()/beginApplyingSuggestions()
  // so the two columns never disagree about whether a stage is in flight.
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS stage_started_at TIMESTAMPTZ;
  `);
```

- [ ] **Step 4: Wire the column through queries.ts**

In `packages/agent/src/db/queries.ts`, update the `TailoredResumeRow` type:

```ts
  /** Current pipeline step while status = 'pending' (e.g. "Drafting resume (pass 1)"); null otherwise. */
  stage: string | null;
  /** When the current `stage` began — used to estimate progress; null whenever `stage` is null. */
  stage_started_at: Date | null;
  suggestions: Suggestion[] | null;
```

(This replaces the existing `stage: string | null;` / `suggestions: Suggestion[] | null;` pair with the same two lines plus the new one in between.)

Update `TAILORED_RESUME_COLUMNS`:

```ts
const TAILORED_RESUME_COLUMNS =
  "id, job_title, company, location, job_url, jd_text, markdown, critic_score, pdf_error, status, error, stage, stage_started_at, suggestions, created_at, updated_at";
```

Update `updateResumeStage`:

```ts
export async function updateResumeStage(id: string, stage: string): Promise<void> {
  await pool.query("UPDATE tailored_resumes SET stage = $1, stage_started_at = NOW() WHERE id = $2", [stage, id]);
}
```

Update `setSuggestions`:

```ts
export async function setSuggestions(id: string, suggestions: Suggestion[]): Promise<void> {
  await pool.query(
    `UPDATE tailored_resumes SET suggestions = $1, status = 'awaiting_review', stage = NULL, stage_started_at = NULL, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(suggestions), id]
  );
}
```

Update `beginApplyingSuggestions`:

```ts
export async function beginApplyingSuggestions(id: string): Promise<void> {
  await pool.query(`UPDATE tailored_resumes SET status = 'pending', stage = NULL, stage_started_at = NULL, updated_at = NOW() WHERE id = $1`, [id]);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:db --workspace=packages/agent`
Expected: PASS — all `ok(...)` lines print `✓`, final line `PASSED: N   FAILED: 0`.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/db/schema.ts packages/agent/src/db/queries.ts packages/agent/src/db/test-phase1.ts
git commit -m "feat: track stage_started_at for tailoring pipeline progress"
```

---

### Task 2: Frontend types — expose `stage_started_at` on the `Resume` type

**Files:**
- Modify: `packages/web/lib/api.ts`

**Interfaces:**
- Consumes: nothing new (JSON already carries the field once Task 1 ships; this just types it).
- Produces: `ResumeListItem.stage_started_at: string | null` (and therefore `Resume.stage_started_at`, since `Resume = ResumeListItem & {...}`). Tasks 3 and 4 consume this field name and type.

This is a type-only change with no independent runtime behavior to test in isolation — it's exercised by the typecheck in Task 4's verification step. No dedicated test.

- [ ] **Step 1: Add the field**

In `packages/web/lib/api.ts`, in the `ResumeListItem` type, change:

```ts
  stage: string | null;
  suggestions: Suggestion[] | null;
```

to:

```ts
  stage: string | null;
  /** When the current `stage` began (ISO string); null whenever `stage` is null. Used to estimate pending-screen progress. */
  stage_started_at: string | null;
  suggestions: Suggestion[] | null;
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/lib/api.ts
git commit -m "feat: type stage_started_at on the Resume API type"
```

---

### Task 3: Frontend — `STAGE_EXPECTED_MS` and `estimateStageProgress`

**Files:**
- Modify: `packages/web/lib/resumeStage.ts`
- Modify: `packages/web/lib/test-resume-stage.ts`

**Interfaces:**
- Consumes: `segmentIndex(stage: string | null): number` (already exists in this file).
- Produces: `STAGE_EXPECTED_MS: readonly [number, number, number]` and `estimateStageProgress(stage: string | null, stageStartedAt: string | null, now: number): { percent: number; elapsedSeconds: number; expectedSeconds: number } | null`. Task 4 consumes both by these exact names.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `packages/web/lib/test-resume-stage.ts` with:

```ts
import { segmentIndex, STAGE_SEGMENTS, estimateStageProgress, STAGE_EXPECTED_MS } from "./resumeStage";

function main() {
  const results: Record<string, boolean> = {
    threeSegments: STAGE_SEGMENTS.length === 3,
    nullIsUnknown: segmentIndex(null) === -1,
    unrecognizedIsUnknown: segmentIndex("") === -1,
    analyzingJobDescription: segmentIndex("Analyzing job description") === 0,
    applyingYourSelections: segmentIndex("Applying your selections") === 1,
    finalizingFormatting: segmentIndex("Finalizing formatting") === 2,

    progressNullStage: estimateStageProgress(null, "2026-08-07T00:00:00.000Z", Date.now()) === null,
    progressNullStartedAt: estimateStageProgress("Analyzing job description", null, Date.now()) === null,
    progressUnrecognizedStage: estimateStageProgress("Whatever", "2026-08-07T00:00:00.000Z", Date.now()) === null,

    progressProportionalUnderExpected: (() => {
      const startedAt = new Date(0).toISOString();
      const now = 40_000; // 40s elapsed; Analyzing expects 80s → 50%
      const result = estimateStageProgress("Analyzing job description", startedAt, now);
      return (
        result !== null &&
        Math.abs(result.percent - 50) < 0.01 &&
        result.elapsedSeconds === 40 &&
        result.expectedSeconds === 80
      );
    })(),

    progressCappedOverExpected: (() => {
      const startedAt = new Date(0).toISOString();
      const now = 200_000; // way past the 80s expected duration
      const result = estimateStageProgress("Analyzing job description", startedAt, now);
      return result !== null && result.percent === 92 && result.elapsedSeconds === 200;
    })(),

    progressUsesRightExpectedPerSegment: (() => {
      const startedAt = new Date(0).toISOString();
      const analyzing = estimateStageProgress("Analyzing job description", startedAt, 0);
      const applying = estimateStageProgress("Applying your selections", startedAt, 0);
      const finalizing = estimateStageProgress("Finalizing formatting", startedAt, 0);
      return (
        analyzing?.expectedSeconds === Math.round(STAGE_EXPECTED_MS[0] / 1000) &&
        applying?.expectedSeconds === Math.round(STAGE_EXPECTED_MS[1] / 1000) &&
        finalizing?.expectedSeconds === Math.round(STAGE_EXPECTED_MS[2] / 1000)
      );
    })(),
  };

  const pass = Object.values(results).every(Boolean);
  console.log(Object.entries(results).map(([k, v]) => `${k}:${v}`).join(" "));
  console.log(pass ? "\n✓ resume-stage segment test PASSED" : "\n✗ resume-stage segment test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:resume-stage --workspace=packages/web`
Expected: FAIL. `estimateStageProgress` and `STAGE_EXPECTED_MS` aren't exported from `./resumeStage` yet, so importing them resolves to `undefined`; calling `estimateStageProgress(...)` then throws `TypeError: estimateStageProgress is not a function`, and the script exits non-zero.

- [ ] **Step 3: Implement `STAGE_EXPECTED_MS` and `estimateStageProgress`**

Replace the full contents of `packages/web/lib/resumeStage.ts` with:

```ts
/** The 3 fixed stepper segments shown on the resume-pending screen, in order. */
export const STAGE_SEGMENTS = ["Analyzing", "Applying", "Finalizing"] as const;

/**
 * Maps a raw backend stage string to one of the 3 fixed segment indices
 * above, matched by prefix (mirrors the tailoring pipeline's two phases:
 * "Analyzing job description" while suggestions are generated, then
 * "Applying your selections" / "Finalizing formatting" once accepted
 * suggestions are submitted). Returns -1 when the stage is null or
 * unrecognized (caller falls back to a generic spinner in that case).
 */
export function segmentIndex(stage: string | null): number {
  if (!stage) return -1;
  if (stage.startsWith("Analyzing")) return 0;
  if (stage.startsWith("Applying")) return 1;
  if (stage.startsWith("Finalizing")) return 2;
  return -1;
}

/**
 * Expected wall-clock duration per segment (ms), used only to animate an
 * honest progress *estimate* (see estimateStageProgress) — the backend has
 * no way to report literal completion percentage mid-call. Grounded in real
 * measured latency where it exists:
 *  - Analyzing: a single non-streaming `claude -p` call; ~80s on a clean run
 *    per the DEFAULT_TIMEOUT_MS comment in packages/agent/src/ai/claude-cli.ts.
 *  - Applying: deterministic in-process work (applySuggestions + renderMarkdown),
 *    no LLM call — a few seconds including the DB round trip.
 *  - Finalizing: PDF render via Tectonic; the suggestion-based flow skips the
 *    widow-fix pass and usually needs no trim pass either. Trim passes (0-2,
 *    each an LLM call) only run on page overflow and are the main source of
 *    outliers past this estimate — covered by the 92% cap and elapsed counter
 *    in estimateStageProgress, not by a bigger constant here.
 */
export const STAGE_EXPECTED_MS = [80_000, 3_000, 15_000] as const;

export type StageProgress = { percent: number; elapsedSeconds: number; expectedSeconds: number };

/**
 * Estimates how far into the current stage we are, as elapsed-time-vs-typical
 * — not a literal completion percentage. Capped at 92% so it never visually
 * finishes before the real stage transition (driven by polling, not by this
 * estimate). Returns null when there isn't enough information yet (caller
 * falls back to a generic spinner): stage/stageStartedAt missing, or an
 * unrecognized stage string.
 */
export function estimateStageProgress(
  stage: string | null,
  stageStartedAt: string | null,
  now: number
): StageProgress | null {
  if (!stage || !stageStartedAt) return null;
  const index = segmentIndex(stage);
  if (index === -1) return null;

  const startedMs = Date.parse(stageStartedAt);
  if (Number.isNaN(startedMs)) return null;

  const expectedMs = STAGE_EXPECTED_MS[index];
  const elapsedMs = Math.max(0, now - startedMs);
  const percent = Math.min(92, (elapsedMs / expectedMs) * 100);

  return {
    percent,
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    expectedSeconds: Math.round(expectedMs / 1000),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:resume-stage --workspace=packages/web`
Expected: PASS — all keys print `:true`, final line `✓ resume-stage segment test PASSED`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/resumeStage.ts packages/web/lib/test-resume-stage.ts
git commit -m "feat: add elapsed-vs-typical progress estimate helper"
```

---

### Task 4: Frontend — wire the progress bar into `ResumeEditor`

**Files:**
- Modify: `packages/web/components/ResumeEditor.tsx`

**Interfaces:**
- Consumes: `estimateStageProgress`, `STAGE_SEGMENTS`, `segmentIndex` from `../lib/resumeStage` (Task 3); `resume.stage_started_at: string | null` and `fresh.stage_started_at: string | null` from the `Resume` type (Task 2).
- Produces: no new exports — this is the leaf UI consumer.

No unit-test framework exists for React components in this repo (per `CLAUDE.md`, `npm test` is DB/LLM/network-free unit scripts only). Verification for this task is manual: typecheck + lint (Task 5) plus an in-browser check using a direct DB timestamp edit to simulate an in-flight stage without waiting ~80s for real.

- [ ] **Step 1: Import the new helper**

In `packages/web/components/ResumeEditor.tsx`, change:

```ts
import { STAGE_SEGMENTS, segmentIndex } from "../lib/resumeStage";
```

to:

```ts
import { STAGE_SEGMENTS, segmentIndex, estimateStageProgress } from "../lib/resumeStage";
```

- [ ] **Step 2: Track `stage_started_at` in `meta` state**

Change the `meta` initial state:

```ts
  const [meta, setMeta] = useState({
    status: resume.status,
    error: resume.error,
    critic_score: resume.critic_score,
    location: resume.location,
    job_url: resume.job_url,
    created_at: resume.created_at,
    stage: resume.stage,
    suggestions: resume.suggestions,
  });
```

to:

```ts
  const [meta, setMeta] = useState({
    status: resume.status,
    error: resume.error,
    critic_score: resume.critic_score,
    location: resume.location,
    job_url: resume.job_url,
    created_at: resume.created_at,
    stage: resume.stage,
    stage_started_at: resume.stage_started_at,
    suggestions: resume.suggestions,
  });
```

- [ ] **Step 3: Carry `stage_started_at` through the polling effect**

In the polling `useEffect`, the "still pending" branch currently reads:

```ts
        if (fresh.status === "pending") {
          // Still running — just surface the current stage, nothing else has
          // changed yet (markdown/PDF are only written once status flips).
          setMeta((m) => (m.stage === fresh.stage ? m : { ...m, stage: fresh.stage }));
          return;
        }
```

Change the `setMeta` call to also carry the new field:

```ts
        if (fresh.status === "pending") {
          // Still running — just surface the current stage, nothing else has
          // changed yet (markdown/PDF are only written once status flips).
          setMeta((m) =>
            m.stage === fresh.stage ? m : { ...m, stage: fresh.stage, stage_started_at: fresh.stage_started_at }
          );
          return;
        }
```

A few lines below, the resolved-status branch currently reads:

```ts
        setMeta({
          status: fresh.status,
          error: fresh.error,
          critic_score: fresh.critic_score,
          location: fresh.location,
          job_url: fresh.job_url,
          created_at: fresh.created_at,
          stage: fresh.stage,
          suggestions: fresh.suggestions,
        });
```

Change it to:

```ts
        setMeta({
          status: fresh.status,
          error: fresh.error,
          critic_score: fresh.critic_score,
          location: fresh.location,
          job_url: fresh.job_url,
          created_at: fresh.created_at,
          stage: fresh.stage,
          stage_started_at: fresh.stage_started_at,
          suggestions: fresh.suggestions,
        });
```

- [ ] **Step 4: Add a 1s local ticker**

Immediately after the closing of the polling `useEffect` block (right before `async function handleDownload() {`), add:

```ts
  // Ticks once a second while a stage is in flight, purely to animate the
  // elapsed-time-vs-typical progress bar between polls — the 4s poll above
  // remains the sole source of truth for `stage` / `stage_started_at`.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (meta.status !== "pending") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [meta.status]);

```

- [ ] **Step 5: Render the progress bar**

Find this block (the pending-status early return):

```tsx
  if (meta.status === "pending") {
    const activeIndex = segmentIndex(meta.stage);
    return (
      <div className="flex flex-col h-full bg-paper">
        <div className="border-b border-paper-border px-6 py-3 flex-shrink-0">
          <Link href="/" className="text-sm text-paper-muted hover:text-paper-ink flex items-center gap-1 w-fit transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div className="w-full max-w-sm">
            <p className="text-sm font-medium text-paper-ink">
              Generating your tailored resume{title ? ` for ${title}` : ""}…
            </p>
            {activeIndex === -1 ? (
              <>
                <svg className="animate-spin mx-auto text-violet-600 mt-4" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <p className="text-xs text-paper-muted mt-4">
                  This usually takes well under a minute. This page updates automatically.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mt-6">
                  {STAGE_SEGMENTS.map((label, i) => (
                    <div key={label} className="flex-1 flex flex-col items-center">
                      <div className="flex items-center w-full">
                        {i > 0 && (
                          <div className={`h-0.5 flex-1 ${i <= activeIndex ? "bg-violet-600" : "bg-paper-border"}`} />
                        )}
                        <div
                          className={`w-3 h-3 rounded-full flex-shrink-0 ${
                            i < activeIndex
                              ? "bg-violet-600"
                              : i === activeIndex
                              ? "bg-violet-600 animate-pulse"
                              : "bg-paper-border"
                          } ${i === 0 ? "" : "ml-0"}`}
                        />
                        {i < STAGE_SEGMENTS.length - 1 && (
                          <div className={`h-0.5 flex-1 ${i < activeIndex ? "bg-violet-600" : "bg-paper-border"}`} />
                        )}
                      </div>
                      <span className={`text-[11px] mt-1.5 ${i === activeIndex ? "text-violet-700 font-medium" : "text-paper-muted"}`}>
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-paper-muted mt-6">{meta.stage}</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
```

Replace it entirely with:

```tsx
  if (meta.status === "pending") {
    const activeIndex = segmentIndex(meta.stage);
    const progress = estimateStageProgress(meta.stage, meta.stage_started_at, now);
    return (
      <div className="flex flex-col h-full bg-paper">
        <div className="border-b border-paper-border px-6 py-3 flex-shrink-0">
          <Link href="/" className="text-sm text-paper-muted hover:text-paper-ink flex items-center gap-1 w-fit transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div className="w-full max-w-sm">
            <p className="text-sm font-medium text-paper-ink">
              Generating your tailored resume{title ? ` for ${title}` : ""}…
            </p>
            {activeIndex === -1 || !progress ? (
              <>
                <svg className="animate-spin mx-auto text-violet-600 mt-4" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <p className="text-xs text-paper-muted mt-4">
                  This usually takes well under a minute. This page updates automatically.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mt-6">
                  {STAGE_SEGMENTS.map((label, i) => (
                    <div key={label} className="flex-1 flex flex-col items-center">
                      <div className="flex items-center w-full">
                        {i > 0 && (
                          <div className={`h-0.5 flex-1 ${i <= activeIndex ? "bg-violet-600" : "bg-paper-border"}`} />
                        )}
                        <div
                          className={`w-3 h-3 rounded-full flex-shrink-0 ${
                            i < activeIndex
                              ? "bg-violet-600"
                              : i === activeIndex
                              ? "bg-violet-600 animate-pulse"
                              : "bg-paper-border"
                          } ${i === 0 ? "" : "ml-0"}`}
                        />
                        {i < STAGE_SEGMENTS.length - 1 && (
                          <div className={`h-0.5 flex-1 ${i < activeIndex ? "bg-violet-600" : "bg-paper-border"}`} />
                        )}
                      </div>
                      <span className={`text-[11px] mt-1.5 ${i === activeIndex ? "text-violet-700 font-medium" : "text-paper-muted"}`}>
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-paper-muted mt-6">{meta.stage}</p>
                <div className="mt-3">
                  <div className="h-1 w-full rounded-full bg-paper-border overflow-hidden">
                    <div
                      className="h-full bg-violet-600 transition-all duration-1000 ease-linear"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-paper-muted mt-1.5">
                    {progress.elapsedSeconds}s / ~{progress.expectedSeconds}s typical
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/components/ResumeEditor.tsx
git commit -m "feat: show elapsed-vs-typical progress bar on the tailoring pending screen"
```

---

### Task 5: Verify end-to-end

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Typecheck and lint (mirrors CI)**

Run: `npm run build --workspaces --if-present`
Expected: both `packages/agent` and `packages/web` build with no TypeScript errors — specifically, no complaints about `stage_started_at` missing from any type.

Run: `npm run lint --workspaces --if-present`
Expected: no new lint errors in the touched files.

- [ ] **Step 2: Run the fast unit test gate**

Run: `npm test`
Expected: both workspaces pass, including the extended `test:resume-stage` from Task 3. Exits 0.

- [ ] **Step 3: Run the DB integration test**

Requires local Postgres (`docker-compose up -d` if not already running) and `DATABASE_URL` set (see `.env.example`: `postgresql://jobagent:jobagent@localhost:5432/job_agent`).

Run: `npm run test:db --workspace=packages/agent`
Expected: PASS, including the new section 12 assertions from Task 1.

- [ ] **Step 4: Manual browser check**

The real "Analyzing" stage takes ~80s, which is impractical to sit through for a visual check — instead, seed a resume row directly and rewind its `stage_started_at` to fake elapsed time:

```bash
npm run dev  # from repo root, or start packages/agent and packages/web dev servers separately per README
```

In a separate terminal, connect to the local DB and manually create/update a row to simulate mid-flight progress:

```bash
psql postgresql://jobagent:jobagent@localhost:5432/job_agent -c "
INSERT INTO tailored_resumes (id, job_title, company, markdown, status, stage, stage_started_at)
VALUES (gen_random_uuid(), 'Progress Bar Test', 'TestCo', '', 'pending', 'Analyzing job description', NOW() - INTERVAL '40 seconds')
RETURNING id;
"
```

Copy the returned `id`, then open `http://localhost:3000/resume/<id>` in a browser (adjust port/host to match the local `packages/web` dev server). Confirm:
- The stepper shows "Analyzing" as the active segment.
- A progress bar renders under the stage text, filled to roughly 50% (40s elapsed / 80s typical).
- The text reads "40s / ~80s typical" (approximately — a few seconds may have passed since the INSERT).
- Waiting ~10 more seconds without any other action shows the bar advance further and the elapsed counter tick up, driven by the 1s ticker (no page reload needed).

Clean up the test row afterward:

```bash
psql postgresql://jobagent:jobagent@localhost:5432/job_agent -c "DELETE FROM tailored_resumes WHERE job_title = 'Progress Bar Test';"
```

- [ ] **Step 5: Report results**

Summarize pass/fail for each of the above steps. If everything passes, the feature is done — no commit needed for this task (verification only).
