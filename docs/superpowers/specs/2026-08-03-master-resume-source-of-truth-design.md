# Master resume as source of truth, general-resume removal, suggestion-based tailoring

## Problem

Christopher already maintains a hand-tailored, well-worded one-page resume
outside this app (Google Docs + a LaTeX copy). The in-app master resume
(`packages/agent/src/ai/master-resume.ts`) is a separate, less-polished copy
that can render to more than one page (`renderMasterResumePdf` has no
one-page fitting pass, unlike `fitToOnePage`). Per-job tailoring
(`chain.ts`'s generate→critique→revise loop calling `tailor.ts` up to 3
times) selects/reorders/rewords a subset of master bullets per JD — this
routinely reworks phrasing more than desired for someone who already has
resume wording he's happy with. The general-resume feature
(`GeneralResumeTab.tsx`, `ai/general-resume.ts`) exists to approximate "a
good all-around resume," which is redundant once the master resume itself
holds that content.

Goal: make the in-app master resume the actual source of truth (his real
resume, imported, capped at one page), retire general-resume from the UI,
and change per-job tailoring from "regenerate a subset with reworded prose"
to "propose a short list of JD-keyword insertions into the existing
one-page resume, which he explicitly approves before anything is applied."

## Scope

- `packages/agent/src/ai/import-master-resume.ts` (new) — extracts a
  `MasterResume` from pasted text or PDF-extracted text via an LLM call.
- `packages/agent/src/api/routes/master-resume.ts` — new
  `POST /api/master-resume/import` endpoint.
- `packages/web/components/MasterResumeForm.tsx` — new Import action
  (paste/upload); remove the Master/General toggle, the General tab,
  `GeneralResumeTab` import, and the "Sync to General ⟳" button.
- `packages/agent/src/ai/suggest-keywords.ts` (new) — single-pass LLM call
  that proposes keyword-insertion suggestions against the fixed master
  resume; replaces `chain.ts`/`tailor.ts`/`critic.ts` for the main tailor
  flow (those files are untouched and stay in use by the dormant
  general-resume path only).
- `packages/agent/src/ai/apply-suggestions.ts` (new) — pure function that
  substitutes accepted suggestions into the master resume content.
- `packages/agent/src/db/schema.ts` / `queries.ts` — `tailored_resumes`
  gains a `suggestions JSONB` column and an `awaiting_review` status.
- `packages/agent/src/api/routes/tailor.ts` — rewritten pipeline: suggest →
  await review → apply → fit → render.
- `packages/web/components/ResumeEditor.tsx` — new "awaiting_review" render
  state (the suggestion checklist), before the existing ready/editor state.
- `packages/web/lib/api.ts` — new types/methods for suggestions and the
  import endpoint.

Out of scope:
- The "chat with the AI" interactive editing mode discussed as an
  alternative — noted as a future extension on the same suggestion data
  model, not built now.
- Deleting `general-resume.ts`, `routes/general-resume.ts`, or its DB rows —
  left in place, just unreachable from the UI.
- Automatic one-page trimming of the master resume — a warning banner only;
  Christopher edits it directly since it's his real resume.
- Re-deriving `master-resume.ts` (the hardcoded seed file) — it becomes dead
  code after the first import but isn't deleted as part of this change.

## Design

### A. Master resume import

**Extraction (`import-master-resume.ts`):**
```ts
export async function importMasterResume(rawText: string): Promise<MasterResume>
```
Single `completeJSON(MasterResumeSchema, ...)` call. System prompt instructs
the model to map the input 1:1 into the schema: preserve bullet wording
verbatim (do not improve or shorten it — this is an import, not a rewrite),
invent a stable `id` per bullet/experience/project (`exp-<slug>-N` /
`proj-<slug>-N` pattern matching the existing seed data), and leave fields
it cannot find (portfolio, linkedin, etc.) as empty strings rather than
guessing. No grounding check applies here — there's no prior source to
check against; the input text *is* the source.

**Route (`POST /api/master-resume/import`):**
Accepts `{ text: string }` (pasted content) or a multipart PDF upload
(`multer`, memory storage, single file field `file`). PDF path extracts text
via `pdf-parse` first, then both paths converge on `importMasterResume`.
Returns the parsed `MasterResume` JSON directly — **does not write to the
DB**. New deps: `pdf-parse`, `multer`.

