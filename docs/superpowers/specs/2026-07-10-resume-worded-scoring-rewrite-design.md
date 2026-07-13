# Replace hiring-agent rubric with Resume-Worded-style scoring

## Problem

`critic_score` (the critic loop's stopping signal, `packages/agent/src/ai/critic.ts`) currently blends an LLM holistic score (60%) — graded against `HIRING_AGENT_RUBRIC` (open source 35 / self-projects 30 / production 25 / tech skills 10, plus GSoC/founder/portfolio bonuses) — with deterministic format (25%) and JD keyword coverage (15%).

That rubric scores *what credentials the candidate has*, not *how well the tailoring pass wrote about them*. A rewrite can't manufacture open-source contributions or founder credit, so most of the score is uncontrollable per-tailoring-pass noise. We want the score to reflect only what a rewrite can actually move: bullet-writing quality (in the spirit of resumeworded.com's public scoring categories) plus the two things already correctly scoped — JD relevance and ATS parseability.

## Research basis

Confirmed against Resume Worded's actual UI (user-provided screenshot) and public help docs: **Weak roles, Quantify impact, Verb tenses, Dates, Spelling & consistency, Buzzwords, Readability, Contact details**. ~9 additional categories are paywalled/undocumented even to free users — no public source names them, so they are **not** implemented; inventing checks against an unverified spec was explicitly rejected.

Three parallel research passes (career-advice authorities, ATS technical-parsing sources, competitor resume scorers — Jobscan/Enhancv/Kickresume/Rezi) surfaced well-corroborated additions beyond the 8 confirmed categories: personal pronouns, filler/hedge words (distinct from clichés), a ≤2 same-verb-opener repetition cap, and non-standard bullet glyphs/emoji as an ATS risk. Folklore-tier claims (magic "Present" date keyword, filename effects on parsing) were identified and excluded.

Two of the 8 confirmed categories — **Dates** and **Contact details** — were dropped after establishing they read from `master.basics`/`master.experience` header fields (`format.ts:21-36`, `buildMeta()`), never touched by the tailoring pass. Scoring them per-tailored-resume would produce an identical result on every job, telling the critic loop nothing about tailoring quality. Out of scope for this pass (not deferred to a master-resume lint either — explicitly dropped).

Job-title realignment, required-vs-preferred JD-skill weighting, and peer-benchmarking were considered and explicitly deferred/rejected: title rewriting conflicts with the grounding constraint (titles must stay factual), skill-tier weighting is a real NLP task deserving its own design pass, and peer-benchmarking has no accessible comparison dataset here.

## Scope

Files touched:
- `packages/agent/src/ai/knowledge/best-practices.ts` — rubric constants, new word lists
- `packages/agent/src/ai/format.ts` — deterministic checks, `lintFormat()` scoring
- `packages/agent/src/ai/critic.ts` — `SYSTEM_PROMPT`, `ACTIONABLE_WARNINGS`

Unchanged: `grounding.ts` (fabrication gate), `keywordCoverage()` (JD relevance, still 15% of the blend), `renderMarkdown()` (ATS-safe layout), the top-level blend formula and its weights, the grounding hard-gate-to-25 behavior.

