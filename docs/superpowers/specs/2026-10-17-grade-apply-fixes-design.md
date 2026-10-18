# Apply Grader Fixes to the Resume — Design

**Date:** 2026-10-17
**Status:** Approved; implemented
**Builds on:** `docs/superpowers/specs/2026-10-17-resume-grader-design.md`

## Goal

Turn a grade's findings into resume edits with a few clicks instead of copy, find, paste, and fill in `[X%]` by hand.

Success looks like: on a grade of the master resume, Christopher checks the findings he agrees with, fills in any real numbers, clicks **Apply N to master resume**, and lands on `/resume/master` with those bullets already rewritten — unsaved and highlighted — plus a to-do list for the fixes that need hand edits. He reviews, clicks Save, and can re-grade to see the score move.

## Decisions (agreed in conversation)

- **Unsaved hand-off, not a direct write.** Fixes open in the master editor as unsaved edits, the same way Import works today. Nothing changes until Save. (Rejected: saving directly; writing to a new tailored copy.)
- **No extra LLM call.** Apply uses the rewrites already shown on the report, after Christopher edits them. (Rejected: an AI pass that applies findings — slower and can drift from what was approved.)
- **Only bullet rewrites are applied automatically.** Structural findings (page length, ordering, skills, missing info) become a to-do list.
- **Tailored grades keep the existing feedback-round flow** ("Fix N in the resume"). Tailored resumes regenerate from the master, so fixing the master improves them.
- **Pasted/uploaded grades** get **Copy fixed resume text**: the graded text with the checked rewrites swapped in.

## Behavior

### Report page, `source='master'`

On load, the report fetches the *current* master resume (`api.getMasterResume()`) and classifies every finding:

| Class | When | UI |
|---|---|---|
| **Applicable** | `quote` matches exactly one bullet in experience, projects, or extracurriculars | Checkbox, editable rewrite textarea (prefilled from `rewrite`), "Applies to: *Company / Project*" |
| **To-do** | everything else: `quote` is null, matches no bullet (a header, skills line, or a bullet edited since the grade), or matches more than one | Checkbox labeled "Add to to-do list"; when `quote` is set but unmatched, a muted note "Couldn't match this to a single bullet — edit by hand" |

Defaults: applicable high/medium findings are pre-checked *unless* their rewrite contains a placeholder; to-dos are unchecked.

**Placeholders block applying.** A rewrite containing `[...]` cannot be checked (checkbox disabled, hint "Replace the [ ] parts with your real numbers"). Editing the textarea to remove every placeholder enables it. An empty rewrite also cannot be checked.

**Apply N to master resume** (N = checked applicable findings) is enabled when N > 0 or any to-do is checked. It writes the hand-off (below) and navigates to `/resume/master`.

The existing groundedness badge stays, but is recomputed against the *edited* text client-side only for the placeholder rule; numbers Christopher types himself are his facts.

### Hand-off

`sessionStorage["grader:master-fixes"]`:

```ts
{
  gradeId: string,
  targetRole: TargetRole, level: Level, jdText: string | null,   // for Re-grade
  createdAt: number,                                              // ms epoch
  fixes: Array<{ bulletId: string; original: string; text: string; title: string }>,
  todos: Array<{ title: string; category: string; problem: string; rewrite: string | null }>,
}
```

`original` is the bullet text at hand-off time, so the editor can refuse a fix whose bullet changed in between. sessionStorage (not localStorage) keeps it to the tab; the editor deletes the key as soon as it reads it, so a refresh never re-applies. A hand-off older than 10 minutes is ignored and deleted.

### Master editor (`/resume/master`)

On mount, if a fresh hand-off exists:

1. For each fix, find the bullet by `bulletId`; apply only if its current text still equals `original`. Applied fixes replace `text`; `tech`, `metrics`, `tags`, and `id` are untouched.
2. Set the result as the form's unsaved state (same path Import uses), and remember the applied bullet ids.
3. Show a banner at the top: "**6 fixes from your grade applied** — review the highlighted bullets, then Save. [Discard]". If any fix was skipped: "1 skipped because that bullet changed." The banner lists the checked to-dos (title + category + problem, and the suggestion when present), each dismissable.
4. Applied bullets render with a violet ring until saved or discarded.
5. **Discard** restores the form to the loaded master and clears the banner.
6. After a successful Save, the banner becomes "Saved. [Re-grade]" — Re-grade POSTs a master grade with the hand-off's role, level, and JD and navigates to it.

Manual edits after the hand-off are normal unsaved edits; Save writes everything as today.

### Report page, `source='upload'`

Same per-finding checkbox + editable rewrite for findings whose `quote` appears verbatim (after normalization) exactly once in `resume_text`. **Copy fixed resume text** copies `resume_text` with each checked quote replaced by its edited rewrite. Placeholders block checking, as above.

### Report page, `source='tailored'`

Unchanged.

## Matching rules

`normalize(s)`: Unicode NFKC; curly quotes → straight; en/em dashes → `-`; strip a leading bullet marker (`-`, `•`, `*`) and surrounding Markdown emphasis (`**`); collapse whitespace; trim; strip trailing `.`; lowercase.

A finding matches a bullet when `normalize(quote) === normalize(bullet.text)` (whole-bullet match, the common case since `masterToText` emits one bullet per line), or when `normalize(quote)` is at least 20 characters and occurs inside exactly one `normalize(bullet.text)` (partial match). A partial match replaces only that span: the edited rewrite is spliced into the bullet's original text at the matched position. Exactly one bullet must match; two or more → to-do.

For upload text, the same normalization is applied per line; a quote must match exactly one line or one in-line span.

## Units

| Unit | File | Purpose |
|---|---|---|
| Fix logic (pure) | `web/lib/gradeFixes.ts` | `normalize`, `matchBullet(master, quote)`, `classifyFindings(master, findings)`, `hasPlaceholder`, `applyFixes(master, fixes) → { resume, applied, skipped }`, `fixedResumeText(text, edits)`, hand-off `write/readHandoff` (with expiry + delete-on-read) |
| Report UI | `web/components/GradeReport.tsx` + new `GradeFixList.tsx` | Master/upload fix checklist, editable rewrites, Apply / Copy buttons |
| Editor | `web/components/MasterResumeForm.tsx` + new `GradeFixBanner.tsx` | Read hand-off on mount, apply, banner, highlight, discard, re-grade |

No agent/API or schema changes.

## Error handling

- `getMasterResume` fails on the report → master findings show as to-dos only, with a note "Couldn't load your master resume to match lines."
- sessionStorage unavailable (private mode) → Apply shows an inline error instead of navigating.
- Hand-off JSON malformed → ignored and deleted.
- Re-grade POST fails → banner shows the error; the save already succeeded.

## Testing

Fast gate (`web/lib/test-grade-fixes.ts`, chained into web `npm test`):
- normalize: dashes, curly quotes, `**`, leading `- `, trailing period, whitespace.
- matchBullet: whole match; partial match ≥20 chars; partial <20 chars → none; two matching bullets → ambiguous; extracurricular bullets included.
- classifyFindings: null quote → to-do; unmatched quote → to-do with the unmatched note; ambiguous → to-do; single match → applicable with bulletId and owner label.
- hasPlaceholder: `[X%]`, `[N users]` true; plain text and `(note)` false.
- applyFixes: replaces only matching bullets; preserves id/tech/metrics/tags and every other bullet; partial splice keeps surrounding text; bullet whose text ≠ `original` is skipped and reported.
- fixedResumeText: replaces checked quotes once; leaves others.
- handoff: round-trips; deleted after read; expired → null; malformed → null.

Manual: grade master → check 3 fixes (one with a filled placeholder) and 1 to-do → Apply → highlighted bullets + to-do banner → Save → Re-grade.

## Out of scope

- Automatically applying skill additions, reordering, or cuts.
- Applying fixes to tailored resumes directly (they keep the feedback round).
- Persisting edited rewrite text on the grade.
