# Tailoring loading-screen progress estimate

## Problem

The `/resume/[id]` pending screen already shows a 3-segment stepper (Analyzing → Applying → Finalizing) driven by the real backend `stage` column, polled every 4s (`ResumeEditor.tsx`, `resumeStage.ts`). That part is genuine, not decorative.

But within a segment there's no motion. "Analyzing job description" wraps a single opaque `claude -p` call that, per the measured comment in `claude-cli.ts`, takes ~80s on a clean run — the UI just pulses one dot for the full duration. "Finalizing formatting" is similarly flat: it covers a PDF render plus up to 2 conditional LLM trim passes, all under one static label. Christopher wants a progress indicator that gives a real sense of "how far along" and "how much longer," not just "which named phase we're in."

## Constraint

The `claude` CLI backend (`claude-cli.ts`) is invoked non-streaming — one `spawn`, wait for exit, parse the full JSON stdout. There is no mid-call signal to report literal completion percentage. Any progress finer than the existing stage transitions has to be an *estimate* (elapsed time vs. an expected duration), not a true completion percentage. The design goal is for that estimate to be honest: it must never claim 100% before the real transition fires, and must degrade gracefully (not look broken) when a run takes longer than typical.

## Design

### Backend: `stage_started_at` timestamp

Add a nullable `stage_started_at TIMESTAMPTZ` column to `tailored_resumes` (`schema.ts`, same `ALTER TABLE ADD COLUMN IF NOT EXISTS` pattern already used for `stage`).

- `updateResumeStage(id, stage)` (`queries.ts`) sets `stage = $1, stage_started_at = NOW()` atomically — every real stage transition gets a fresh timestamp.
- `setSuggestions()` and `beginApplyingSuggestions()`, which currently null out `stage` when a pending run's active phase ends, also null out `stage_started_at` in the same statement, so the two columns never disagree about whether a stage is "in flight."
- `stage_started_at` is added to `TAILORED_RESUME_COLUMNS` so it flows through `getTailoredResume()` / `GET /api/resume/:id` for free — no new endpoint, no extra request.
- `TailoredResumeRow` type (`queries.ts`) and `Resume`/`ResumeListItem` type (`web/lib/api.ts`) both gain `stage_started_at: Date | string | null`.

No new table, no historical logging. The expected-duration side of the estimate is a hardcoded constant (see below), not derived from stored history — proportionate to a single-user app where a rolling average would stay noisy for a long time.

### Frontend: elapsed-vs-typical estimate

`resumeStage.ts` gains, alongside `STAGE_SEGMENTS`:

```ts
// Expected wall-clock duration per segment, used only to animate an honest
// progress estimate (see estimateStageProgress) — not literal completion.
// Grounded in real measured latency where it exists:
//  - Analyzing: single non-streaming `claude -p` call; ~80s on a clean run
//    per the DEFAULT_TIMEOUT_MS comment in claude-cli.ts.
//  - Applying: deterministic in-process work (applySuggestions + renderMarkdown),
//    no LLM call — a few seconds including the DB round trip.
//  - Finalizing: PDF render via Tectonic, typically no trim pass needed for the
//    suggestion-based flow (skipWidowFix) — trim passes (0-2, each an LLM call)
//    only run on page overflow and are the main source of outliers past this
//    estimate; the progress bar's 92% cap + elapsed counter cover that case.
export const STAGE_EXPECTED_MS = [80_000, 3_000, 15_000] as const;

export function estimateStageProgress(
  stage: string | null,
  stageStartedAt: string | null,
  now: number
): { percent: number; elapsedSeconds: number; expectedSeconds: number } | null
```

- Returns `null` when `stage` or `stageStartedAt` is missing (caller falls back to the existing generic spinner) — covers the brief window before the first `updateResumeStage` lands.
- `percent = Math.min(92, (elapsedMs / expectedMs) * 100)`, `elapsedMs = now - Date.parse(stageStartedAt)`, `expectedMs = STAGE_EXPECTED_MS[segmentIndex(stage)]`.
- Capped at 92 so the bar never visually completes before the real transition (driven by the next poll flipping `stage`).

`ResumeEditor.tsx` pending-screen block:
- Adds a 1s local ticker (`const [now, setNow] = useState(Date.now())`, `setInterval` while `meta.status === "pending"`) purely to animate the bar and the elapsed-seconds text between the existing 4s polls. The poll remains the sole source of truth for `stage` / `stage_started_at`; the ticker never fetches.
- Under the existing 3-segment stepper, the active segment renders a thin progress bar (violet fill, same palette as the existing dots) plus text: `"34s / ~80s typical"`. When `elapsedSeconds > expectedSeconds`, the bar holds at 92% and the text keeps counting up — no re-labeling needed, the growing elapsed number against a static "typical" figure already communicates "running long."
- `meta` state (which already tracks `stage`) also tracks `stage_started_at`, updated in the same places `stage` currently is (both poll branches in the existing `useEffect`).

### Error handling / edge cases

- `stage_started_at` null → generic spinner (existing `activeIndex === -1` branch already does this for `stage` null; extend the same fallback condition to cover `stage_started_at` null too, even if `stage` is somehow set).
- Long-running outlier (2 trim passes in Finalizing) → bar caps at 92%, elapsed counter keeps counting, not a broken/false-complete state.
- Clock skew between client and server → irrelevant to correctness (the poll response is authoritative for `stage`), only affects animation smoothness between polls, which is inherently approximate anyway.

### Testing

Unit test for `estimateStageProgress` in `resumeStage.ts` (pure function, no DB/LLM/network — fits the existing fast `npm test` gate):
- Null `stage` → `null`.
- Null `stageStartedAt` → `null`.
- Elapsed under expected → proportional percent.
- Elapsed over expected → capped at 92, `elapsedSeconds` still reflects real elapsed time.
- Each of the 3 known stage-label prefixes maps to the right `STAGE_EXPECTED_MS` entry.

### Out of scope

- Splitting "Finalizing formatting" into separate real sub-checkpoints (render / trim pass 1 / trim pass 2) — explicitly deferred; Christopher confirmed the ask was the time estimate, not finer stage granularity. The 92%-cap + elapsed-counter behavior already keeps the estimate honest when Finalizing runs long due to trim passes.
- DB-backed historical/adaptive expected-duration tracking — explicitly deferred in favor of hardcoded constants; revisit if usage volume grows enough for a rolling average to be meaningfully less noisy than a hand-set constant.
