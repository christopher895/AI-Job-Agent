# Resume Grader — Design

**Date:** 2026-10-17
**Status:** Approved; implemented
**Inspired by:** ResuMax's "AI Resume Review" (resumax.ai → Documents → AI Review)

## Goal

A new **Grader** section that scores a resume out of 100 the way an engineering recruiter panel would, and lists every concrete fix with a paste-ready rewrite. Unlike ResuMax, nothing is paywalled: every finding shows its full detail.

Success looks like: Christopher picks a resume (master, a tailored one, or a pasted/uploaded one), a target role and level, optionally a JD; about a minute later he sees a score, five category scores, and a ranked list of findings he can act on — and on a tailored resume, can send the findings straight into the existing feedback-round flow.

### What ResuMax does (observed 2026-10-17)

- Inputs: resume, target role (Software Engineer, Frontend, Backend, Full-Stack, Mobile, DevOps, Data, ML/AI), experience (Intern, Entry 0–2y, Mid 3–5y, Senior 6–10y, Staff+ 10y+), optional JD.
- Five specialists run in parallel — **Recruiter, ATS, Content, Domain, Storyteller** — then a report is assembled (~30s).
- Output: score /100 as the sum of five categories (observed: ATS & structure 20, Content quality 30, Writing quality 8, Job optimization 18, Application readiness 5 → 81), plus numbered findings. Finding detail and rewrites are paywalled.
- Also shows a percentile curve vs. "real resumes scored on ResuMax".

### Out of scope

- **Percentile / "where you rank" curve.** We have no corpus of other people's scored resumes; any curve would be invented.
- Cover letters, interview prep, job matching, career paths (other ResuMax sections).
- Auto-editing the master resume from findings. Master edits stay manual on `/resume/master`.

## Rubric

Five categories, each owned by one specialist. Maxima sum to 100 and are consistent with the ResuMax scores observed above.

| Category | Max | Specialist | Judges |
|---|---|---|---|
| ATS & structure | 25 | **ATS** | Parseability: standard section headings, contact info, consistent date formats, no tables/columns/graphics implied, reverse-chronological order, length |
| Content quality | 35 | **Content** | Bullet strength: action + scope + measurable result, ownership vs. participation, specificity, quantification ("N of M bullets carry a number") |
| Writing quality | 10 | **Recruiter** | First-impression skim: clarity, concision, tense/voice consistency, filler and buzzwords, typos |
| Job optimization | 20 | **Domain** | Fit for the target role + level (and JD when given): expected skills/tools present, relevant work surfaced, keyword coverage |
| Application readiness | 10 | **Storyteller** | Narrative: timeline gaps, unclear current status (student / graduation date / availability), project dates, coherent arc toward the target role |

Level matters: an Intern resume is judged against intern expectations (projects and coursework count; no penalty for lacking production experience).

## Architecture

Mirrors the existing async tailoring pipeline: `POST` returns 202 with a `pending` row, work runs in-process in the background, the page polls.

```
POST /api/grades  { source, resumeId? | text? | file?, targetRole, level, jdText? }
  → resolve resume text (+ JD from the tailored row when source='tailored' and none given)
  → insert resume_grades row (status='pending'), respond 202 { id }
    → [background] runGradePipeline(id)
        registerRun(`grade:${id}`)
        5 specialist calls via completeJSON, at most 2 in flight (shared limiter)
          → as each finishes: write its result into specialists[name]   (drives the progress UI)
        assembleReport(results)  — deterministic, no 6th LLM call
          → status='ready', score, report
        on failure → status='failed', error;  on cancel → status='cancelled' (written by the cancel route)
GET  /api/grades/:id     — polled by /grader/[id] until status leaves 'pending'
```

### Units