**Frontend:** a new "Import" button on `/resume/master` opens a small panel
with a text area and a file input. On submit, calls the import endpoint and
does `setResume(result)` — same state the form already manages — leaving
the existing dirty-tracking and Save button as the only path to persist. No
new save codepath.

### B. One-page policy (warning, not enforcement)

The existing "Preview PDF" action already renders via
`renderMasterResumePdf`. Reuse `fit-page.ts`'s `countPdfPages` helper (it
already shells out to `pdfinfo`, already a dependency) to report page count
alongside the preview. If `pages > 1`, show a banner: "This master resume is
N pages — trim a bullet or shorten wording before saving." Non-blocking:
Save still works, matching the existing pattern of this being *his* content
to control directly. No automatic trim pass added for master resume.

### C. Suggestion-based tailoring

**Data shape** (new, in `types.ts`):
```ts
export const SuggestionSchema = z.object({
  id: z.string(),                    // stable id for the checklist, e.g. "sugg-1"
  kind: z.enum(["bullet-rewrite", "skill-addition"]),
  targetId: z.string(),              // bullet-rewrite: master bullet id.
                                      // skill-addition: one of "languages" | "frameworks" | "tools"
                                      // (the master skills category to append into — never "interests").
  keyword: z.string(),               // the JD term this suggestion surfaces
  originalText: z.string().optional(),   // bullet-rewrite only
  suggestedText: z.string(),         // bullet-rewrite: proposed bullet text.
                                      // skill-addition: the single skill/tool name to add.
  groundedness: z.enum(["grounded", "extrapolated"]),
  rationale: z.string(),
  accepted: z.boolean().nullable().default(null), // null until reviewed
});
export type Suggestion = z.infer<typeof SuggestionSchema>;
```
The system prompt for `suggestKeywords` must enumerate `targetId`'s valid
values for `skill-addition` explicitly (`"languages" | "frameworks" |
"tools"`) so the model never invents a fourth category.
`groundedness` is computed the same way `grounding.ts` already reasons about
provenance: `grounded` if every number/tool named in `suggestedText` already
appears somewhere in the master resume (bullet, its `tech`/`metrics`, or
`skills`); `extrapolated` otherwise. This reuses `grounding.ts`'s existing
number/skill-matching logic as a labeling function rather than a gate.

**Suggestion generation (`suggest-keywords.ts`):**
```ts
export async function suggestKeywords(jd: string, master: MasterResume): Promise<Suggestion[]>
```
One `completeJSON` call. System prompt: "The candidate's resume below is
fixed and already exactly one page — do not propose removing, reordering,
or restructuring anything. Your only job is to find JD keywords/technologies
that aren't currently reflected and suggest the smallest possible wording
change to a specific existing bullet (or a skill-list addition) that would
surface it. It is acceptable to suggest a plausible extrapolation beyond
what's literally stated, as long as it's a reasonable reading of the
bullet's context — mark those `extrapolated`, not `grounded`. Never suggest
more than one change per bullet. Prefer fewer, higher-confidence
suggestions over many marginal ones." Output: `Suggestion[]` (without
`accepted`, which starts `null` and is UI/DB state).

**Apply step (`apply-suggestions.ts`):**
```ts
export function applySuggestions(
  master: MasterResume,
  accepted: Suggestion[]
): { master: MasterResume; tailored: TailoredResume }
```
Pure function, and the one place this flow reuses existing rendering code
instead of duplicating it. It builds two things:
- an adjusted `master` — a deep clone with each accepted `skill-addition`'s
  `suggestedText` appended to `skills[targetId]` (one of
  `languages`/`frameworks`/`tools`), case-insensitive de-duped; otherwise
  identical to the input.
- a full-coverage `tailored` (the existing `TailoredResumeSchema` shape) —
  every master experience/project section included, every bullet present
  with `sourceId` = its own master id and `text` = the accepted
  `bullet-rewrite`'s `suggestedText` where one targets it, else the
  original master text unchanged. `skillsOrder: []` (so `renderMarkdown`'s
  `orderWithinCategory` falls through to master's own order — nothing is
  re-ranked). `cut: []`, `keywordsCovered`: the accepted suggestions'
  `keyword`s, `reasoning: ""`.

