# Resume-Worded-style Critic Scoring Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hiring-agent rubric (open source / self-projects / production / tech-skills) driving `critic.ts`'s LLM score and `format.ts`'s deterministic checks with a Resume-Worded-style rubric that scores only what a tailoring rewrite can actually influence: bullet-writing quality, JD relevance, and ATS parseability.

**Architecture:** `format.ts`'s `lintFormat()` becomes a weighted sum of 7 named buckets (quantification, weak verbs & repetition, verb tenses, buzzwords/filler/pronouns, passive voice, spelling, readability & ATS glyphs), each a small pure function. `critic.ts`'s LLM prompt is regraded against a 2-bucket rubric (Weak roles 60 / Brevity & Style 40) instead of the 4-bucket hiring-agent rubric. The 0.6/0.25/0.15 top-level blend, grounding hard-gate, and `keywordCoverage()` are untouched.

**Tech Stack:** TypeScript, Zod (existing `TailoredResume`/`MasterResume` schemas, unchanged), no new npm dependencies — new word/misspelling lists follow the existing `WEAK_PHRASES`/`ACRONYM_EXPANSIONS` curated-constant pattern in `best-practices.ts`. Tests use this repo's existing script-harness convention (`tsx src/ai/test-*.ts`, asserted via `console.log` + `process.exit` codes, wired to `npm run test:*` in `package.json`) — there is no jest/vitest in this package, so do not introduce one.

## Global Constraints