| Unit | File | Purpose |
|---|---|---|
| Rubric + schemas | `agent/src/ai/grade/rubric.ts` | Category list, maxima, owning specialist; Zod schemas for a specialist result and the final report |
| Specialist prompts | `agent/src/ai/grade/specialists.ts` | One system prompt per specialist + `buildUserMessage(resumeText, role, level, jd)`; `runSpecialist(name, input, signal)` wraps `completeJSON` |
| Assembler | `agent/src/ai/grade/assemble.ts` | Pure: clamps each category to its max, sums the score, merges findings, labels rewrite groundedness, sorts by severity. Unit-tested |
| Limiter | `agent/src/ai/grade/limit.ts` | Tiny promise pool shared across all grade runs (max 2 concurrent `claude` subprocesses) |
| Pipeline | `agent/src/ai/grade/pipeline.ts` | `runGradePipeline(id)`: orchestration, progress writes, cancel/fail handling |
| Resume text | `agent/src/ai/grade/resume-text.ts` | `masterToText(master)` (plain text rendering of the master resume) and PDF text extraction (reuses the `pdf-parse` path from `/master-resume/import`) |
| Routes | `agent/src/api/routes/grades.ts` | `POST /`, `GET /`, `GET /:id`, `POST /:id/cancel`, `DELETE /:id` |
| Queries | `agent/src/db/queries.ts` + `schema.ts` | `resume_grades` table and access functions |
| Web pages | `web/app/grader/page.tsx`, `web/app/grader/[id]/page.tsx` | Start form + history; report view |
| Web components | `web/components/GradeForm.tsx`, `GradeReport.tsx`, `GradeProgress.tsx` | Form, report, specialist progress |
| Nav + entry point | `Nav.tsx`, `ResumeEditor.tsx` | "Grader" nav item; "Grade this resume" link on `/resume/[id]` → `/grader?resumeId=…` |

### Specialist output schema

```ts
SpecialistResult = {
  score: number,            // int, 0..max for the specialist's category (Zod-enforced per specialist)
  summary: string,          // one or two sentences — the specialist's verdict
  findings: Array<{
    title: string,          // short headline, e.g. "Project timelines missing"
    severity: "high" | "medium" | "low",
    quote: string | null,   // exact text from the resume this is about; null for whole-resume issues
    problem: string,        // why it costs points, in recruiter terms
    rewrite: string | null, // paste-ready replacement for `quote`, or concrete instruction when quote is null
  }>  // 0–6 per specialist
}
```

### Report schema (`resume_grades.report`)

```ts
GradeReport = {
  score: number,                                            // sum of category scores, 0..100
  categories: Array<{ key, label, score, max, summary }>,  // fixed order per rubric table
  findings: Array<Finding & {
    id: string,
    category: CategoryKey,
    groundedness: "grounded" | "needs-your-input",
  }>,                                                       // sorted high → low severity, then category order
}
```

### Groundedness of rewrites

The master resume is the source of truth and the AI must not invent facts. Specialist prompts say rewrites may only use facts already in the resume, and must use bracketed placeholders (`[X%]`, `[N users]`) where a number is needed but unknown. The assembler then labels each rewrite deterministically, reusing `numbers()` from `grounding.ts`: a rewrite containing a number that isn't in the resume text, or containing a `[...]` placeholder, is labeled **needs-your-input**; otherwise **grounded**. The UI shows this as a badge, same idea as the suggestion checklist.

## Data model

```sql
resume_grades (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,            -- 'master' | 'tailored' | 'upload'
  resume_id    uuid references tailored_resumes(id) on delete set null,  -- set when source='tailored'
  label        text not null,            -- display name: "Master resume", "Databricks — SWE Intern", uploaded filename, or "Pasted resume"
  resume_text  text not null,            -- snapshot of exactly what was graded
  target_role  text not null,            -- 'swe' | 'frontend' | 'backend' | 'fullstack' | 'mobile' | 'devops' | 'data' | 'ml'
  level        text not null,            -- 'intern' | 'entry' | 'mid' | 'senior' | 'staff'
  jd_text      text,
  status       text not null,            -- 'pending' | 'ready' | 'failed' | 'cancelled'
  specialists  jsonb not null default '{}',  -- { recruiter: { status: 'pending'|'done'|'failed', result? }, ... }
  score        int,                      -- copied from report.score for cheap listing
  report       jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
)
index on (resume_id, created_at desc)
```

`resume_text` is snapshotted so a grade stays meaningful after the resume is edited, and so history can show score movement across edits of the same resume.

## API

