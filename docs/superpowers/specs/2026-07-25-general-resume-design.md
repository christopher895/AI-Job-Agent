# General (JD-less) resume, synced from Master

## Problem

Every tailored resume today requires a job description to drive
`generateBestResume(jd)` — there's no way to produce a general-purpose,
one-page SWE resume to hand out when there's no specific posting to tailor
against (career fairs, cold outreach, "send me your resume" asks). Christopher
wants a resume that's derived from the Master Resume the same way a tailored
resume is (AI-curated bullet/skill selection, not a raw dump), stays
one page, is independently editable afterward, and can be re-synced from
Master on demand without losing that editability.

## Scope

- `packages/agent/src/db/schema.ts` — add a `kind` column to
  `tailored_resumes` (`'tailored'` default | `'general'`), with a partial
  unique index enforcing at most one `kind='general'` row.
- `packages/agent/src/db/queries.ts` — `listTailoredResumes()` filters to
  `kind='tailored'`; new `getGeneralResume()` / upsert-to-pending query.
- `packages/agent/src/ai/chain.ts` / `tailor.ts` — **unchanged**. Reused as-is
  with a canned prompt in place of a real JD.
- `packages/agent/src/ai/fit-page.ts` — currently dead code (defined,
  never called). Wired into both the new general-resume pipeline and the
  existing `/api/tailor` pipeline.
- `packages/agent/src/api/routes/general-resume.ts` — new: `GET
  /api/general-resume`, `POST /api/general-resume/generate`.
- `packages/agent/src/api/routes/tailor.ts` — add the `fitToOnePage()` call
  to `runTailorPipeline()`.
- `packages/web/app/resume/master/page.tsx` — becomes the toggle-owning
  wrapper: fetches the master resume (as today) and, lazily, the general
  resume row; renders `MasterResumeForm` or the new `GeneralResumeTab` based
  on the selected mode.
- `packages/web/components/GeneralResumeTab.tsx` — new: empty-state
  "Generate" CTA, then wraps `ResumeEditor` + the "Sync from Master" button
  once a row exists.
- `packages/web/components/MasterResumeForm.tsx` — gains the mode-toggle
  control itself (rendered in its header) and the "Sync to General" button;
  its own form/preview behavior is otherwise unchanged.
- `packages/web/components/ResumeEditor.tsx` — **unchanged**. The general
  resume is just a `tailored_resumes` row, so editing, PDF preview, download,
  and email all work with zero modification.

Out of scope:
- Any change to `/` (dashboard) beyond excluding `kind='general'` from the
  list query — the general resume is not a job application and isn't listed
  there.
- Changing what the tailorer is allowed to touch. The general resume uses
  the exact same `tailorableSlice()` scope as job-tailored resumes:
  experience/projects/skills(languages/frameworks/tools) are AI-curated;
  education, extracurriculars, interests, and contact info are copied
  verbatim from Master, untouched, exactly like today.
- Auto-sync when Master changes. Syncing is always an explicit user action
  (button), never automatic — matches how Master edits already require an
  explicit Save.

## Design

### Data model

```sql
ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'tailored';
ALTER TABLE tailored_resumes ADD CONSTRAINT tailored_resumes_kind_check
  CHECK (kind IN ('tailored', 'general'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_tailored_resumes_one_general
  ON tailored_resumes ((true)) WHERE kind = 'general';
```

The partial unique index (indexing the constant `true` filtered to
`kind='general'`) makes "at most one general resume" a DB-level guarantee,
not just application discipline — a second `INSERT ... kind='general'`
without `ON CONFLICT` handling will fail the constraint.

`listTailoredResumes()` (backing the `/` dashboard) adds `WHERE kind =
'tailored'`.

### Why reuse `tailored_resumes` instead of a dedicated table

Considered a separate `general_resume` singleton table mirroring
`master_resume` (`id=1`, `data jsonb`). Rejected: `ResumeEditor.tsx` and the
entire `/api/resume/:id` surface (edit, on-demand PDF, email, download,
**and the existing pending/poll UI for async generation**) are built around
the `tailored_resumes` row shape. A dedicated table would mean either
duplicating that whole stack or reshaping `ResumeEditor` to accept two row
shapes — more code for a document that behaves identically to a tailored
resume in every way except how its content gets selected.

### Generation

`GENERIC_SWE_PROMPT` (new, likely in `chain.ts` or a small new file next to
it) — a fixed block of text standing in for a job description, describing a
general backend/full-stack SWE role, broad enough to be honest but written to
push the tailorer toward the **strongest, most quantified, most broadly
impressive** subset of bullets rather than being maximally inclusive (there's
no real JD narrowing the set the way a real posting does).