- No new npm dependencies (spec's error-handling section: prefer a curated list over a network-dependent spellchecker).
- All new `format.ts` checks must be pure functions — no I/O (existing file-header design intent, `format.ts:1-17`).
- Grounding hard-gate (cap score at 25 on fabrication, `critic.ts:128-129`) and the 0.6/0.25/0.15 blend formula (`critic.ts:127`) are NOT to be modified.
- `keywordCoverage()` (`format.ts:195-216`) and `renderMarkdown()` (`format.ts:39-101`) are NOT to be modified.
- Dates and Contact-details checks are explicitly out of scope (dropped in design — they read from `master.basics`/section headers, never touched by tailoring).
- Bucket weights: format.ts buckets must sum to 100 (quantification 30 / weak verbs & repetition 15 / verb tenses 10 / buzzwords-filler-pronouns 15 / passive voice 10 / spelling 10 / readability & ATS glyphs 10). LLM rubric buckets must sum to 100 (Weak roles 60 / Brevity & Style 40).

---

## Task 1: Rubric and word-list constants in `best-practices.ts`

**Files:**
- Modify: `packages/agent/src/ai/knowledge/best-practices.ts`

**Interfaces:**
- Consumes: nothing new (pure constants file).
- Produces (for Task 2 and Task 3 to import):
  - `RESUME_QUALITY_RUBRIC: { buckets: Array<{ name: string; weight: number; rewards: string }>; ignored: string[] }`
  - `BUZZWORDS_CLICHES: string[]`
  - `FILLER_WORDS: string[]`
  - `PERSONAL_PRONOUNS: string[]` (regex source strings, not compiled `RegExp`)
  - `ATS_UNSAFE_GLYPHS: RegExp`
  - `QUANTIFICATION_TARGET_RATIO: number`
  - `VERB_REPEAT_CAP: number`
  - `COMMON_MISSPELLINGS: Record<string, string>`

- [ ] **Step 1: Remove `HIRING_AGENT_RUBRIC` and add the new constants**

Delete the existing `HIRING_AGENT_RUBRIC` export (`best-practices.ts:74-88`, the object with `buckets`/`bonuses`/`penalties`/`ignored`) and replace it in-place with:

```ts
/**
 * Resume-Worded-style rubric. The critic loop scores drafts against this;
 * the tailorer optimizes for the levers it can move truthfully. Unlike the
 * hiring-agent rubric this replaces, every bucket here is something a
 * rewrite can actually change — it does not score which credentials the
 * candidate happens to have.
 */
export const RESUME_QUALITY_RUBRIC = {
  buckets: [
    { name: "Weak roles", weight: 60, rewards: "Each role/project tells a specific, credible, impactful story — not a duty list. Reward concrete scope, ownership, and outcome; penalize generic or interchangeable-sounding bullets." },
    { name: "Brevity & Style", weight: 40, rewards: "Concise, active voice, no buzzword/cliché/filler pile-up, easy to scan." },
  ],
  ignored: ["name", "gender", "college/university", "GPA", "city/location"],
} as const;

/** Self-praise clichés — distinct from FILLER_WORDS below (these oversell, filler pads). */
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

/** First-person pronouns — resume bullets use implied first person; zero-tolerance. Regex source strings (compiled per-use with the `i` flag). */
export const PERSONAL_PRONOUNS = ["\\bi\\b", "\\bme\\b", "\\bmy\\b", "\\bmyself\\b"];

/** Non-standard glyphs an ATS text-extraction pass may drop, mis-split, or choke on. Safe set: hyphen, standard "•" bullet (already what renderMarkdown emits). */
export const ATS_UNSAFE_GLYPHS = /[★➤◆♦▶✦""'']|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/** Resume Worded's own stated bar: best-performing resumes quantify 75%+ of bullets. */
export const QUANTIFICATION_TARGET_RATIO = 0.75;

/** A leading verb shouldn't open more than this many bullets resume-wide (LinkedIn Career Advice consensus). */
export const VERB_REPEAT_CAP = 2;

/** Common typos, curated (no spellchecking dependency) — same shape/spirit as ACRONYM_EXPANSIONS above. */
export const COMMON_MISSPELLINGS: Record<string, string> = {
  "recieve": "receive",
  "seperate": "separate",
  "definately": "definitely",
  "occured": "occurred",
  "managment": "management",
  "enviroment": "environment",
  "acheive": "achieve",
  "acheived": "achieved",
  "buisness": "business",
  "collaberate": "collaborate",
  "sucessful": "successful",
  "publically": "publicly",
  "thier": "their",
  "recomend": "recommend",
  "developement": "development",
  "excelent": "excellent",
  "committment": "commitment",
  "occassion": "occasion",
};
```

- [ ] **Step 2: Update `bestPracticesPromptBlock()` to reference the new rubric**

In `bestPracticesPromptBlock()` (`best-practices.ts:101-117`), find this line:

```ts
    `Target grader weights: ${HIRING_AGENT_RUBRIC.buckets.map((b) => `${b.name} ${b.weight}`).join(", ")}. It ignores ${HIRING_AGENT_RUBRIC.ignored.join("/")}.`,
```

Replace with:

```ts
    `Target grader weights: ${RESUME_QUALITY_RUBRIC.buckets.map((b) => `${b.name} ${b.weight}`).join(", ")}. It ignores ${RESUME_QUALITY_RUBRIC.ignored.join("/")}.`,
```

- [ ] **Step 3: Verify the file compiles**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors mentioning `best-practices.ts`. (Other pre-existing errors elsewhere in the package, if any, are not this task's concern — only confirm nothing new points at this file.)

Note: this will currently show errors in `format.ts` and `critic.ts` because they still reference the now-deleted `HIRING_AGENT_RUBRIC` — that's expected and resolved in Tasks 2 and 3. Confirm specifically that `best-practices.ts` itself has no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/ai/knowledge/best-practices.ts
git commit -m "$(cat <<'EOF'
feat: replace hiring-agent rubric with resume-worded-style rubric constants

Adds RESUME_QUALITY_RUBRIC (Weak roles 60 / Brevity & Style 40) plus
word lists for buzzwords, filler words, personal pronouns, ATS-unsafe
glyphs, and common misspellings. HIRING_AGENT_RUBRIC and its
credential-based buckets/bonuses are removed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Rewrite `lintFormat()` in `format.ts` with weighted buckets

**Files:**
- Modify: `packages/agent/src/ai/format.ts`
- Modify (test harness): `packages/agent/src/ai/test-format.ts`

**Interfaces:**
- Consumes: `RESUME_QUALITY_RUBRIC` unused here (Task 3 only); `BUZZWORDS_CLICHES`, `FILLER_WORDS`, `PERSONAL_PRONOUNS`, `ATS_UNSAFE_GLYPHS`, `QUANTIFICATION_TARGET_RATIO`, `VERB_REPEAT_CAP`, `COMMON_MISSPELLINGS` from `./knowledge/best-practices` (Task 1); existing `WEAK_PHRASES`, `ACRONYM_EXPANSIONS`, `BULLET_GUIDELINES`, `KEYWORD_REPEAT_CAP` (unchanged); `MasterResume`, `TailoredResume` from `./types` (unchanged).
- Produces: `lintFormat(master: MasterResume, tailored: TailoredResume): FormatReport` — same public signature as before, `FormatReport = { score: number; issues: FormatIssue[] }`, `FormatIssue = { level: "error" | "warning"; rule: string; detail: string }` — unchanged shape, but `rule` values change (see below). `renderMarkdown()`, `masterVocabulary()`, `keywordCoverage()` are NOT touched by this task.
- New `FormatIssue.rule` values this task introduces: `quantification-low`, `verb-repetition`, `wrong-tense`, `buzzword`, `filler-word`, `personal-pronoun`, `passive-voice`, `spelling`, `ats-glyph`. Retained from before: `weak-opener`, `bullet-too-long`, `bullet-long`, `acronym-unexpanded`, `keyword-overuse`, `length-budget`. Removed: `no-metric`, `project-no-link`.

- [ ] **Step 1: Add failing assertions to `test-format.ts` for the new checks**

Open `packages/agent/src/ai/test-format.ts`. After the existing `weak` fixture (ends at line 45) and before the `// --- Format safety of the rendered document ---` comment (line 47), insert:

```ts
// --- New deterministic checks (Resume-Worded-style rubric) ---

const quantificationHeavy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Automated infrastructure provisioning on AWS EKS, saving 5 hrs per week" },
    { sourceId: "exp-scout-2", text: "Architected an AI developer platform, cutting deployment time 75%" },
  ] }],
};
const quantificationLight: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Automated infrastructure provisioning on AWS EKS" },
    { sourceId: "exp-scout-2", text: "Architected an AI developer platform for internal use" },
  ] }],
};

const verbRepetitionMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Built an internal dashboard for infrastructure metrics" },
    { sourceId: "exp-scout-2", text: "Built a CI/CD pipeline for the platform team" },
    { sourceId: "exp-scout-3", text: "Built a Slack bot for on-call alerting" },
  ] }],
};

const tenseMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Built an internal dashboard for infrastructure metrics" },
    { sourceId: "exp-scout-2", text: "Automated the CI/CD pipeline for faster releases" },
    { sourceId: "exp-scout-3", text: "Leading the migration to a new cloud provider" },
  ] }],
};

const buzzwordMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Recognized as a team player with a proven track record of results" },
  ] }],
};

const fillerMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Successfully and efficiently managed a very large number of tickets" },
  ] }],
};

const pronounMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "I led the migration of my team's services to Kubernetes" },
  ] }],
};

const passiveMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "The infrastructure migration was completed by the platform team" },
  ] }],
};

const spellingMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Helped the team recieve feedback and seperate concerns cleanly" },
  ] }],
};

const glyphMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "★ Migrated services to Kubernetes for faster releases" },
  ] }],
};

const lintQuantHeavy = lintFormat(MASTER_RESUME, quantificationHeavy);
const lintQuantLight = lintFormat(MASTER_RESUME, quantificationLight);
const lintVerbRep = lintFormat(MASTER_RESUME, verbRepetitionMessy);
const lintTense = lintFormat(MASTER_RESUME, tenseMessy);
const lintBuzzword = lintFormat(MASTER_RESUME, buzzwordMessy);
const lintFiller = lintFormat(MASTER_RESUME, fillerMessy);
const lintPronoun = lintFormat(MASTER_RESUME, pronounMessy);
const lintPassive = lintFormat(MASTER_RESUME, passiveMessy);
const lintSpelling = lintFormat(MASTER_RESUME, spellingMessy);
const lintGlyph = lintFormat(MASTER_RESUME, glyphMessy);

const newChecksPass =
  lintQuantHeavy.score > lintQuantLight.score &&
  lintQuantLight.issues.some((i) => i.rule === "quantification-low") &&
  lintVerbRep.issues.some((i) => i.rule === "verb-repetition") &&
  lintTense.issues.some((i) => i.rule === "wrong-tense") &&
  lintBuzzword.issues.some((i) => i.rule === "buzzword") &&
  lintFiller.issues.some((i) => i.rule === "filler-word") &&
  lintPronoun.issues.some((i) => i.rule === "personal-pronoun") &&
  lintPassive.issues.some((i) => i.rule === "passive-voice") &&
  lintSpelling.issues.some((i) => i.rule === "spelling") &&
  lintGlyph.issues.some((i) => i.rule === "ats-glyph");

console.log(
  `NEW CHECKS quant(${lintQuantHeavy.score}v${lintQuantLight.score}) verbRep:${lintVerbRep.issues.some((i) => i.rule === "verb-repetition")} tense:${lintTense.issues.some((i) => i.rule === "wrong-tense")} buzzword:${lintBuzzword.issues.some((i) => i.rule === "buzzword")} filler:${lintFiller.issues.some((i) => i.rule === "filler-word")} pronoun:${lintPronoun.issues.some((i) => i.rule === "personal-pronoun")} passive:${lintPassive.issues.some((i) => i.rule === "passive-voice")} spelling:${lintSpelling.issues.some((i) => i.rule === "spelling")} glyph:${lintGlyph.issues.some((i) => i.rule === "ats-glyph")}`
);
```

Then find the final `pass` assertion near the bottom of the file (line 71-79) and add `newChecksPass` to the conjunction:

```ts
const pass =
  hasStandardHeadings &&
  noTableRows &&
  singleColumn &&
  lintStrong.score > lintWeak.score &&
  weakHasWeakOpenerError &&
  covStrong.ratio > covWeak.ratio &&
  sigStrong.grounding.ok &&
  sigWeak.grounding.ok &&
  newChecksPass;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent && npx tsx src/ai/test-format.ts`
Expected: FAIL — either a TypeScript/runtime error (old `lintFormat` doesn't yet know about `quantification-low`/`verb-repetition`/etc. rules) or `newChecksPass` evaluates to `false` and the script prints `✗ test FAILED` with exit code 1.

- [ ] **Step 3: Replace `lintFormat()` and its supporting code in `format.ts`**

In `format.ts`, update the import block (currently lines 1-7) to add the new constants:

```ts
import { MasterResume, TailoredResume } from "./types";
import {
  WEAK_PHRASES,
  ACRONYM_EXPANSIONS,
  BULLET_GUIDELINES,
  KEYWORD_REPEAT_CAP,
  BUZZWORDS_CLICHES,
  FILLER_WORDS,
  PERSONAL_PRONOUNS,
  ATS_UNSAFE_GLYPHS,
  QUANTIFICATION_TARGET_RATIO,
  VERB_REPEAT_CAP,
  COMMON_MISSPELLINGS,
} from "./knowledge/best-practices";
```

Replace the entire block from `export type FormatIssue` through the end of `lintFormat()` (currently `format.ts:103-170`) with:

```ts
export type FormatIssue = { level: "error" | "warning"; rule: string; detail: string };
export type FormatReport = { score: number; issues: FormatIssue[] };

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** First word of a bullet, lowercased — used as the "leading verb" for repetition/tense checks. */
function leadingVerb(text: string): string {
  const match = text.trim().match(/^[A-Za-z]+/);
  return match ? match[0].toLowerCase() : "";
}

const IRREGULAR_PAST_VERBS = new Set([
  "built", "led", "sold", "shown", "given", "driven", "spent", "sent", "kept",
  "met", "held", "ran", "grew", "wrote", "spoke", "chose", "taught", "brought",
  "caught", "sought", "won", "cut", "set", "began",
]);

function isPastTense(verb: string): boolean {
  return verb.endsWith("ed") || IRREGULAR_PAST_VERBS.has(verb);
}

type TailoredSections = TailoredResume["experience"];

function allBullets(sections: TailoredSections) {
  return sections.flatMap((s) => s.bullets);
}

/** Bucket: quantify impact — 30% weight. Resume-wide bullet quantification ratio vs. a 75% target. */
function quantificationScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  const bullets = allBullets(sections);
  const quantified = bullets.filter((b) => /\d/.test(b.text));
  const ratio = bullets.length ? quantified.length / bullets.length : 1;
  if (ratio < QUANTIFICATION_TARGET_RATIO) {
    issues.push({
      level: "warning",
      rule: "quantification-low",
      detail: `${quantified.length} of ${bullets.length} bullets quantified (target ${Math.round(QUANTIFICATION_TARGET_RATIO * 100)}%) — add a number where one truthfully exists`,
    });
  }
  const score = Math.min(100, Math.round((ratio / QUANTIFICATION_TARGET_RATIO) * 100));
  return { score, issues };
}

/** Bucket: weak verbs & repetition — 15% weight. Duty-language openers + same-verb-opens->cap. */
function weakVerbsAndRepetitionScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  const bullets = allBullets(sections);
  let weakCount = 0;
  for (const { text } of bullets) {
    const lower = text.toLowerCase();
    const weak = WEAK_PHRASES.find((p) => lower.startsWith(p));
    if (weak) {
      weakCount++;
      issues.push({ level: "error", rule: "weak-opener", detail: `bullet starts with "${weak}": "${text}"` });
    }
  }
  const verbCounts = new Map<string, number>();
  for (const { text } of bullets) {
    const verb = leadingVerb(text);
    if (verb) verbCounts.set(verb, (verbCounts.get(verb) ?? 0) + 1);
  }
  let repeatedVerbs = 0;
  for (const [verb, count] of verbCounts) {
    if (count > VERB_REPEAT_CAP) {
      repeatedVerbs++;
      issues.push({
        level: "warning",
        rule: "verb-repetition",
        detail: `"${verb}" opens ${count} bullets (cap ${VERB_REPEAT_CAP}) — vary the action verb`,
      });
    }
  }
  const score = Math.max(0, 100 - weakCount * 25 - repeatedVerbs * 20);
  return { score, issues };
}

/** Bucket: verb tenses — 10% weight. Flags bullets whose leading-verb tense disagrees with the majority within the same section. */
function verbTenseScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  let mismatches = 0;
  for (const s of sections) {
    const verbs = s.bullets.map((b) => leadingVerb(b.text)).filter(Boolean);
    if (verbs.length < 2) continue;
    const pastCount = verbs.filter(isPastTense).length;
    const majorityPast = pastCount >= verbs.length / 2;
    for (const b of s.bullets) {
      const verb = leadingVerb(b.text);
      if (!verb) continue;
      if (isPastTense(verb) !== majorityPast) {
        mismatches++;
        issues.push({
          level: "warning",
          rule: "wrong-tense",
          detail: `section "${s.id}" bullet opens with "${verb}", inconsistent with the section's ${majorityPast ? "past" : "non-past"}-tense majority: "${b.text}"`,
        });
      }
    }
  }
  const score = Math.max(0, 100 - mismatches * 25);
  return { score, issues };
}

