# Smart Job Alerts — Design

**Date:** 2026-10-18
**Status:** Approved; implemented

## Goal

Alert emails should contain only Summer 2027 internships that beat Christopher's bar: *better than a Wells Fargo software engineering internship in Charlotte, NC* — a better company, more relevant role, or better location. When in doubt, send. Also watch SimplifyJobs' list, the largest internship feed.

## Decisions (agreed in conversation)

- **Add `https://github.com/SimplifyJobs/Summer2027-Internships`** to watched repos. Same `listings.json` feed the vanshb03 watcher already reads (12.9 MB, 4,808 active listings, 2,189 tagged Summer 2027; 70 overlap with vanshb03 — `jobs.url` is UNIQUE, so overlaps are never emailed twice).
- **Summer rule is deterministic.** Repo listings must carry the target season tag. Company-board postings (no season data) are dropped only when the title clearly names another season; everything else goes to the judge.
- **Quality bar is an AI judge, fail-open.** One `completeJSON` call per batch of ≤40 new jobs returns send/skip + a one-line reason. Only clear "worse than the bar" is skipped. If the call fails, every job is sent unjudged.
- **The bar is editable** on `/preferences`.

## Pipeline

Both alert paths (`runAllCompanyScrapes`, `runWatchedRepoScrapes`) keep their scrape → diff → `upsertJob` gate unchanged, then:

```
new jobs
  → summerFilter(jobs, prefs.targetSeason)          deterministic, logs dropped titles
    → judgeJobs(kept, prefs.alertBar)               LLM, batches of ≤40, fail-open
      → keep verdict 'send'; log every 'skip' with its reason
        company boards: score + cap at maxPerEmail (unchanged)
        repos: no cap (unchanged)
          → sendJobEmail(jobs with reasons, source, skippedCount)
```

A job dropped by either stage is still recorded in `jobs` (by the existing upsert), so it is never re-evaluated or re-sent.

## Summer rule — `scraper/season.ts` (pure)

- `JobListing` gains `terms?: string[]`. `parseListingsJson` fills it from the feed's `terms`; board adapters leave it undefined.
- `passesSeason(job, target)`:
  - `target` empty/null → always true (rule off).
  - `job.terms` defined (Simplify) → true iff some term equals `target` case-insensitively (e.g. `"Summer 2027"`).
  - `job.season` defined (vanshb03: `"Summer"`, `"Spring/Summer"`, no year — the repo is the year) → true iff it names the target's season word.
  - `job.terms` undefined (board posting) → false iff the title names a different season and not the target's season word: matches `/\b(fall|autumn|winter|spring)\b/i` or `/\bco-?op\b/i` while not matching `/\bsummer\b/i`. Also false when the title names a different 4-digit year in 2020–2039 than the target's year and not the target's. Otherwise true.
- Preference `targetSeason: string | null`, default `"Summer 2027"`.

## Judge — `ai/judge-jobs.ts`

```ts
type Verdict = { url: string; send: boolean; reason: string };
judgeJobs(jobs: JobListing[], bar: string, deps?: { complete?: typeof completeJSON }): Promise<Map<string, Verdict>>
```

- Batches of ≤40 jobs, run sequentially (memory: one `claude` subprocess at a time), on `sonnet` with one retry. A 5-minute overall deadline sends any remaining batches unjudged; `filterForAlert` itself falls back to sending everything on any error.
- Prompt: candidate is a CS student at Brown seeking a Summer 2027 software/AI internship. Bar = `bar`. For each job (index, title, company, location, terms), decide `send` when the job is better than or comparable to the bar, or when unsure; `skip` only when clearly worse — e.g. a little-known company in a weaker location than the bar, a non-software role (hardware, mechanical, sales, operations), not an internship, or not for summer. Reason ≤ 12 words. Better-location examples: NYC, SF Bay Area, Seattle, Boston, remote; Charlotte itself is the baseline.
- Output schema: `{ verdicts: [{ index: int, send: boolean, reason: string }] }` validated with Zod; verdicts are mapped back by `index` (never by model-echoed URLs).
- Fail-open: if the call throws, or an index is missing from the reply, that job gets `{ send: true, reason: "" }`. Indexes out of range are ignored.
- Preference `alertBar: string`, default `"Better than a Wells Fargo software engineering internship in Charlotte, NC"`. An empty bar disables the judge (everything is sent).

## Email

- `sendJobEmail(jobs, source, opts?: { reasons?: Map<url, string>; skipped?: number })`. Each job row shows its reason (escaped) under the title when non-empty. When `skipped > 0` the footer reads "N more didn't clear your bar (see logs)". Subject unchanged. No email when nothing is left.

## Preferences UI

`/preferences` gains, in the filters section:
- **Season** (text, placeholder "Summer 2027", blank = any season)
- **Alert bar** (textarea, blank = send everything)

The existing title-only **Term filter** stays as is.

## Rollout

1. Merge → deploy.
2. On production `/preferences`: add the Simplify repo URL (the code default only applies to a fresh install), confirm Season = "Summer 2027" and the bar. Saving writes all fields.
3. First tick seeds Simplify silently; later ticks alert.

## Testing

Fast gate:
- `test-season.ts`: repo terms match / mismatch / case; rule off when target empty; board titles — "Software Engineer Intern" passes, "Fall 2026 Co-op" fails, "Spring Intern" fails, "Summer 2027 SWE Intern" passes, "SWE Intern 2026" fails, "Winter/Summer Intern" passes (names summer).
- `test-github-repo.ts`: `terms` parsed from the feed.
- `test-judge-jobs.ts` (injected `complete`): batching at 40; verdicts mapped by index; missing index → send; out-of-range index ignored; thrown error → all send; empty bar → no call, all send; prompt contains the bar.
- `test-job-email.ts` or extend an existing email test: reason line rendered and escaped; skipped footer.

Integration (manual): run the judge live on 10 real listings (mix of strong and weak) and eyeball verdicts.

## Out of scope

- Ranking within the email by judge score.
- A UI to review skipped jobs (logs only).
- Authenticating GitHub requests (403s are rare and already handled by keeping the prior snapshot).