No test files exist under `packages/agent` today, so this is a clean rewrite with no test fallout — new pure functions in `format.ts` should get unit tests as part of implementation (they're offline-testable by design, per the existing file header comment).

## Design

### 1. `best-practices.ts` — rubric and word lists

`HIRING_AGENT_RUBRIC` → `RESUME_QUALITY_RUBRIC`:

```ts
export const RESUME_QUALITY_RUBRIC = {
  buckets: [
    { name: "Weak roles", weight: 60, rewards: "Each role/project tells a specific, credible, impactful story — not a duty list. Reward concrete scope, ownership, and outcome; penalize generic or interchangeable-sounding bullets." },
    { name: "Brevity & Style", weight: 40, rewards: "Concise, active voice, no buzzword/cliché/filler pile-up, easy to scan." },
  ],
  ignored: ["name", "gender", "college/university", "GPA", "city/location"],
} as const;
```

(`bonuses` and the open-source/self-projects/production/tech-skills buckets are deleted, not carried forward.)

New word lists, same shape/spirit as the existing `WEAK_PHRASES`:

```ts
/** Self-praise clichés — distinct from filler words below (these oversell, filler pads). */
export const BUZZWORDS_CLICHES = [
  "team player", "results-driven", "results-oriented", "synergy", "detail-oriented",
  "self-starter", "go-getter", "proven track record", "think outside the box",
  "hardworking", "dynamic", "passionate", "motivated individual", "excellent communication skills",
];

/** Structural padding — hedge words and throat-clearing, not self-praise. */
export const FILLER_WORDS = [
  "very", "really", "just", "basically", "actually", "in order to", "a lot of",
  "numerous", "various", "successfully", "efficiently", "effectively",
];

/** First-person pronouns — resume bullets use implied first person; zero-tolerance. */
export const PERSONAL_PRONOUNS = ["\\bi\\b", "\\bme\\b", "\\bmy\\b", "\\bmyself\\b"];

/** Non-standard glyphs an ATS text-extraction pass may drop or mis-split. Safe set: hyphen, standard bullet. */
export const ATS_UNSAFE_GLYPHS = /[★➤◆♦▶✦""''—](?!.*\d)|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

export const QUANTIFICATION_TARGET_RATIO = 0.75; // Resume Worded's own stated bar
export const VERB_REPEAT_CAP = 2; // a leading verb shouldn't open more than 2 bullets resume-wide
```

`bestPracticesPromptBlock()`'s "Target grader weights" line updates to render `RESUME_QUALITY_RUBRIC.buckets` instead of `HIRING_AGENT_RUBRIC.buckets`; the `ignored` list stays (still valid, orthogonal to which rubric).

### 2. `format.ts` — deterministic buckets

`lintFormat()`'s score changes from the flat `100 - errors*15 - warnings*3` to a weighted sum of named sub-scores, each still emitting `FormatIssue`s so `fixes` generation in `critic.ts` keeps working:

| Bucket | Weight | Computation |
|---|---|---|
| Quantify impact | 30 | `quantifiedBullets / totalBullets` (resume-wide, not per-section) vs. `QUANTIFICATION_TARGET_RATIO`; `score = min(100, (ratio / 0.75) * 100)` |
| Weak verbs & repetition | 15 | existing `WEAK_PHRASES` opener check (errors) + same-leading-verb->`VERB_REPEAT_CAP` check (warnings) |
| Verb tenses | 10 | within each role/project, flag bullets whose opening verb's tense (past vs. present-tense/-ing) disagrees with the majority tense used elsewhere in that same section — a same-section-only heuristic, not a global past/present rule, since current roles may legitimately read differently from past ones |
| Buzzwords, filler & pronouns | 15 | `BUZZWORDS_CLICHES` + `FILLER_WORDS` + `PERSONAL_PRONOUNS` scans, combined (word-choice hygiene) |
| Passive voice | 10 | regex heuristic: `/\b(was|were|is|are|been|being)\s+\w+ed\b/i` plus a short irregular-past-participle list (built, written, shown, given, ...) |
| Spelling | 10 | dictionary check (e.g. `nspell`/`typo-js` or a bundled word list) against tailored bullet text only — master-resume proper nouns (company/school names, tech terms already in `masterVocabulary()`) are excluded from the dictionary miss list to avoid false positives |
| Readability & ATS glyphs | 10 | existing bullet-length check + `ATS_UNSAFE_GLYPHS` scan + existing acronym-expansion + existing keyword-stuffing cap, combined |

Each bucket computes an independent 0–100 sub-score; `FormatReport.score` is the weighted sum. `project-no-link` is deleted (credential check, not writing quality). The one-page `length-budget` heuristic (`bulletCount > 18`) stays as-is — it's a rendering/format concern, not tied to the removed rubric.

### 3. `critic.ts`

`SYSTEM_PROMPT` renders `RESUME_QUALITY_RUBRIC.buckets` in place of `HIRING_AGENT_RUBRIC.buckets` — same template, new data source. Blend formula, grounding gate, and `evaluate()`'s signature are unchanged. `ACTIONABLE_WARNINGS` (the set of format-issue rule names that feed into `fixes`) expands to include the new rule names: `quantification-low`, `buzzword`, `filler-word`, `personal-pronoun`, `passive-voice`, `wrong-tense`, `verb-repetition`, `spelling`, `ats-glyph` — so the new checks actually influence what the tailorer sees on the next revise pass, matching how `no-metric`/`keyword-overuse` work today.

## Testing

No existing tests to preserve. New unit tests for the pure functions in `format.ts` (quantification ratio, verb repetition, tense-consistency, buzzword/filler/pronoun scan, passive-voice regex, glyph scan) since they're offline-testable with no I/O, per the file's existing design intent. Manual verification: run `generateBestResume(jd)` against a JD and the current `master-resume.ts`, confirm the new `finalScore` and `fixes` output are sane and the fabricated-open-source-style scoring no longer appears anywhere in critic output.

## Error handling

No new failure modes — all new checks are pure, synchronous, offline functions operating on already-validated `TailoredResume`/`MasterResume` Zod types. The spelling check's dictionary lookup needs a bundled word list (no network call) to stay consistent with the rest of `format.ts`'s no-I/O design; if no suitable dependency-free option exists, fall back to a small curated typo/misspelling list (similar shape to `WEAK_PHRASES`) rather than pulling in a network-dependent spellchecking API.