/** Bucket: buzzwords, filler & pronouns — 15% weight. Three related word-choice-hygiene word-lists, one bucket. */
function wordChoiceScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  const allText = allBullets(sections).map((b) => b.text).join("\n").toLowerCase();

  let buzzwordHits = 0;
  for (const phrase of BUZZWORDS_CLICHES) {
    if (allText.includes(phrase)) {
      buzzwordHits++;
      issues.push({ level: "warning", rule: "buzzword", detail: `contains cliché phrase "${phrase}"` });
    }
  }

  let fillerHits = 0;
  for (const word of FILLER_WORDS) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(allText)) {
      fillerHits++;
      issues.push({ level: "warning", rule: "filler-word", detail: `contains filler word/phrase "${word}"` });
    }
  }

  let pronounHits = 0;
  for (const pattern of PERSONAL_PRONOUNS) {
    if (new RegExp(pattern, "i").test(allText)) {
      pronounHits++;
      issues.push({ level: "error", rule: "personal-pronoun", detail: `contains a first-person pronoun (pattern /${pattern}/)` });
    }
  }

  const score = Math.max(0, 100 - buzzwordHits * 10 - fillerHits * 5 - pronounHits * 15);
  return { score, issues };
}

/** Bucket: passive voice — 10% weight. Regex heuristic over be-verb + past participle. */
const PASSIVE_VOICE_RE = /\b(was|were|is|are|been|being)\s+\w+ed\b/i;
const IRREGULAR_PAST_PARTICIPLES = ["built", "written", "shown", "given", "driven", "spoken", "chosen", "taught", "brought", "sold", "held", "run", "grown"];

function passiveVoiceScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  let hits = 0;
  for (const { text } of allBullets(sections)) {
    const regexHit = PASSIVE_VOICE_RE.test(text);
    const irregularHit = IRREGULAR_PAST_PARTICIPLES.some((p) => new RegExp(`\\b(was|were|is|are|been|being)\\s+${p}\\b`, "i").test(text));
    if (regexHit || irregularHit) {
      hits++;
      issues.push({ level: "warning", rule: "passive-voice", detail: `passive construction: "${text}"` });
    }
  }
  const score = Math.max(0, 100 - hits * 20);
  return { score, issues };
}

/** Bucket: spelling — 10% weight. Curated misspelling list, no spellchecking dependency. */
function spellingScore(sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  const allText = allBullets(sections).map((b) => b.text).join(" ").toLowerCase();
  let hits = 0;
  for (const [misspelling, correction] of Object.entries(COMMON_MISSPELLINGS)) {
    if (new RegExp(`\\b${misspelling}\\b`, "i").test(allText)) {
      hits++;
      issues.push({ level: "error", rule: "spelling", detail: `"${misspelling}" should be "${correction}"` });
    }
  }
  const score = Math.max(0, 100 - hits * 25);
  return { score, issues };
}

/** Bucket: readability & ATS glyphs — 10% weight. Bullet length + non-standard glyphs + acronym expansion + keyword-stuffing cap + one-page budget. */
function readabilityAtsScore(master: MasterResume, sections: TailoredSections): { score: number; issues: FormatIssue[] } {
  const issues: FormatIssue[] = [];
  let severe = 0;
  let minor = 0;
  const bullets = allBullets(sections);
  const allText = bullets.map((b) => b.text).join("\n");

  for (const { text } of bullets) {
    const words = wordCount(text);
    if (words > 45) {
      severe++;
      issues.push({ level: "error", rule: "bullet-too-long", detail: `${words} words (>2 lines): "${text}"` });
    } else if (words > BULLET_GUIDELINES.idealWordRange[1] + 14) {
      minor++;
      issues.push({ level: "warning", rule: "bullet-long", detail: `${words} words: "${text}"` });
    }
    if (ATS_UNSAFE_GLYPHS.test(text)) {
      minor++;
      issues.push({ level: "warning", rule: "ats-glyph", detail: `non-standard glyph/emoji in: "${text}"` });
    }
  }

  for (const [acr, expansion] of Object.entries(ACRONYM_EXPANSIONS)) {
    const re = new RegExp(`\\b${acr.replace("/", "\\/")}\\b`, "i");
    if (re.test(allText) && !allText.toLowerCase().includes(expansion.toLowerCase())) {
      minor++;
      issues.push({ level: "warning", rule: "acronym-unexpanded", detail: `"${acr}" used without spelling out "${expansion}" once` });
    }
  }

  const haystack = allText.toLowerCase();
  for (const term of masterVocabulary(master)) {
    if (term.length < 3) continue;
    const count = haystack.split(term).length - 1;
    if (count > KEYWORD_REPEAT_CAP) {
      minor++;
      issues.push({ level: "warning", rule: "keyword-overuse", detail: `"${term}" repeated ${count}× (cap ${KEYWORD_REPEAT_CAP}) — reads as stuffing, not signal` });
    }
  }

  if (bullets.length > 18) {
    minor++;
    issues.push({ level: "warning", rule: "length-budget", detail: `${bullets.length} bullets — likely exceeds one page` });
  }

  const score = Math.max(0, 100 - severe * 20 - minor * 8);
  return { score, issues };
}