| Method | Path | Body / response |
|---|---|---|
| POST | `/api/grades` | JSON `{ source: 'master' \| 'tailored', resumeId?, targetRole, level, jdText? }` or multipart (`source='upload'`, `file` PDF or `text`) → 202 `{ id }`. 400 on bad input; 404 unknown `resumeId`; 400 if extracted text is empty or over 30,000 chars |
| GET | `/api/grades` | Optional `?resumeId=` → list (no `resume_text`/`report` bodies): id, label, source, resume_id, target_role, level, status, score, created_at |
| GET | `/api/grades/:id` | Full row |
| POST | `/api/grades/:id/cancel` | 409 unless `pending`; aborts the run, writes `cancelled` |
| DELETE | `/api/grades/:id` | Removes the row |

For `source='tailored'`, an omitted `jdText` defaults to that row's `jd_text`. Re-running is just another POST with the same inputs (the report page's "Re-run" button does this).

## UI

Follows the existing paper/ink design system, light main content.

**`/grader`** — two parts:
1. **Start a grade:** resume picker (Master resume · a tailored resume from a dropdown · Paste text / Upload PDF), target role chips, level chips, collapsible "Add a job description (optional)". Last role/level remembered in `localStorage`. Prefilled from `?resumeId=`.
2. **History:** past grades, newest first — label, role/level, score, date; click → report.

**`/grader/[id]`**
- *Pending:* the five specialists as a checklist that ticks off as each finishes (from `specialists`), elapsed time, Cancel button.
- *Ready:* big score `/100`; five category bars with score/max and the specialist's one-line summary; findings list, each card showing severity, category, title, the quoted line, the problem, the rewrite with a Copy button and groundedness badge. Header actions: **Re-run**, and — for `source='tailored'` — **Fix these in the resume**.
- *Failed / cancelled:* error message + Re-run.

**"Fix these in the resume"** (tailored only): checkboxes on findings (all high/medium pre-checked); the button formats the checked findings as feedback text ("Title — problem. Suggested: rewrite") and calls the existing `POST /api/resume/:id/feedback`, then navigates to `/resume/:id`, where the normal feedback round produces suggestions for review. Disabled with an explanation unless that resume is `ready` (the feedback route's own 409 rule).

**Entry point:** `/resume/[id]` gets a "Grade this resume" link → `/grader?resumeId=<id>`.

## Error handling

- Each specialist goes through `completeJSON` (Zod validation + 2 self-correcting retries). If any specialist still fails, the whole grade goes `failed` with a message naming it; partial reports are not shown (a score missing a category would be misleading).
- Cancel follows the existing pattern: the route writes `cancelled` itself; the pipeline's catch sees `CancelledError` and returns without writing `failed`. In-flight `claude` subprocesses are SIGTERM'd via the shared `AbortSignal`; queued specialists never start.
- A process restart orphans a `pending` grade (same as tailoring). The report page shows Re-run once a pending grade is older than 10 minutes.

## Performance and memory

Each specialist is one `claude -p` subprocess. The agent has hit memory limits before (see the Jobright removal), so a module-level limiter caps grader calls at **2 concurrent** across all grades. Expected wall time ≈ 3 rounds × ~20s ≈ 1 minute. The limiter only governs grader calls; tailoring is unaffected.

## Testing

Fast gate (`npm test`, no LLM/DB):
- `test-grade-assemble.ts`: category clamping to max, score sum, finding order (severity then category), stable ids, groundedness labeling (new number → needs-your-input, `[X%]` placeholder → needs-your-input, number present in resume → grounded).
- `test-grade-limit.ts`: never more than N in flight; queued tasks skip when the signal is aborted.
- `test-grade-prompts.ts`: user message includes role/level/JD only when given; each specialist schema rejects a score above its max.
- `test-resume-text.ts`: `masterToText` includes every section and bullet in order.

Integration (`npm run test:integration`): one real grade of the seed master resume, asserting a valid report shape.

Manual: grade the production master resume as ML/AI Intern and compare category scores with ResuMax's 20/30/8/18/5.

## Docs

Update `CLAUDE.md`: "What's Already Built", web flows table, agent and web layout trees, database schema (`resume_grades`), and a "Resume grading" pipeline block.
