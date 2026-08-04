# Real progress stages for resume generation

## Problem

While a resume is generating (`status = 'pending'`), `ResumeEditor.tsx:334-360`
shows a spinner and static text — the same UI regardless of whether the
pipeline is on pass 1 of the draft or about to finish. There is no
stage/progress tracking anywhere in the DB or backend
(`packages/agent/src/db/schema.ts`, `queries.ts`); the generate→critique→revise
loop in `chain.ts:39-62` runs entirely in memory and reports nothing back
until it's done. Christopher wants the pending screen to reflect what the
pipeline is *actually* doing, not a generic "this takes a few minutes"
message.

## Scope

- `packages/agent/src/db/schema.ts` — add a `stage TEXT` column to
  `tailored_resumes`.
- `packages/agent/src/db/queries.ts` — `createPendingResume` and
  `upsertPendingGeneralResume` reset `stage` to `NULL`; new
  `updateResumeStage(id, stage)` query; `TAILORED_RESUME_COLUMNS` picks up
  `stage` automatically once added to the column list; `TailoredResumeRow`
  type gains `stage: string | null`.
- `packages/agent/src/ai/chain.ts` — `generateBestResume` accepts an
  `onProgress?: (stage: string) => void` option and calls it at each real
  transition.
- `packages/agent/src/api/routes/tailor.ts` — `runTailorPipeline` passes a
  callback that writes to the new column.