const BUCKET_WEIGHTS = {
  quantification: 0.30,
  weakVerbs: 0.15,
  tenses: 0.10,
  wordChoice: 0.15,
  passive: 0.10,
  spelling: 0.10,
  readability: 0.10,
} as const;

/** Deterministic ATS/format checks over the tailored bullets — weighted bucket sum. */
export function lintFormat(master: MasterResume, tailored: TailoredResume): FormatReport {
  const sections = [...tailored.experience, ...tailored.projects];

  const quantification = quantificationScore(sections);
  const weakVerbs = weakVerbsAndRepetitionScore(sections);
  const tenses = verbTenseScore(sections);
  const wordChoice = wordChoiceScore(sections);
  const passive = passiveVoiceScore(sections);
  const spelling = spellingScore(sections);
  const readability = readabilityAtsScore(master, sections);

  const score = Math.round(
    quantification.score * BUCKET_WEIGHTS.quantification +
    weakVerbs.score * BUCKET_WEIGHTS.weakVerbs +
    tenses.score * BUCKET_WEIGHTS.tenses +
    wordChoice.score * BUCKET_WEIGHTS.wordChoice +
    passive.score * BUCKET_WEIGHTS.passive +
    spelling.score * BUCKET_WEIGHTS.spelling +
    readability.score * BUCKET_WEIGHTS.readability
  );

  const issues = [
    ...quantification.issues,
    ...weakVerbs.issues,
    ...tenses.issues,
    ...wordChoice.issues,
    ...passive.issues,
    ...spelling.issues,
    ...readability.issues,
  ];

  return { score, issues };
}
```

Note what's deleted from the old version: the `buildMeta`-based `project-no-link` check (no longer called from `lintFormat` — `buildMeta`/`SectionMeta` stay in the file because `renderMarkdown` still uses them) and the old flat `100 - errors*15 - warnings*3` formula.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agent && npx tsx src/ai/test-format.ts`
Expected: PASS — final line `✓ format + signal-discrimination test PASSED`, exit code 0. All ten new `NEW CHECKS` booleans in the printed line should read `true`, and `quant(` should show the heavy score greater than the light score.