The route then calls the **existing** `renderMarkdown(result.master,
result.tailored)` from `format.ts` unchanged — it already handles
Education/Extracurriculars/Skills verbatim from `master` and
Experience/Projects from `tailored`, which is exactly what "every bullet
present, some rewritten" needs. No new markdown renderer, no new PDF path.
(`lintFormat`/`keywordCoverage` from the same file, and `chain.ts`/
`critic.ts`, remain unused by this flow — those stay in place only for the
dormant general-resume path.)

**Pipeline (`routes/tailor.ts`, rewritten):**
1. `POST /api/tailor` — unchanged (fetch JD if URL, create row). Row starts
   `status = 'pending'`.
2. Background: `suggestKeywords(jd, master)` → store the result in the new
   `suggestions` column, flip `status = 'awaiting_review'`.
3. Frontend polls as today; on `awaiting_review`, `ResumeEditor` renders the
   checklist instead of the pending spinner: each suggestion as a row with
   a checkbox, the `groundedness` badge, and an editable text field
   (pre-filled with `suggestedText`) so wording can be hand-tweaked before
   acceptance.
4. `POST /api/resumes/:id/apply-suggestions` with the (possibly edited)
   accepted suggestions — backend calls `applySuggestions(master, accepted)`,
   renders markdown via the existing `renderMarkdown(result.master,
   result.tailored)`, writes the final `suggestions` array back (now with
   `accepted`/edited text set, for audit — "why does this resume say
   Kubernetes" stays answerable later), runs `fitToOnePage` on the rendered
   markdown as a safety net, stores markdown + PDF, flips `status =
   'ready'`.
5. From `ready` onward, existing `ResumeEditor` behavior (inline edit,
   download, email, mark applied) is unchanged.

**Schema:**
```sql
ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS suggestions JSONB;
ALTER TABLE tailored_resumes DROP CONSTRAINT IF EXISTS tailored_resumes_status_check;
ALTER TABLE tailored_resumes ADD CONSTRAINT tailored_resumes_status_check
  CHECK (status IN ('pending','awaiting_review','ready','failed'));
```
`critic_score` is left `NULL` for rows produced by this flow (no critic
step runs); the column stays in place for the dormant general-resume path,
and any UI display of critic score is made conditional on it being non-null.

**Progress stepper impact:** the 4-segment stepper added in
`2026-07-29-tailoring-progress-stages-design.md` (Drafting → Critiquing →
Revising → Finalizing) no longer matches this flow's stages. Replace with:
`Fetching job description` (only when a URL was given) → `Analyzing job
description` (the single `suggestKeywords` call) → then the flow pauses on
`awaiting_review` for human input (not a stepper segment — the checklist UI
itself is the "next step") → after apply: `Applying your selections` →
`Finalizing formatting`. `segmentIndex()` and the stage strings emitted by
`suggest-keywords.ts` / `apply-suggestions.ts`'s caller are updated to match;
the general-resume path keeps emitting the old 4 stages unchanged, since it
still runs the old `chain.ts` loop.

## Testing

- Unit: `applySuggestions` — accepted rewrite replaces only the targeted
  bullet's text, byte-identical elsewhere; accepted skill-addition appends
  once (idempotent if already present); rejected/unset suggestions produce
  no change; empty accepted list returns master unchanged.
- Unit: groundedness labeling — a suggestion whose numbers/tools all trace
  to the master resume is `grounded`; one introducing an unlisted tool or
  number is `extrapolated`. Reuse `grounding.ts` test fixtures.
- Unit: `importMasterResume` — feed a small fixture resume text, assert the
  parsed result validates against `MasterResumeSchema` and preserves bullet
  wording verbatim (no paraphrasing).
- Manual, via `/run`: import a real resume PDF, confirm the review form
  pre-fills correctly and Save persists; submit a JD through `/tailor`,
  confirm the checklist renders suggestions with badges, accept a subset,
  confirm the final PDF only reflects accepted changes and is one page.