`POST /api/general-resume/generate`:
1. Upsert the singleton row to `status='pending'` in one statement, keyed off
   the partial unique index (`INSERT ... ON CONFLICT DO UPDATE SET
   status='pending', error=NULL, updated_at=now() RETURNING *`) — reuses the
   same row/id across every regeneration, so its URL never changes.
2. Respond `202 { id, status: 'pending' }` immediately — mirrors
   `routes/tailor.ts`'s existing async shape, since this is the same
   potentially-slow LLM pipeline.
3. Background: `generateBestResume(GENERIC_SWE_PROMPT)` (unmodified) →
   `fitToOnePage(markdown)` (newly wired in) → store markdown + PDF, flip
   `status='ready'` (or `'failed'` + error message, reusing
   `failTailoredResume`).

`GET /api/general-resume` returns the row, or 404 if never generated.

### Wiring `fitToOnePage()` into both pipelines

Confirmed by grep + `git log --follow` that `fitToOnePage()` is fully built
(page-count via `pdfinfo`, LLM trim loop, widow-word fix) but never called
from any route, `chain.ts`, or test — the wiring commit apparently never
landed. Regular tailored resumes land on one page today only as a side
effect of prompt constraints (`best-practices.ts`'s bullet-count/word-count
guidance) and JD-driven relevance filtering, not any actual page-fit
mechanism.

Both pipelines gain the same one call, right before storing the PDF:
```ts
const { markdown: finalMarkdown, pdf } = await fitToOnePage(result.markdown);
```
- **General resume**: load-bearing — there's no JD to narrow content, so this
  is the only thing standing between Master's full content and a one-page
  output.
- **Existing `/api/tailor`**: defense-in-depth for edge cases (verbose JD,
  a master resume entry that grows over time) — added because it's a cheap
  addition to a path that already exists and matches the documented
  one-page policy, not because anything is visibly broken today.

### Frontend

`/resume/master` gets a Master/General mode toggle at the top of the left
sidebar (above the existing Basics/Experience/.../Extracurriculars section
list, which continues to apply only in Master mode). This requires
extracting a thin wrapper around today's `MasterResumeForm` default export
so the toggle can live above/alongside it and swap the entire content+preview
pane.

**General mode:**
- No row yet (`GET /api/general-resume` → 404): empty state with a "Generate
  General Resume" button → `POST /api/general-resume/generate`, then render
  `<ResumeEditor>` once the row exists.
- Row exists: renders `<ResumeEditor resume={row} />` unchanged — same
  editing, PDF pane, download, email, and (for free) the same pending/poll
  handling `ResumeEditor.tsx:240-274` already has for `status='pending'`.
  Above it, a **"Sync from Master ⟳"** button — confirms first ("this will
  overwrite your manual edits to the general resume"), then calls the same
  generate endpoint and re-fetches the row (remounting `ResumeEditor` with a
  fresh `key` so it picks up the new content instead of stale local state).

**Master mode:** gets a second, lightweight **"Sync to General ⟳"** button
in the existing header toolbar (next to Preview PDF / Save Changes). It's a
shortcut for "I just edited Master, push it to General now" without
manually switching tabs first:
1. Disabled with a tooltip ("Save changes first") if the Master form has
   unsaved edits — sync always reads from the DB-persisted master resume via
   `getMasterResume()`, same source every other consumer uses, so unsaved
   form state would silently not be reflected otherwise.
2. On click: calls `POST /api/general-resume/generate`, then flips the mode
   toggle to General so the user lands on `ResumeEditor` and watches it go
   through the same pending → ready flow.

Both buttons trigger the identical backend action — there are two entry
points (make it discoverable from wherever you're already looking) but one
underlying sync operation.

### Testing

- Unit: `listTailoredResumes()` excludes `kind='general'`; the upsert-to-
  pending query is idempotent (second call reuses the same row id, doesn't
  violate the partial unique index); `fitToOnePage()` gets exercised in
  pipeline tests if any exist for `runTailorPipeline`/the new general-resume
  pipeline function.
- Manual, via `/run`: generate a general resume, confirm one page; edit and
  save it; use "Sync to General" from the Master tab, confirm it lands on
  the General tab and overwrites; confirm the dashboard (`/`) never lists
  the general resume; confirm a regular job-tailored resume still renders
  correctly with `fitToOnePage()` now in its path (in particular: a resume
  that previously happened to land on exactly one page should render
  identically, not get needlessly trimmed).
