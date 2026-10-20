# Smart Job Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Alert only on Summer 2027 internships that beat Christopher's bar (AI judge, fail-open), and watch SimplifyJobs' list.

**Architecture:** Two new stages between the existing `upsertJob` gate and `sendJobEmail` in both alert paths: a pure season filter (`scraper/season.ts`) and an LLM judge (`ai/judge-jobs.ts`, injected completer for tests). Two new preferences (`targetSeason`, `alertBar`) with UI fields. Email rows gain a reason line and a skipped footer.

**Spec:** `docs/superpowers/specs/2026-10-18-smart-alerts-design.md`

## Global Constraints
- Default `targetSeason = "Summer 2027"`, default `alertBar = "Better than a Wells Fargo software engineering internship in Charlotte, NC"`; blank disables each.
- Judge: batches of ≤40, sequential, verdicts mapped by index, fail-open (throw / missing index → send).
- Existing preferences rows lack the new fields: `getPreferences` already merges `FILTERS` defaults — keep it that way; the PUT validator must accept missing/null new fields.
- No new env vars, no schema change.

## Review Focus
1. Judge LLM failure or timeout → all jobs still emailed (pinned: test-judge-jobs "throw → all send").
2. Model returns fewer verdicts than jobs → missing ones sent (pinned).
3. Old preferences row without new fields → defaults apply, PUT still validates (pinned: validator test in Task 3).
4. Repo listing with `terms: ["N/A"]` or missing `terms` field in the feed → dropped vs. treated as board posting (pinned: `terms: []` from feed means "no season" → dropped; field absent → `[]`).
5. Every new job skipped → no email at all (pinned in Task 4 pipeline helper test).

---

### Task 1: Season filter + feed terms
Files: create `agent/src/scraper/season.ts`, `agent/src/scraper/test-season.ts`; modify `scraper/types.ts` (`terms?: string[]`), `scraper/adapters/github-repo.ts` (`terms: Array.isArray(e.terms) ? e.terms : []`), `scraper/test-github-repo.ts`.
Produces: `passesSeason(job: JobListing, target: string | null): boolean`.

Test cases (write first, watch fail): repo terms `["Summer 2027"]` vs target "summer 2027" → pass; `["Fall 2026"]` → fail; `[]` → fail; target null/"" → pass anything; board titles: "Software Engineer Intern" pass, "Fall 2026 Co-op" fail, "Software Co-op" fail, "Spring Intern" fail, "Summer 2027 SWE Intern" pass, "SWE Intern 2026" fail, "Winter/Summer Intern" pass, "SWE Intern 2027" pass, "Autumn Analyst" fail. github-repo: feed entry with `terms` parsed; entry without `terms` → `[]`.

### Task 2: Judge
Files: create `agent/src/ai/judge-jobs.ts`, `agent/src/ai/test-judge-jobs.ts`.
Produces: `JUDGE_BATCH = 40`; `type Verdict = { send: boolean; reason: string }`; `judgeJobs(jobs, bar, deps?: { complete?: CompleteFn }): Promise<Map<string /*url*/, Verdict>>`; `buildJudgePrompt(jobs, bar): { system: string; user: string }`.

Test cases with an injected `complete` fake: 85 jobs → 3 calls of 40/40/5; verdicts mapped by index; missing index → send with empty reason; out-of-range index ignored; fake throws → all send; empty bar → 0 calls, all send; system prompt contains the bar text and "when unsure"; user message lists title/company/location/terms per index.

### Task 3: Preferences
Files: `agent/src/config.ts` (type + defaults incl. Simplify URL in `watchedRepos`), `agent/src/api/routes/preferences.ts` (extract `isValidPreferences(body)` → exported, accept `targetSeason` string|null|undefined, `alertBar` string|undefined), test `agent/src/api/test-preferences-shape.ts`; web `lib/api.ts` type, `components/PreferencesForm.tsx` two fields.
Test: old-shape body (no new fields) valid; `targetSeason: 5` invalid; `alertBar: null` invalid… accept undefined.

### Task 4: Wire into both alert paths + email
Files: create `agent/src/scraper/alert-filter.ts` (`filterForAlert(jobs, prefs, deps?) → { kept: JobListing[]; reasons: Map<string,string>; skipped: number }` — season then judge, logs drops), `agent/src/scraper/test-alert-filter.ts`; modify `scraper/index.ts`, `scraper/github-repos.ts`, `notifications/email.ts` (export `buildEmailHtml`, `sendJobEmail(jobs, source, opts?)`), test `agent/src/notifications/test-job-email.ts`.
Tests: season drops before judge (judge never sees them); all skipped → kept empty; reasons map populated; email row shows escaped reason; footer appears only when skipped > 0.
Company path: `filterForAlert` before scoring/cap; `skipped` = season-dropped + judge-skipped. Repo path: same, no cap. Return early (no email) when kept is empty, logging the skip count.

### Task 5: Docs, live check, review
- CLAUDE.md: scraping→alert pipeline block, What's Built bullet, preferences table, layout trees.
- Live: run `judgeJobs` on 10 real Simplify Summer 2027 listings and eyeball verdicts.
- `npm test` green; fresh whole-branch review; commit + PR when asked.