If any boolean is `false`, inspect that fixture's bullet text against the corresponding bucket function above — the most common cause is a fixture phrase not matching a regex literally (e.g. word-boundary issues with multi-word phrases in `BUZZWORDS_CLICHES`/`FILLER_WORDS`).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/ai/format.ts packages/agent/src/ai/test-format.ts
git commit -m "$(cat <<'EOF'
feat: rewrite lintFormat() as weighted resume-worded-style buckets

Replaces the flat errors/warnings penalty formula with 7 weighted
buckets (quantify impact, weak verbs & repetition, verb tenses,
buzzwords/filler/pronouns, passive voice, spelling, readability & ATS
glyphs). Drops the project-no-link credential check.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Update `critic.ts` to use the new rubric

**Files:**
- Modify: `packages/agent/src/ai/critic.ts`

**Interfaces:**
- Consumes: `RESUME_QUALITY_RUBRIC` from `./knowledge/best-practices` (Task 1); `lintFormat` from `./format` (Task 2, signature unchanged); existing `Signals`, `CriticResult`, `Critique`, `evaluate()` types/signatures are UNCHANGED — only the prompt text and `ACTIONABLE_WARNINGS` contents change.
- Produces: same public API as before (`evaluate()`, `gatherSignals()`, `CritiqueSchema`, `Critique`, `Signals`, `CriticResult`) — no signature changes, so nothing downstream of `critic.ts` needs updating.