- `packages/agent/src/ai/general-resume.ts` — `generateGeneralResume` forwards
  the same `onProgress` through to `generateBestResume` so the general resume
  (which shares `ResumeEditor`'s pending/poll UI) gets the same stepper for
  free; `packages/agent/src/api/routes/general-resume.ts`'s
  `runGeneralResumePipeline` wires the callback the same way `tailor.ts` does.
- `packages/web/lib/api.ts` — `ResumeListItem`/`Resume` types gain
  `stage: string | null`.
- `packages/web/components/ResumeEditor.tsx` — pending-state block
  (`:334-360`) replaced with a 4-segment stepper driven by `meta.stage`.

Out of scope:
- Numeric percentages anywhere — stages are shown as labels only, since pass
  count varies (1-3) and isn't known in advance.
- PDF rendering as a tracked stage. It happens after `status` already flips
  to `'ready'` (`tailor.ts:125-138`), by which point the frontend has already
  stopped polling and is showing the editor — same as today, no change.
- Changing the 4-second poll interval (`ResumeEditor.tsx:241-274`) or the
  polling mechanism (no SSE/websockets).
- Any change to `/tailor`'s own pre-redirect "Starting…" button state
  (`TailorForm.tsx:216-225`) — that's before the row even has a stage.

## Design

### Stage values

Exactly four strings, emitted by `chain.ts` at real transitions in the loop
(`chain.ts:39-62`):

1. `"Drafting resume (pass N)"` — emitted right before `tailorResume(...)`
   on each iteration (`chain.ts:42`), N = current iteration.
2. `"Critiquing draft"` — emitted right before `evaluate(...)`
   (`chain.ts:50`).
3. `"Revising resume (pass N)"` — emitted after a critique fails to clear
   `targetScore` and before the loop continues to the next iteration's
   draft — functionally the same code path as stage 1's draft call on
   iteration N+1, but the callback passes a distinct string so the frontend
   can tell "first draft" from "a revision" apart.
4. `"Finalizing formatting"` — emitted in `tailor.ts`'s `runTailorPipeline`
   (and the general-resume pipeline) right before calling `fitToOnePage`
   (`tailor.ts:103`), after the loop returns.

`chain.ts` only ever emits stages 1-3 (draft/critique/revise); "Finalizing
formatting" is emitted by the caller (`tailor.ts` / `general-resume.ts`)
since `fitToOnePage` lives outside `generateBestResume`.

### Backend wiring

`chain.ts`:
```ts
export type GenerateOptions = TailorOptions & {
  maxIterations?: number;
  targetScore?: number;
  onProgress?: (stage: string) => void;
};
```
Inside the loop:
```ts
for (let i = 1; i <= maxIterations; i++) {
  opts.onProgress?.(i === 1 ? "Drafting resume (pass 1)" : `Revising resume (pass ${i})`);
  ({ tailored } = await tailorResume(jd, { ...opts, master, feedback }));
  opts.onProgress?.("Critiquing draft");
  critic = await evaluate(master, tailored, jd, { model: opts.model });
  ...
}
```
This distinguishes "first draft" from "revision" using the iteration index
already in the loop (`i === 1`), with no new state.

`tailor.ts`'s `runTailorPipeline` passes
`onProgress: (stage) => updateResumeStage(id, stage).catch((err) => console.error(...))`
into `generateBestResume`, fire-and-forget (matching the existing pattern for
`storePdf`/`setPdfError` elsewhere in the same file — a stage-write failure
must never abort or delay the pipeline). Right before `fitToOnePage`
(`tailor.ts:103`), it calls `updateResumeStage(id, "Finalizing formatting")`
directly, awaited (cheap single UPDATE, and worth not racing against the
fit-page call it precedes).

`packages/agent/src/ai/general-resume.ts` and
`packages/agent/src/api/routes/general-resume.ts` follow the same shape:
`generateGeneralResume` takes an `onProgress` param and forwards it to
`generateBestResume`; `routes/general-resume.ts`'s
`runGeneralResumePipeline` wires the callback identically to how
`tailor.ts`'s `runTailorPipeline` does.

`updateResumeStage` (new, in `queries.ts`, next to `setPdfError`):
```ts
export async function updateResumeStage(id: string, stage: string): Promise<void> {
  await pool.query("UPDATE tailored_resumes SET stage = $1 WHERE id = $2", [stage, id]);
}
```
No `updated_at` bump — this is a high-frequency internal progress signal, not
a content change, and bumping it would make "last updated" misleading on the
dashboard.

### Schema

```sql
ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS stage TEXT;
```
Nullable, no default, no backfill — only meaningful transiently while
`status = 'pending'`. `createPendingResume` and `upsertPendingGeneralResume`
both already `INSERT` fresh rows, so a new column with no explicit value
defaults to `NULL` correctly on its own; `upsertPendingGeneralResume`'s
`ON CONFLICT ... DO UPDATE` needs `stage = NULL` added to its `SET` clause so
a re-generation of the singleton row clears any stale stage from a previous
run.

### API surface

`TAILORED_RESUME_COLUMNS` (`queries.ts:131`) already drives every `SELECT`
that returns a full row — adding `stage` to that column list is sufficient
for `GET /api/resumes/:id` and `GET /api/general-resume` to return it with no
route changes. `ResumeListItem`/`Resume` types in both `db/queries.ts` and
`web/lib/api.ts` gain `stage: string | null`.

### Frontend stepper

Replace `ResumeEditor.tsx:334-360`'s spinner block with a 4-segment stepper:

```
Drafting  →  Critiquing  →  Revising  →  Finalizing
```

Segment match is by prefix, not exact string (so `"Revising resume (pass 2)"`
and `"Revising resume (pass 3)"` both light up the "Revising" segment,
and a later `"Critiquing draft"` after a revision correctly moves the
highlight *back* to "Critiquing" rather than erroring on an out-of-order
transition):

```ts
function segmentIndex(stage: string | null): number {
  if (!stage) return -1;
  if (stage.startsWith("Drafting")) return 0;
  if (stage.startsWith("Critiquing")) return 1;
  if (stage.startsWith("Revising")) return 2;
  if (stage.startsWith("Finalizing")) return 3;
  return -1;
}
```

Rendering: completed segments (index < current) shown filled/checked, the
current segment pulses (reuse the existing `animate-spin` treatment, applied
to a small dot next to the active label instead of a single big spinner),
later segments dimmed. The raw `stage` string is also shown as a line of text
below the stepper (e.g. "Drafting resume (pass 2)") so the pass number is
visible even though the stepper itself only has 4 fixed slots.

If `stage` is `null` (row created but no callback has fired yet — e.g. the
short window before the first draft call, or an old in-flight row from
before this migration), render today's plain spinner + "Generating…" text
as a fallback — never an empty/broken stepper.

### Error handling

- `updateResumeStage` failures are logged and swallowed (fire-and-forget),
  matching `storePdf`/`setPdfError`'s existing pattern in `tailor.ts` — a
  progress-tracking write must never fail or delay the actual generation.
- No change to `failTailoredResume` — `stage` is left as whatever it last was
  on a failed row; the frontend's existing `status === "failed"` branch
  (`ResumeEditor.tsx:362-387`) takes over and never reads `stage`.

### Testing

- Unit: `segmentIndex()` against every real stage string the backend can
  emit, including out-of-order transitions (drafting → critiquing → revising
  → critiquing again) to confirm the highlight moves backward correctly
  rather than getting stuck.
- Unit: `upsertPendingGeneralResume`'s `ON CONFLICT` clause actually clears
  `stage` on a second call (regression guard — a stale "Finalizing
  formatting" from a previous run must not linger and render as the initial
  state of a fresh generation).
- Manual, via `/run`: trigger a real tailor request, watch the stepper move
  through Drafting → Critiquing → (Revising → Critiquing, if the first pass
  doesn't clear the target score) → Finalizing → editor. Also trigger a
  general-resume regeneration and confirm the same stepper appears there.