- [ ] **Step 1: Update the import and `SYSTEM_PROMPT`**

Change the import at the top of `critic.ts` (currently `import { HIRING_AGENT_RUBRIC } from "./knowledge/best-practices";`) to:

```ts
import { RESUME_QUALITY_RUBRIC } from "./knowledge/best-practices";
```

In `SYSTEM_PROMPT` (`critic.ts:65-82`), replace every reference to `HIRING_AGENT_RUBRIC` with `RESUME_QUALITY_RUBRIC`:

```ts
const SYSTEM_PROMPT = `You are a rigorous technical recruiter scoring a software-engineering résumé
against a specific hiring rubric. Be critical and concrete — reward evidence, penalize fluff.

RUBRIC (max points per bucket):
${RESUME_QUALITY_RUBRIC.buckets.map((b) => `- ${b.name} (${b.weight}): ${b.rewards}`).join("\n")}
Explicitly IGNORE (do not let these affect score): ${RESUME_QUALITY_RUBRIC.ignored.join(", ")}.

You are given DETERMINISTIC signals already computed (grounding, formatting, keyword
coverage). Treat them as ground truth; do not contradict them.

Return ONLY JSON:
{
  "buckets": [{ "name": string, "score": number, "max": number, "reasons": string[] }],
  "jdMatch": { "score": number, "max": 100, "missingKeywords": string[] },
  "overall": number,            // 0-100 holistic
  "topFixes": string[]          // concrete, ordered, e.g. "Add a live link to Travel Planner"
}`;
```

Note: the `Penalties: ${HIRING_AGENT_RUBRIC.penalties.join(" ")}` line is deleted entirely — `RESUME_QUALITY_RUBRIC` has no `penalties` field (those were hiring-agent-specific: missing project link, tutorial-grade project, generic project name — none of which apply to a writing-quality rubric).

- [ ] **Step 2: Update `ACTIONABLE_WARNINGS`**

In `evaluate()` (`critic.ts:116`), replace:

```ts
  const ACTIONABLE_WARNINGS = new Set(["no-metric", "keyword-overuse"]);
```

with:

```ts
  const ACTIONABLE_WARNINGS = new Set([
    "quantification-low",
    "keyword-overuse",
    "verb-repetition",
    "wrong-tense",
    "buzzword",
    "filler-word",
    "passive-voice",
    "ats-glyph",
  ]);
```

(`no-metric` no longer exists as a rule — Task 2 replaced it with `quantification-low`. `weak-opener`, `spelling`, and `personal-pronoun` are `level: "error"` and already always included via the `i.level === "error"` branch of the filter below them, so they don't need to be in this set.)

- [ ] **Step 3: Verify no stale references remain**

Run: `cd packages/agent && grep -n "HIRING_AGENT_RUBRIC" src/ai/critic.ts`
Expected: no output (empty match).

Run: `cd packages/agent && grep -n "RESUME_QUALITY_RUBRIC" src/ai/critic.ts`
Expected: at least 3 matches (the import line and the two template-literal references in `SYSTEM_PROMPT`).

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors referencing `critic.ts`, `format.ts`, or `best-practices.ts`. (This also retroactively confirms Task 1 and Task 2 compile cleanly together with this task's changes — if Task 1's Step 3 showed errors in `format.ts`/`critic.ts` at the time, they should be gone now.)

- [ ] **Step 4: Run the existing critic test harness**

Run: `cd packages/agent && npm run test:critic`
Expected: if `OPENAI_API_KEY` is unset, prints `⏭  test-critic skipped — no OPENAI_API_KEY. (Deterministic signals proven in test-format.ts.)` and exits 0 — this is existing, expected behavior, not a failure. If the key is set, expected output is `✓ critic discriminates and gates fabrication — PASSED` (the `strong`/`weak`/`fabricated` fixtures in `test-critic.ts` are unchanged by this plan and should still discriminate and gate correctly, since grounding and the blend formula are untouched).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/ai/critic.ts
git commit -m "$(cat <<'EOF'
feat: score critic against resume-worded-style rubric instead of hiring-agent

SYSTEM_PROMPT now grades Weak roles (60) / Brevity & Style (40) instead
of open-source/self-projects/production/tech-skills. ACTIONABLE_WARNINGS
expanded to feed the new format.ts rule names back into the tailorer's
next revise pass.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Full-suite verification

**Files:** none modified — verification only.

**Interfaces:** N/A.

- [ ] **Step 1: Run all three existing test harnesses in sequence**

```bash
cd packages/agent
npx tsx src/ai/test-grounding.ts
npx tsx src/ai/test-format.ts
npm run test:critic
```

Expected: `test-grounding.ts` passes (untouched by this plan — confirms Task 2's `format.ts` changes didn't accidentally break the grounding import chain). `test-format.ts` passes as confirmed in Task 2. `test:critic` either skips (no API key) or passes.

- [ ] **Step 2: Run a full tailoring pass against the real master resume, if `OPENAI_API_KEY` is set**

Run: `cd packages/agent && npm run tailor`

This exercises `generateBestResume(jd)` end-to-end (`chain.ts`, unmodified by this plan) against the new critic. Confirm in the output: (a) `finalScore` is present and in `[0, 100]`, (b) none of the printed critique buckets/fixes reference open source, self-projects, production experience, GSoC, or portfolio links — only role-narrative and writing-quality language should appear, (c) `fixes` includes at least one entry sourced from the new deterministic rules if the current master-resume-derived draft has any (e.g. a `quantification-low` or `passive-voice` fix), confirming `ACTIONABLE_WARNINGS` wiring from Task 3 actually reaches the tailorer.

If `OPENAI_API_KEY` is unset, skip this step — the deterministic guts are already proven by Step 1.

- [ ] **Step 3: Confirm no other file in the repo still references the removed rubric**

Run: `cd /Users/christopherzhang/Projects/AI-Job-Agent && grep -rn "HIRING_AGENT_RUBRIC" packages/ --include="*.ts"`
Expected: no output. If anything matches (e.g. a file outside the three touched in this plan that imports the old export), update that reference before proceeding — this plan's scope assumed `best-practices.ts`/`format.ts`/`critic.ts` are the only consumers, based on the grep run during design; if that's changed since, treat any hit as a gap to close, not something to ignore.

This step has no commit of its own — it's a verification gate. If Step 3 finds no stale references and Steps 1-2 pass, the rewrite is complete; no further commit needed since Tasks 1-3 already committed all code changes.
