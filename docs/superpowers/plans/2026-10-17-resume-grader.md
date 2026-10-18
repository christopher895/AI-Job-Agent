# Resume Grader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/grader` section that scores a resume out of 100 across five categories via five parallel LLM "specialists", lists every finding with a paste-ready rewrite, and can push findings into the existing feedback-round flow for tailored resumes.

**Architecture:** Same shape as the async tailoring pipeline: `POST /api/grades` inserts a `pending` `resume_grades` row and returns 202; `runGradePipeline` runs five `completeJSON` calls in-process (max 2 concurrent via a shared limiter), writing each specialist's result as it lands; a pure `assembleReport` turns the five results into the final report. The web app polls `GET /api/grades/:id`.

**Tech Stack:** Express + pg + Zod + `completeJSON` (headless `claude -p`) on the agent; Next.js 16 App Router + Tailwind (paper/ink tokens) on the web; `tsx` scripts for tests.

**Spec:** `docs/superpowers/specs/2026-10-17-resume-grader-design.md`

## Global Constraints

- Rubric maxima are fixed: ATS & structure **25** (ats), Content quality **35** (content), Writing quality **10** (recruiter), Job optimization **20** (domain), Application readiness **10** (storyteller). Sum = 100.
- Target roles: `swe | frontend | backend | fullstack | mobile | devops | data | ml`. Levels: `intern | entry | mid | senior | staff`.
- At most **2** concurrent grader LLM calls across all grades (module-level limiter). Tailoring is not limited.
- Resume text and JD text are each capped at **30,000** chars (400 above that); empty resume text is a 400.
- Run key for cancellation is `` `grade:${id}` `` — never the bare id (that namespace belongs to `tailored_resumes`).
- Any specialist failure fails the whole grade; no partial reports.
- Rewrites must never invent facts: a rewrite with a number absent from the resume text, or with a `[...]` placeholder, is labeled `needs-your-input`.
- The master resume's `aboutMe` notes are never sent to the grader.
- Feedback text sent to `POST /api/resume/:id/feedback` must be ≤ `MAX_PASTE_CHARS` (12,000).
- Light main-content backgrounds (paper/ink design system). No dark page backgrounds.
- Every fast test is a `tsx` script that exits non-zero on failure and is chained into the workspace's `npm test`.
- Do not commit or push unless the user asks; when they do, it goes on branch `feat/resume-grader` via a PR, never `main`.

## Review Focus

1. **A specialist fails while others are queued or running** — the grade must land `failed` (not `cancelled`, not stuck `pending`), siblings must be aborted, and the error must name the failing reviewer. Pinned in Task 6 (`test-grade-pipeline.ts`, with injected runners).
2. **User cancels while specialists are queued behind another grade** — queued specialists must reject immediately (not wait for a slot) and the pipeline must not overwrite `cancelled` with `failed`. Pinned in Task 3 (limiter abort-while-queued) and Task 6 (cancel case).
3. **Malformed ids in the URL** (`/api/grades/not-a-uuid`, `resumeId=abc`) — Postgres throws on an invalid uuid; the route must answer 404/400, not 500. Pinned in Task 6 (`isUuid` cases in `test-grade-request.ts`).
4. **Grading a tailored resume whose row was deleted later** — `resume_id` becomes null; Re-run must fall back to the stored snapshot instead of 404ing. Pinned in Task 7 (`rerunBody` test).
5. **"Fix these" with many findings** — the formatted feedback can exceed the feedback route's 12,000-char limit; it must truncate to whole findings and tell the user how many fit. Pinned in Task 7 (`findingsToFeedback` cap test).

---

## File Map

**Agent (`packages/agent/src/`)**
- Create `ai/grade/rubric.ts` — categories, role/level tables, Zod schemas, report types.
- Create `ai/grade/specialists.ts` — system prompts, `buildUserMessage`, `runSpecialist`.
- Create `ai/grade/assemble.ts` — pure `labelRewrite` + `assembleReport`.
- Create `ai/grade/limit.ts` — `createLimiter` + shared `graderLimit`.
- Create `ai/grade/resume-text.ts` — `masterToText`, `extractPdfText`, `MAX_GRADE_TEXT_CHARS`.
- Create `ai/grade/request.ts` — pure request validation (`parseGradeRequest`, `isUuid`).
- Create `ai/grade/pipeline.ts` — `runGradePipeline(id, deps?)`.
- Create tests: `ai/grade/test-grade-prompts.ts`, `test-grade-assemble.ts`, `test-grade-limit.ts`, `test-resume-text.ts`, `test-grade-request.ts`, `test-grade-pipeline.ts` (fast, injected deps), `test-grade-live.ts` (integration).
- Create `api/routes/grades.ts`; modify `api/index.ts` (mount), `api/routes/master-resume.ts` (reuse `extractPdfText`).
- Modify `db/schema.ts` (table), `db/queries.ts` (access functions).
- Modify `packages/agent/package.json` (test scripts).

**Web (`packages/web/`)**
- Modify `lib/api.ts` — grade types + wrappers.
- Create `lib/grade.ts` + `lib/test-grade.ts` — option tables, feedback formatter, rerun body, stale check.
- Create `components/GradeForm.tsx`, `GradeView.tsx`, `GradeProgress.tsx`, `GradeReport.tsx`.
- Create `app/grader/page.tsx`, `app/grader/[id]/page.tsx`.
- Modify `components/Nav.tsx` (nav item), `components/ResumeEditor.tsx` (entry link), `package.json` (test script).

**Docs:** `CLAUDE.md`.

---

### Task 1: Rubric, schemas and specialist prompts

**Files:**
- Create: `packages/agent/src/ai/grade/rubric.ts`
- Create: `packages/agent/src/ai/grade/specialists.ts`
- Test: `packages/agent/src/ai/grade/test-grade-prompts.ts`
- Modify: `packages/agent/package.json`

**Interfaces:**
- Produces: `SPECIALISTS`, `SpecialistName`, `SPECIALIST_LABELS`, `CATEGORIES`, `CategoryKey`, `categoryFor(name)`, `TARGET_ROLES`, `TargetRole`, `LEVELS`, `Level`, `isTargetRole`, `isLevel`, `RawFindingSchema`, `RawFinding`, `specialistResultSchema(max)`, `SpecialistResult`, `Finding`, `GradeCategory`, `GradeReport`, `SpecialistState` (rubric.ts); `GradeInput`, `buildUserMessage(input)`, `systemPrompt(name)`, `runSpecialist(name, input, signal?)` (specialists.ts).

- [ ] **Step 1: Write the failing test**

`packages/agent/src/ai/grade/test-grade-prompts.ts`:

```ts
import { CATEGORIES, SPECIALISTS, categoryFor, specialistResultSchema, isTargetRole, isLevel } from "./rubric";
import { buildUserMessage, systemPrompt } from "./specialists";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

// Rubric shape
check("category maxima sum to 100", CATEGORIES.reduce((s, c) => s + c.max, 0) === 100);
check("every specialist owns exactly one category",
  SPECIALISTS.every((s) => CATEGORIES.filter((c) => c.specialist === s).length === 1));
check("content quality is worth 35", categoryFor("content").max === 35);

// Schema bounds
const finding = { title: "t", severity: "high", quote: null, problem: "p", rewrite: null };
const atsSchema = specialistResultSchema(categoryFor("ats").max);
check("schema accepts a score at the max", atsSchema.safeParse({ score: 25, summary: "ok", findings: [finding] }).success);
check("schema rejects a score above the max", !atsSchema.safeParse({ score: 26, summary: "ok", findings: [] }).success);
check("schema rejects a negative score", !atsSchema.safeParse({ score: -1, summary: "ok", findings: [] }).success);
check("schema rejects a fractional score", !atsSchema.safeParse({ score: 12.5, summary: "ok", findings: [] }).success);
check("schema rejects more than 6 findings",
  !atsSchema.safeParse({ score: 10, summary: "ok", findings: Array(7).fill(finding) }).success);
check("schema rejects an unknown severity",
  !atsSchema.safeParse({ score: 10, summary: "ok", findings: [{ ...finding, severity: "critical" }] }).success);

// Validators
check("isTargetRole accepts ml", isTargetRole("ml"));
check("isTargetRole rejects toString (prototype key)", !isTargetRole("toString"));
check("isLevel accepts intern", isLevel("intern"));
check("isLevel rejects junior", !isLevel("junior"));

// User message
const base = { resumeText: "Jane Doe\n- Built a thing", targetRole: "ml" as const, level: "intern" as const, jdText: null };
const noJd = buildUserMessage(base);
check("user message names the role", noJd.includes("ML / AI Engineer"));
check("user message names the level", noJd.includes("Intern"));
check("user message includes the resume", noJd.includes("- Built a thing"));
check("no JD block when JD is absent", !noJd.includes("<job_description>"));
check("whitespace-only JD counts as absent", !buildUserMessage({ ...base, jdText: "   \n" }).includes("<job_description>"));
const withJd = buildUserMessage({ ...base, jdText: "We need PyTorch." });
check("JD block present when JD is given", withJd.includes("<job_description>") && withJd.includes("We need PyTorch."));

// System prompts
for (const s of SPECIALISTS) {
  const p = systemPrompt(s);
  check(`${s} prompt states its own max`, p.includes(`0 to ${categoryFor(s).max}`));
  check(`${s} prompt forbids invented numbers`, p.includes("[X%]"));
}

console.log(pass ? "\n✓ grade-prompts test PASSED" : "\n✗ grade-prompts test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx tsx src/ai/grade/test-grade-prompts.ts`
Expected: FAIL — `Cannot find module './rubric'`.

- [ ] **Step 3: Write `rubric.ts`**

```ts
import { z } from "zod";

/**
 * The grader's rubric. Five specialists each own one category; the category
 * maxima sum to 100 so the report score is a plain sum. The maxima match the
 * category scores ResuMax showed on 2026-10-17 (20/30/8/18/5 all fit under them).
 * See docs/superpowers/specs/2026-10-17-resume-grader-design.md.
 */

export const SPECIALISTS = ["recruiter", "ats", "content", "domain", "storyteller"] as const;
export type SpecialistName = (typeof SPECIALISTS)[number];

export const SPECIALIST_LABELS: Record<SpecialistName, string> = {
  recruiter: "Recruiter",
  ats: "ATS",
  content: "Content",
  domain: "Domain",
  storyteller: "Storyteller",
};

export const CATEGORIES = [
  { key: "ats", label: "ATS & structure", max: 25, specialist: "ats" },
  { key: "content", label: "Content quality", max: 35, specialist: "content" },
  { key: "writing", label: "Writing quality", max: 10, specialist: "recruiter" },
  { key: "job", label: "Job optimization", max: 20, specialist: "domain" },
  { key: "readiness", label: "Application readiness", max: 10, specialist: "storyteller" },
] as const satisfies readonly { key: string; label: string; max: number; specialist: SpecialistName }[];
export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export type Category = (typeof CATEGORIES)[number];

export function categoryFor(name: SpecialistName): Category {
  const c = CATEGORIES.find((cat) => cat.specialist === name);
  if (!c) throw new Error(`No category for specialist ${name}`);
  return c;
}

export const TARGET_ROLES = {
  swe: "Software Engineer",
  frontend: "Frontend Engineer",
  backend: "Backend Engineer",
  fullstack: "Full-Stack Engineer",
  mobile: "Mobile Engineer",
  devops: "DevOps / Infrastructure Engineer",
  data: "Data Engineer / Data Scientist",
  ml: "ML / AI Engineer",
} as const;
export type TargetRole = keyof typeof TARGET_ROLES;

export const LEVELS = {
  intern: "Intern",
  entry: "Entry level (0–2 years)",
  mid: "Mid level (3–5 years)",
  senior: "Senior (6–10 years)",
  staff: "Staff+ (10+ years)",
} as const;
export type Level = keyof typeof LEVELS;

// hasOwnProperty, not `in`: "toString" is `in` every object.
export function isTargetRole(v: unknown): v is TargetRole {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TARGET_ROLES, v);
}
export function isLevel(v: unknown): v is Level {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LEVELS, v);
}

export const RawFindingSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(["high", "medium", "low"]),
  /** Exact text from the resume this is about; null for whole-resume issues. */
  quote: z.string().nullable(),
  problem: z.string().min(1),
  /** Paste-ready replacement for `quote`, or a concrete instruction when quote is null. */
  rewrite: z.string().nullable(),
});
export type RawFinding = z.infer<typeof RawFindingSchema>;

/** Per-specialist schema: the score bound is the specialist's own category max. */
export function specialistResultSchema(max: number) {
  return z.object({
    score: z.number().int().min(0).max(max),
    summary: z.string().min(1),
    findings: z.array(RawFindingSchema).max(6),
  });
}
export type SpecialistResult = { score: number; summary: string; findings: RawFinding[] };

/** A finding plus fields computed after the LLM call, never self-reported by the model. */
export type Finding = RawFinding & {
  id: string;
  category: CategoryKey;
  groundedness: "grounded" | "needs-your-input";
};

export type GradeCategory = { key: CategoryKey; label: string; score: number; max: number; summary: string };

export type GradeReport = { score: number; categories: GradeCategory[]; findings: Finding[] };

/** One entry of resume_grades.specialists — drives the pending-screen checklist. */
export type SpecialistState = { status: "pending" | "done" | "failed"; result?: SpecialistResult };
```

- [ ] **Step 4: Write `specialists.ts`**

```ts
import { completeJSON } from "../llm";
import {
  LEVELS,
  Level,
  SpecialistName,
  SpecialistResult,
  TARGET_ROLES,
  TargetRole,
  categoryFor,
  specialistResultSchema,
} from "./rubric";

export type GradeInput = {
  resumeText: string;
  targetRole: TargetRole;
  level: Level;
  jdText: string | null;
};

/** What each specialist judges — only its own category; the others cover the rest. */
const FOCUS: Record<SpecialistName, string> = {
  ats:
    "You are the ATS specialist. Judge parseability by an applicant tracking system: standard section " +
    "headings (Education, Experience, Projects, Skills), complete contact info (email, phone, LinkedIn/GitHub), " +
    "consistent date formats, reverse-chronological order within sections, no content that implies tables, " +
    "columns, icons or graphics, and appropriate length for the level (one page for intern/entry).",
  content:
    "You are the Content specialist. Judge bullet strength: each bullet should state an action, its scope, and " +
    "a measurable result. Reward ownership over participation, specificity over vagueness, and quantification — " +
    "count how many bullets carry a number and say so (\"N of M bullets carry a number\").",
  recruiter:
    "You are the Recruiter doing a six-second first-impression skim. Judge writing quality: clarity, concision, " +
    "consistent tense and voice (past tense for past roles), filler words, buzzwords, repetition of the same " +
    "verb, and typos or grammar slips.",
  domain:
    "You are the Domain specialist for the target role. Judge job optimization: are the skills, tools and kinds " +
    "of work a hiring manager for this role and level expects present and easy to find? Is the most relevant " +
    "work surfaced first? When a job description is given, judge keyword and requirement coverage against it; " +
    "otherwise judge against typical postings for this role and level.",
  storyteller:
    "You are the Storyteller. Judge application readiness and narrative: unexplained timeline gaps, unclear " +
    "current status (student? graduation date? availability for the role's start?), missing project dates, and " +
    "whether the resume reads as a coherent arc toward the target role.",
};

export function systemPrompt(name: SpecialistName): string {
  const { label, max } = categoryFor(name);
  return [
    "You are one member of a panel of senior engineering recruiters grading a resume.",
    FOCUS[name],
    "",
    `Your category is "${label}". Score it as an integer from 0 to ${max}.`,
    `A solid resume for the stated level lands around 75–85% of ${max}; give the full ${max} only when you ` +
      "would change nothing. Calibrate to the level: an intern is not penalized for lacking production " +
      "experience — projects and coursework count.",
    "",
    "Rules:",
    "- Report only issues in your own category; the other panelists cover the rest.",
    "- Return at most 6 findings, most costly first. Return an empty list if nothing in your category costs points.",
    "- `quote` is text copied verbatim from the resume (a whole bullet or line), or null for a whole-resume issue.",
    "- `problem` says why it costs points, in a recruiter's terms, in one or two sentences.",
    "- `rewrite` is a paste-ready replacement for `quote`, or a concrete instruction when `quote` is null.",
    "- Rewrites may only use facts already in the resume. Never invent a number, tool, employer, title, or " +
      "outcome. When a stronger bullet needs a number you do not have, write a bracketed placeholder where it " +
      "goes, such as [X%] or [N users].",
    "- Formatting markers such as **, ## or leading dashes come from a plain-text export of the resume; do not grade them.",
    "- `summary` is your one- or two-sentence verdict on this category.",
    "",
    "Return ONLY JSON: {\"score\": int, \"summary\": string, \"findings\": [{\"title\", \"severity\": \"high\"|\"medium\"|\"low\", \"quote\", \"problem\", \"rewrite\"}]}",
  ].join("\n");
}

export function buildUserMessage(input: GradeInput): string {
  const jd = input.jdText?.trim() ?? "";
  const parts = [
    `Target role: ${TARGET_ROLES[input.targetRole]}`,
    `Experience level: ${LEVELS[input.level]}`,
    "",
  ];
  if (jd) {
    parts.push("<job_description>", jd, "</job_description>", "");
  } else {
    parts.push(`No job description was given — judge fit against typical ${TARGET_ROLES[input.targetRole]} postings at this level.`, "");
  }
  parts.push("<resume>", input.resumeText, "</resume>");
  return parts.join("\n");
}

export async function runSpecialist(
  name: SpecialistName,
  input: GradeInput,
  signal?: AbortSignal
): Promise<SpecialistResult> {
  return completeJSON(specialistResultSchema(categoryFor(name).max), {
    system: systemPrompt(name),
    user: buildUserMessage(input),
    temperature: 0.2,
    signal,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/agent && npx tsx src/ai/grade/test-grade-prompts.ts`
Expected: every line `✓`, ends `✓ grade-prompts test PASSED`.

- [ ] **Step 6: Wire into the fast gate**

In `packages/agent/package.json` add `"test:grade-prompts": "tsx src/ai/grade/test-grade-prompts.ts"` and append ` && npm run test:grade-prompts` to the end of the `"test"` chain. Run `npx tsc --noEmit -p .` — expected: no errors.

- [ ] **Step 7: Commit** (only if the user has asked for commits)

```bash
git add packages/agent/src/ai/grade/rubric.ts packages/agent/src/ai/grade/specialists.ts packages/agent/src/ai/grade/test-grade-prompts.ts packages/agent/package.json
git commit -m "feat(grade): rubric, schemas and specialist prompts"
```

---

### Task 2: Report assembler

**Files:**
- Create: `packages/agent/src/ai/grade/assemble.ts`
- Test: `packages/agent/src/ai/grade/test-grade-assemble.ts`
- Modify: `packages/agent/package.json`

**Interfaces:**
- Consumes: `CATEGORIES`, `SpecialistName`, `SpecialistResult`, `GradeReport`, `Finding` (Task 1); `numbers(text): Set<string>` from `ai/grounding.ts`.
- Produces: `labelRewrite(rewrite: string | null, resumeText: string): "grounded" | "needs-your-input"`; `assembleReport(results: Record<SpecialistName, SpecialistResult>, resumeText: string): GradeReport`.

- [ ] **Step 1: Write the failing test**

`packages/agent/src/ai/grade/test-grade-assemble.ts`:

```ts
import { assembleReport, labelRewrite } from "./assemble";
import { SpecialistName, SpecialistResult } from "./rubric";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const resume = "Built a cache that cut latency 40% for 2,000 users\nGPA 3.8";
const f = (title: string, severity: "high" | "medium" | "low", rewrite: string | null = null) =>
  ({ title, severity, quote: null, problem: "p", rewrite });

const results: Record<SpecialistName, SpecialistResult> = {
  ats: { score: 30, summary: "ats ok", findings: [f("ats-low", "low")] },          // above max 25 → clamp
  content: { score: 28, summary: "content ok", findings: [f("content-med", "medium"), f("content-high", "high")] },
  recruiter: { score: -3, summary: "writing", findings: [] },                       // below 0 → clamp
  domain: { score: 15, summary: "domain", findings: [f("domain-high", "high")] },
  storyteller: { score: 7.6, summary: "story", findings: [f("story-med", "medium")] }, // rounds to 8
};
const report = assembleReport(results, resume);

check("categories are in rubric order",
  report.categories.map((c) => c.key).join(",") === "ats,content,writing,job,readiness");
check("score above max clamps to max", report.categories[0].score === 25);
check("negative score clamps to 0", report.categories[2].score === 0);
check("fractional score rounds", report.categories[4].score === 8);
check("total is the sum of clamped categories", report.score === 25 + 28 + 0 + 15 + 8);
check("category carries its specialist summary", report.categories[1].summary === "content ok");
check("findings sorted by severity, then category order, then original order",
  report.findings.map((x) => x.title).join(",") === "content-high,domain-high,content-med,story-med,ats-low");
check("ids are category-scoped and stable", report.findings[0].id === "content-2" && report.findings[4].id === "ats-1");
check("findings carry their category key", report.findings[1].category === "job");
check("assembling twice gives identical output",
  JSON.stringify(assembleReport(results, resume)) === JSON.stringify(report));

// Groundedness
check("no rewrite → grounded", labelRewrite(null, resume) === "grounded");
check("rewrite reusing resume numbers → grounded",
  labelRewrite("Designed a cache cutting latency 40% for 2,000 users", resume) === "grounded");
check("rewrite with a new number → needs-your-input", labelRewrite("Cut latency 55%", resume) === "needs-your-input");
check("rewrite with a placeholder → needs-your-input",
  labelRewrite("Cut latency [X%] across [N] services", resume) === "needs-your-input");
check("number formatting differences still match", labelRewrite("for 2000 users", resume) === "grounded");

console.log(pass ? "\n✓ grade-assemble test PASSED" : "\n✗ grade-assemble test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx tsx src/ai/grade/test-grade-assemble.ts`
Expected: FAIL — `Cannot find module './assemble'`.

- [ ] **Step 3: Write `assemble.ts`**

```ts
import { numbers } from "../grounding";
import { CATEGORIES, Finding, GradeReport, SpecialistName, SpecialistResult } from "./rubric";

/**
 * Turns the five specialist results into the stored report. Deterministic and
 * pure — no sixth LLM call — so the score is always the sum of what the UI
 * shows and the ordering is testable.
 */

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const PLACEHOLDER = /\[[^\]\n]+\]/;

/**
 * A rewrite is only "grounded" when every number in it already appears in the
 * resume and it has no [placeholder] left to fill. Same idea as the tailoring
 * flow's labelGroundedness, reusing grounding.ts's number normalisation.
 */
export function labelRewrite(rewrite: string | null, resumeText: string): Finding["groundedness"] {
  if (!rewrite) return "grounded";
  if (PLACEHOLDER.test(rewrite)) return "needs-your-input";
  const known = numbers(resumeText);
  for (const n of numbers(rewrite)) {
    if (!known.has(n)) return "needs-your-input";
  }
  return "grounded";
}

export function assembleReport(
  results: Record<SpecialistName, SpecialistResult>,
  resumeText: string
): GradeReport {
  const categories = CATEGORIES.map((c) => {
    const r = results[c.specialist];
    // Zod already bounds the score; clamp anyway so a schema change can never
    // push the total past 100.
    const score = Math.min(c.max, Math.max(0, Math.round(r.score)));
    return { key: c.key, label: c.label, score, max: c.max, summary: r.summary };
  });

  const ranked = CATEGORIES.flatMap((c, ci) =>
    results[c.specialist].findings.map((f, fi) => ({
      finding: {
        ...f,
        id: `${c.key}-${fi + 1}`,
        category: c.key,
        groundedness: labelRewrite(f.rewrite, resumeText),
      } as Finding,
      order: ci * 1000 + fi,
    }))
  );
  ranked.sort(
    (a, b) => SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] || a.order - b.order
  );

  return {
    score: categories.reduce((sum, c) => sum + c.score, 0),
    categories,
    findings: ranked.map((r) => r.finding),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent && npx tsx src/ai/grade/test-grade-assemble.ts`
Expected: ends `✓ grade-assemble test PASSED`. If "number formatting differences still match" fails, inspect `numbers()` output for both strings before changing the test — `numbers()` strips commas, so `2,000` and `2000` must normalise identically.

- [ ] **Step 5: Wire into the fast gate**

Add `"test:grade-assemble": "tsx src/ai/grade/test-grade-assemble.ts"` and append ` && npm run test:grade-assemble` to `"test"`.

- [ ] **Step 6: Commit** (only if asked)

```bash
git add packages/agent/src/ai/grade/assemble.ts packages/agent/src/ai/grade/test-grade-assemble.ts packages/agent/package.json
git commit -m "feat(grade): deterministic report assembler with groundedness labels"
```

---

### Task 3: Concurrency limiter

**Files:**
- Create: `packages/agent/src/ai/grade/limit.ts`
- Test: `packages/agent/src/ai/grade/test-grade-limit.ts`
- Modify: `packages/agent/package.json`

**Interfaces:**
- Consumes: `CancelledError` from `ai/cancellation.ts`.
- Produces: `createLimiter(max: number): Limiter` where `Limiter = { run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>; readonly active: number; readonly queued: number }`; `graderLimit: Limiter` (max 2).

- [ ] **Step 1: Write the failing test**

`packages/agent/src/ai/grade/test-grade-limit.ts`:

```ts
import { createLimiter } from "./limit";
import { isCancelledError } from "../cancellation";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

async function main() {
  // Never more than max in flight
  {
    const lim = createLimiter(2);
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());
    const runs = gates.map((g, i) =>
      lim.run(async () => { peak = Math.max(peak, lim.active); await g.promise; return i; })
    );
    await tick();
    check("only 2 start immediately", lim.active === 2 && lim.queued === 3);
    gates.forEach((g) => g.resolve());
    const out = await Promise.all(runs);
    check("peak concurrency is 2", peak === 2);
    check("all tasks resolve with their own values", out.join(",") === "0,1,2,3,4");
    check("limiter drains", lim.active === 0 && lim.queued === 0);
  }

  // A failing task frees its slot
  {
    const lim = createLimiter(1);
    const first = lim.run(async () => { throw new Error("boom"); });
    const second = lim.run(async () => "ok");
    const r1 = await first.catch((e) => (e as Error).message);
    check("failing task rejects with its error", r1 === "boom");
    check("next task still runs after a failure", (await second) === "ok");
  }

  // Abort while queued rejects immediately and never runs the task
  {
    const lim = createLimiter(1);
    const hold = deferred();
    const blocker = lim.run(() => hold.promise);
    const ctl = new AbortController();
    let ran = false;
    const queued = lim.run(async () => { ran = true; }, ctl.signal);
    await tick();
    ctl.abort();
    const err = await queued.catch((e) => e);
    check("queued task rejects with CancelledError on abort", isCancelledError(err));
    check("aborted queued task never ran", !ran);
    check("aborted task left the queue", lim.queued === 0);
    hold.resolve();
    await blocker;
  }

  // Already-aborted signal rejects without queueing
  {
    const lim = createLimiter(2);
    const ctl = new AbortController();
    ctl.abort();
    let ran = false;
    const err = await lim.run(async () => { ran = true; }, ctl.signal).catch((e) => e);
    check("pre-aborted signal rejects with CancelledError", isCancelledError(err) && !ran);
  }

  console.log(pass ? "\n✓ grade-limit test PASSED" : "\n✗ grade-limit test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx tsx src/ai/grade/test-grade-limit.ts`
Expected: FAIL — `Cannot find module './limit'`.

- [ ] **Step 3: Write `limit.ts`**

```ts
import { CancelledError } from "../cancellation";

/**
 * A tiny promise pool. Every grader specialist is its own `claude -p`
 * subprocess, and the agent has hit Railway's memory ceiling before (see the
 * Jobright removal), so all grades share one pool rather than each spawning five.
 */

export type Limiter = {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  readonly active: number;
  readonly queued: number;
};

export function createLimiter(max: number): Limiter {
  let active = 0;
  const queue: Array<() => void> = [];

  function pump() {
    while (active < max && queue.length > 0) queue.shift()!();
  }

  return {
    run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (signal?.aborted) { reject(new CancelledError()); return; }

        // A cancel while queued leaves the queue right away instead of waiting
        // for a slot another grade might hold for a minute.
        const onAbort = () => {
          const i = queue.indexOf(start);
          if (i >= 0) { queue.splice(i, 1); reject(new CancelledError()); }
        };
        const start = () => {
          signal?.removeEventListener("abort", onAbort);
          active++;
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => { active--; pump(); });
        };

        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(start);
        pump();
      });
    },
    get active() { return active; },
    get queued() { return queue.length; },
  };
}

/** Shared by every grade run. Tailoring does not go through this. */
export const graderLimit = createLimiter(2);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent && npx tsx src/ai/grade/test-grade-limit.ts`
Expected: ends `✓ grade-limit test PASSED`.

- [ ] **Step 5: Wire into the fast gate**

Add `"test:grade-limit": "tsx src/ai/grade/test-grade-limit.ts"` and append ` && npm run test:grade-limit` to `"test"`.

- [ ] **Step 6: Commit** (only if asked)

```bash
git add packages/agent/src/ai/grade/limit.ts packages/agent/src/ai/grade/test-grade-limit.ts packages/agent/package.json
git commit -m "feat(grade): shared 2-slot limiter for grader LLM calls"
```

---

### Task 4: Resume text (master → text, PDF extraction)

**Files:**
- Create: `packages/agent/src/ai/grade/resume-text.ts`
- Test: `packages/agent/src/ai/grade/test-resume-text.ts`
- Modify: `packages/agent/src/api/routes/master-resume.ts:52-66` (use `extractPdfText`)
- Modify: `packages/agent/package.json`

**Interfaces:**
- Consumes: `MasterResume` (`ai/types.ts`), `dateRange(start, end)` (`ai/format.ts`).
- Produces: `MAX_GRADE_TEXT_CHARS = 30_000`; `masterToText(master: MasterResume): string`; `extractPdfText(buf: Buffer): Promise<string>`.

- [ ] **Step 1: Write the failing test**

`packages/agent/src/ai/grade/test-resume-text.ts`:

```ts
import { MASTER_RESUME } from "../master-resume";
import { masterToText } from "./resume-text";
import { MasterResume } from "../types";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const master: MasterResume = { ...MASTER_RESUME, aboutMe: "SECRET-ABOUT-ME-NOTES" };
const text = masterToText(master);

check("includes the candidate name", text.includes(master.basics.name));
check("never includes About me notes", !text.includes("SECRET-ABOUT-ME-NOTES"));

const headings = ["Education", "Experience", "Projects", "Extracurriculars", "Skills & Interests"];
const present = headings.filter((h) => text.split("\n").includes(h));
const positions = present.map((h) => text.split("\n").indexOf(h));
check("section headings match the PDF and appear in PDF order",
  positions.every((p, i) => i === 0 || p > positions[i - 1]));

const sections = [...master.experience, ...master.projects, ...master.extracurriculars];
const allBullets = sections.flatMap((s) => s.bullets.map((b) => b.text));
check("every bullet appears", allBullets.every((b) => text.includes(b)));
let last = -1, ordered = true;
for (const b of allBullets) {
  const at = text.indexOf(b, last + 1);
  if (at <= last) { ordered = false; break; }
  last = at;
}
check("bullets keep master order", ordered);
check("every experience company appears", master.experience.every((e) => text.includes(e.company)));
check("every project name appears", master.projects.every((p) => text.includes(p.name)));
check("skills appear", master.skills.languages.every((l) => text.includes(l)));

const noProjects = masterToText({ ...master, projects: [] });
check("empty section emits no heading", !noProjects.split("\n").includes("Projects"));

console.log(pass ? "\n✓ resume-text test PASSED" : "\n✗ resume-text test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx tsx src/ai/grade/test-resume-text.ts`
Expected: FAIL — `Cannot find module './resume-text'`.

- [ ] **Step 3: Write `resume-text.ts`**

```ts
import { dateRange } from "../format";
import { Experience, MasterResume } from "../types";

/** Resume and JD text cap for one grade — five prompts each carry the whole resume. */
export const MAX_GRADE_TEXT_CHARS = 30_000;

const join = (sep: string, ...parts: (string | undefined)[]) =>
  parts.filter((p) => p && p.trim()).join(sep);

/**
 * Plain-text rendering of the master resume for grading. Section headings and
 * order match the PDF (render-pdf.ts buildLatex) so the ATS specialist judges
 * what a recruiter actually receives. `aboutMe` is private notes — never included.
 */
export function masterToText(m: MasterResume): string {
  const b = m.basics;
  const lines: string[] = [b.name, join(" | ", b.location, b.email, b.phone, b.github, b.linkedin, b.portfolio)];
  if (b.summary.trim()) lines.push("", b.summary.trim());

  if (m.education.length) {
    lines.push("", "Education");
    for (const e of m.education) {
      lines.push(join(" | ", `${e.school} — ${e.degrees.join(", ")}`, e.location, e.graduation));
      const gpaNotes = join(", ", e.gpa ? `GPA: ${e.gpa}` : "", ...e.notes);
      if (gpaNotes) lines.push(gpaNotes);
      if (e.coursework.length) lines.push(`Relevant Coursework: ${e.coursework.join(", ")}`);
    }
  }

  const roles = (heading: string, items: Experience[]) => {
    if (!items.length) return;
    lines.push("", heading);
    for (const e of items) {
      lines.push(join(" | ", e.company, e.location), join(" | ", e.title, dateRange(e.start, e.end)));
      for (const bullet of e.bullets) lines.push(`- ${bullet.text}`);
    }
  };

  roles("Experience", m.experience);

  if (m.projects.length) {
    lines.push("", "Projects");
    for (const p of m.projects) {
      lines.push(join(" | ", join(" - ", p.name, p.link), p.tech.join(", "), dateRange(p.start, p.end)));
      for (const bullet of p.bullets) lines.push(`- ${bullet.text}`);
    }
  }

  roles("Extracurriculars", m.extracurriculars);

  const s = m.skills;
  const skillLines = [
    s.languages.length ? `Languages: ${s.languages.join(", ")}` : "",
    s.frameworks.length ? `Frameworks: ${s.frameworks.join(", ")}` : "",
    s.tools.length ? `Tools: ${s.tools.join(", ")}` : "",
    s.interests.length ? `Interests: ${s.interests.join(", ")}` : "",
  ].filter(Boolean);
  if (skillLines.length) lines.push("", "Skills & Interests", ...skillLines);

  return lines.join("\n").trim();
}

/** Text from an uploaded PDF — shared with POST /api/master-resume/import. */
export async function extractPdfText(buf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buf });
  try {
    const parsed = await parser.getText({ pageJoiner: "" });
    return parsed.text;
  } finally {
    await parser.destroy();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent && npx tsx src/ai/grade/test-resume-text.ts`
Expected: ends `✓ resume-text test PASSED`. If "every bullet appears" fails because the seed has an empty bullet text, filter empty texts out of `allBullets` in the test rather than emitting `- ` lines.

- [ ] **Step 5: Reuse `extractPdfText` in the import route**

In `packages/agent/src/api/routes/master-resume.ts`, add `import { extractPdfText } from "../../ai/grade/resume-text";` and replace the body of the `if (req.file) { try { ... } }` block's try with:

```ts
      rawText = await extractPdfText(req.file.buffer);
```

(keep the existing `catch` that answers 400). Run `npx tsc --noEmit -p .` — no errors.

- [ ] **Step 6: Wire into the fast gate**

Add `"test:resume-text": "tsx src/ai/grade/test-resume-text.ts"` and append ` && npm run test:resume-text` to `"test"`.

- [ ] **Step 7: Commit** (only if asked)

```bash
git add packages/agent/src/ai/grade/resume-text.ts packages/agent/src/ai/grade/test-resume-text.ts packages/agent/src/api/routes/master-resume.ts packages/agent/package.json
git commit -m "feat(grade): plain-text master resume and shared PDF text extraction"
```

---

### Task 5: `resume_grades` table and queries

**Files:**
- Modify: `packages/agent/src/db/schema.ts` (add a block before the `playground_usage` block)
- Modify: `packages/agent/src/db/queries.ts` (append a "Resume grades" section)

**Interfaces:**
- Consumes: `GradeReport`, `SpecialistName`, `SpecialistState`, `TargetRole`, `Level`, `SPECIALISTS` (Task 1).
- Produces:
  - `GradeRow` type (all columns; `specialists: Partial<Record<SpecialistName, SpecialistState>>`, `report: GradeReport | null`).
  - `GradeListItem` = `Pick<GradeRow, "id" | "label" | "source" | "resume_id" | "target_role" | "level" | "status" | "score" | "created_at">`.
  - `createGrade(fields: { source: GradeRow["source"]; resumeId: string | null; label: string; resumeText: string; targetRole: TargetRole; level: Level; jdText: string | null }): Promise<{ id: string }>`
  - `getGrade(id: string): Promise<GradeRow | null>`
  - `listGrades(resumeId?: string): Promise<GradeListItem[]>`
  - `setGradeSpecialist(id: string, name: SpecialistName, state: SpecialistState): Promise<void>`
  - `completeGrade(id: string, report: GradeReport): Promise<boolean>`
  - `failGrade(id: string, message: string): Promise<boolean>`
  - `cancelGrade(id: string): Promise<boolean>`
  - `deleteGrade(id: string): Promise<boolean>`
  - All status writes are guarded `WHERE status = 'pending'`.

- [ ] **Step 1: Add the table to `schema.ts`**

Insert before the `CREATE TABLE IF NOT EXISTS playground_usage` query:

```ts
  // Resume grader (docs/superpowers/specs/2026-10-17-resume-grader-design.md).
  // resume_text is a snapshot so a grade stays meaningful after the resume changes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resume_grades (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source       TEXT NOT NULL CHECK (source IN ('master', 'tailored', 'upload')),
      resume_id    UUID REFERENCES tailored_resumes(id) ON DELETE SET NULL,
      label        TEXT NOT NULL,
      resume_text  TEXT NOT NULL,
      target_role  TEXT NOT NULL,
      level        TEXT NOT NULL,
      jd_text      TEXT,
      status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed', 'cancelled')),
      specialists  JSONB NOT NULL DEFAULT '{}',
      score        INT,
      report       JSONB,
      error        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_resume_grades_resume ON resume_grades(resume_id, created_at DESC)
  `);
```

- [ ] **Step 2: Add the queries to `queries.ts`**

Add to the imports: `import { GradeReport, Level, SPECIALISTS, SpecialistName, SpecialistState, TargetRole } from "../ai/grade/rubric";`. Append:

```ts
// ── Resume grades ─────────────────────────────────────────────────────────────

export type GradeRow = {
  id: string;
  source: "master" | "tailored" | "upload";
  resume_id: string | null;
  label: string;
  resume_text: string;
  target_role: TargetRole;
  level: Level;
  jd_text: string | null;
  status: "pending" | "ready" | "failed" | "cancelled";
  specialists: Partial<Record<SpecialistName, SpecialistState>>;
  score: number | null;
  report: GradeReport | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

export type GradeListItem = Pick<
  GradeRow,
  "id" | "label" | "source" | "resume_id" | "target_role" | "level" | "status" | "score" | "created_at"
>;

export async function createGrade(fields: {
  source: GradeRow["source"];
  resumeId: string | null;
  label: string;
  resumeText: string;
  targetRole: TargetRole;
  level: Level;
  jdText: string | null;
}): Promise<{ id: string }> {
  // Every specialist starts 'pending' so the progress checklist renders all five at once.
  const specialists = Object.fromEntries(SPECIALISTS.map((s) => [s, { status: "pending" }]));
  const { rows } = await pool.query(
    `INSERT INTO resume_grades (source, resume_id, label, resume_text, target_role, level, jd_text, specialists)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [fields.source, fields.resumeId, fields.label, fields.resumeText, fields.targetRole, fields.level,
     fields.jdText, JSON.stringify(specialists)]
  );
  return { id: rows[0].id };
}

export async function getGrade(id: string): Promise<GradeRow | null> {
  const { rows } = await pool.query(`SELECT * FROM resume_grades WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listGrades(resumeId?: string): Promise<GradeListItem[]> {
  const cols = `id, label, source, resume_id, target_role, level, status, score, created_at`;
  const { rows } = resumeId
    ? await pool.query(`SELECT ${cols} FROM resume_grades WHERE resume_id = $1 ORDER BY created_at DESC`, [resumeId])
    : await pool.query(`SELECT ${cols} FROM resume_grades ORDER BY created_at DESC LIMIT 200`);
  return rows;
}

/** Records one specialist's outcome. Guarded so a late finisher can't touch a cancelled grade. */
export async function setGradeSpecialist(id: string, name: SpecialistName, state: SpecialistState): Promise<void> {
  await pool.query(
    `UPDATE resume_grades
        SET specialists = jsonb_set(specialists, ARRAY[$2::text], $3::jsonb), updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [id, name, JSON.stringify(state)]
  );
}

export async function completeGrade(id: string, report: GradeReport): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE resume_grades
        SET status = 'ready', score = $2, report = $3, error = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [id, report.score, JSON.stringify(report)]
  );
  return rowCount === 1;
}

export async function failGrade(id: string, message: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE resume_grades SET status = 'failed', error = $2, updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [id, message]
  );
  return rowCount === 1;
}

export async function cancelGrade(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE resume_grades SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [id]
  );
  return rowCount === 1;
}

export async function deleteGrade(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM resume_grades WHERE id = $1`, [id]);
  return rowCount === 1;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/agent && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Verify against local Postgres**

Run: `docker-compose up -d` (repo root), then `cd packages/agent && npx tsx -e "import('./src/db/schema').then(m => m.initSchema()).then(() => process.exit(0))"` (adjust the export name to whatever `schema.ts` exports — check with `grep -n '^export' src/db/schema.ts`). Then:

```bash
psql "$DATABASE_URL" -c "\d resume_grades"
```

Expected: the table with all 15 columns and `idx_resume_grades_resume`. Running `initSchema()` a second time must succeed (idempotent).

- [ ] **Step 5: Commit** (only if asked)

```bash
git add packages/agent/src/db/schema.ts packages/agent/src/db/queries.ts
git commit -m "feat(grade): resume_grades table and queries"
```

---

### Task 6: Pipeline, request validation and routes

**Files:**
- Create: `packages/agent/src/ai/grade/request.ts`
- Create: `packages/agent/src/ai/grade/pipeline.ts`
- Create: `packages/agent/src/api/routes/grades.ts`
- Modify: `packages/agent/src/api/index.ts`
- Test: `packages/agent/src/ai/grade/test-grade-request.ts`, `packages/agent/src/ai/grade/test-grade-pipeline.ts`, `packages/agent/src/ai/grade/test-grade-live.ts`
- Modify: `packages/agent/package.json`

**Interfaces:**
- Consumes: everything from Tasks 1–5; `registerRun`, `abortRun`, `clearRun` from `ai/cancellation.ts`; `getMasterResume`, `getTailoredResume` from `db/queries.ts`; `LLM_PROVIDER` from `ai/llm.ts`.
- Produces:
  - `isUuid(v: unknown): v is string`
  - `parseGradeRequest(body: Record<string, unknown>): { ok: true; value: GradeRequest } | { ok: false; error: string }` where `GradeRequest = { source: "master" | "tailored" | "upload"; resumeId: string | null; text: string | null; label: string | null; targetRole: TargetRole; level: Level; jdText: string }`.
  - `runGradePipeline(id: string, deps?: PipelineDeps): Promise<void>` (omit `deps` in production; tests pass a full fake set) with `PipelineDeps = { getGrade, setGradeSpecialist, completeGrade, failGrade, runSpecialist, limiter }`.
  - HTTP: `POST /api/grades` → 202 `{ id, status: "pending" }`; `GET /api/grades[?resumeId=]` → `GradeListItem[]`; `GET /api/grades/:id` → `GradeRow`; `POST /api/grades/:id/cancel` → `{ id, status: "cancelled" }`; `DELETE /api/grades/:id` → 204.

- [ ] **Step 1: Write the failing request-validation test**

`packages/agent/src/ai/grade/test-grade-request.ts`:

```ts
import { isUuid, parseGradeRequest } from "./request";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
check("isUuid accepts a uuid", isUuid(ID));
check("isUuid rejects junk", !isUuid("abc") && !isUuid(`${ID}x`) && !isUuid(undefined));

const ok = (b: Record<string, unknown>) => parseGradeRequest(b);
const master = ok({ source: "master", targetRole: "ml", level: "intern" });
check("master request parses", master.ok && master.value.source === "master" && master.value.jdText === "");
check("unknown source rejected", !ok({ source: "linkedin", targetRole: "ml", level: "intern" }).ok);
check("unknown role rejected", !ok({ source: "master", targetRole: "pm", level: "intern" }).ok);
check("unknown level rejected", !ok({ source: "master", targetRole: "ml", level: "junior" }).ok);
check("tailored needs a uuid resumeId", !ok({ source: "tailored", resumeId: "abc", targetRole: "ml", level: "intern" }).ok);
const tailored = ok({ source: "tailored", resumeId: ID, targetRole: "swe", level: "entry", jdText: "  JD  " });
check("tailored parses and trims the JD", tailored.ok && tailored.value.resumeId === ID && tailored.value.jdText === "JD");
check("upload without text or file rejected", !ok({ source: "upload", targetRole: "ml", level: "intern" }).ok);
const pasted = ok({ source: "upload", text: "resume", label: "  Old resume  ", targetRole: "ml", level: "intern" });
check("pasted upload keeps text and trims label", pasted.ok && pasted.value.text === "resume" && pasted.value.label === "Old resume");
check("upload with a file flag parses without text",
  ok({ source: "upload", hasFile: true, targetRole: "ml", level: "intern" }).ok);
check("JD over 30,000 chars rejected",
  !ok({ source: "master", targetRole: "ml", level: "intern", jdText: "x".repeat(30_001) }).ok);
check("non-string JD rejected", !ok({ source: "master", targetRole: "ml", level: "intern", jdText: 5 }).ok);

console.log(pass ? "\n✓ grade-request test PASSED" : "\n✗ grade-request test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/agent && npx tsx src/ai/grade/test-grade-request.ts`
Expected: FAIL — `Cannot find module './request'`.

- [ ] **Step 3: Write `request.ts`**

```ts
import { LEVELS, Level, TARGET_ROLES, TargetRole, isLevel, isTargetRole } from "./rubric";
import { MAX_GRADE_TEXT_CHARS } from "./resume-text";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres throws on a malformed uuid; check first so a bad URL is a 404, not a 500. */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export type GradeRequest = {
  source: "master" | "tailored" | "upload";
  resumeId: string | null;
  text: string | null;
  label: string | null;
  targetRole: TargetRole;
  level: Level;
  jdText: string;
};

/**
 * Validates the shape of POST /api/grades. `hasFile` is set by the route when
 * multer saw a PDF, since the file itself never reaches this pure function.
 * Resolving the resume text (DB reads, PDF parsing) happens in the route.
 */
export function parseGradeRequest(
  body: Record<string, unknown>
): { ok: true; value: GradeRequest } | { ok: false; error: string } {
  const { source, resumeId, text, label, targetRole, level, jdText, hasFile } = body;

  if (source !== "master" && source !== "tailored" && source !== "upload") {
    return { ok: false, error: "source must be 'master', 'tailored' or 'upload'." };
  }
  if (!isTargetRole(targetRole)) {
    return { ok: false, error: `targetRole must be one of: ${Object.keys(TARGET_ROLES).join(", ")}.` };
  }
  if (!isLevel(level)) {
    return { ok: false, error: `level must be one of: ${Object.keys(LEVELS).join(", ")}.` };
  }
  if (jdText !== undefined && jdText !== null && typeof jdText !== "string") {
    return { ok: false, error: "jdText must be a string." };
  }
  const jd = typeof jdText === "string" ? jdText.trim() : "";
  if (jd.length > MAX_GRADE_TEXT_CHARS) {
    return { ok: false, error: `The job description is too long (max ${MAX_GRADE_TEXT_CHARS.toLocaleString()} characters).` };
  }

  if (source === "tailored" && !isUuid(resumeId)) {
    return { ok: false, error: "resumeId must be a resume id." };
  }
  if (source === "upload" && !hasFile && typeof text !== "string") {
    return { ok: false, error: "Paste resume text or upload a PDF." };
  }

  return {
    ok: true,
    value: {
      source,
      resumeId: source === "tailored" ? (resumeId as string) : null,
      text: source === "upload" && typeof text === "string" ? text : null,
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 120) : null,
      targetRole,
      level,
      jdText: jd,
    },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/agent && npx tsx src/ai/grade/test-grade-request.ts`
Expected: ends `✓ grade-request test PASSED`.

- [ ] **Step 5: Write the failing pipeline test (injected deps, no DB/LLM)**

`packages/agent/src/ai/grade/test-grade-pipeline.ts`:

```ts
import { runGradePipeline, PipelineDeps } from "./pipeline";
import { createLimiter } from "./limit";
import { abortRun } from "../cancellation";
import { SpecialistName, SpecialistResult, SpecialistState, categoryFor } from "./rubric";
import type { GradeRow } from "../../db/queries";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

function fakeRow(id: string): GradeRow {
  return {
    id, source: "master", resume_id: null, label: "Master resume", resume_text: "Did 40% better",
    target_role: "ml", level: "intern", jd_text: null, status: "pending", specialists: {},
    score: null, report: null, error: null, created_at: new Date(), updated_at: new Date(),
  };
}

function harness(run: PipelineDeps["runSpecialist"]) {
  const writes: { specialists: Record<string, SpecialistState>; completed: unknown; failed: string | null } =
    { specialists: {}, completed: null, failed: null };
  const deps: PipelineDeps = {
    getGrade: async (id) => fakeRow(id),
    setGradeSpecialist: async (_id, name, state) => { writes.specialists[name] = state; },
    completeGrade: async (_id, report) => { writes.completed = report; return true; },
    failGrade: async (_id, msg) => { writes.failed = msg; return true; },
    runSpecialist: run,
    limiter: createLimiter(2),
  };
  return { deps, writes };
}

const okResult = (name: SpecialistName): SpecialistResult =>
  ({ score: categoryFor(name).max - 1, summary: `${name} ok`, findings: [] });

async function main() {
  // Happy path
  {
    const { deps, writes } = harness(async (name) => okResult(name));
    await runGradePipeline("11111111-1111-1111-1111-111111111111", deps);
    check("all five specialists recorded done",
      Object.values(writes.specialists).filter((s) => s.status === "done").length === 5);
    check("report completed with score 95", (writes.completed as { score: number } | null)?.score === 95);
    check("nothing marked failed", writes.failed === null);
  }

  // One specialist fails → whole grade fails, siblings aborted, error names it
  {
    let sawAbort = false;
    const { deps, writes } = harness(async (name, _input, signal) => {
      // recruiter is first in SPECIALISTS, so it holds a slot: it fails while ats is
      // running and content/domain/storyteller are still queued in the limiter.
      if (name === "recruiter") throw new Error("schema mismatch");
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 200);
        signal?.addEventListener("abort", () => { clearTimeout(t); sawAbort = true; reject(new Error("aborted")); });
      });
      return okResult(name);
    });
    await runGradePipeline("22222222-2222-2222-2222-222222222222", deps);
    check("grade marked failed", writes.failed !== null);
    check("failure message names the Recruiter reviewer", (writes.failed ?? "").includes("Recruiter"));
    check("no report written", writes.completed === null);
    check("siblings were aborted", sawAbort);
    check("failing specialist recorded failed", writes.specialists.recruiter?.status === "failed");
    check("queued specialists never recorded done",
      !["content", "domain", "storyteller"].some((n) => writes.specialists[n]?.status === "done"));
  }

  // User cancel → neither failed nor completed is written
  {
    const id = "33333333-3333-3333-3333-333333333333";
    const { deps, writes } = harness((_name, _input, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("killed")));
      })
    );
    const run = runGradePipeline(id, deps);
    await new Promise((r) => setTimeout(r, 20));
    abortRun(`grade:${id}`);
    await run;
    check("cancel writes no failure", writes.failed === null);
    check("cancel writes no report", writes.completed === null);
  }

  // A grade that is no longer pending is left alone
  {
    let called = false;
    const { deps, writes } = harness(async (name) => { called = true; return okResult(name); });
    deps.getGrade = async (id) => ({ ...fakeRow(id), status: "cancelled" });
    await runGradePipeline("44444444-4444-4444-4444-444444444444", deps);
    check("non-pending grade runs no specialists", !called && writes.completed === null);
  }

  console.log(pass ? "\n✓ grade-pipeline test PASSED" : "\n✗ grade-pipeline test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
```

Note: `db/queries.ts` imports `pool`, which reads `DATABASE_URL` when imported. The test imports `GradeRow` with `import type`, and `pipeline.ts` must import the real query functions lazily (see Step 7) so this test never opens a DB connection. Check `db/pool.ts`: if constructing the `Pool` with no `DATABASE_URL` throws at import time, the lazy import is mandatory.

- [ ] **Step 6: Run it to verify it fails**

Run: `cd packages/agent && npx tsx src/ai/grade/test-grade-pipeline.ts`
Expected: FAIL — `Cannot find module './pipeline'`.

- [ ] **Step 7: Write `pipeline.ts`**

```ts
import { clearRun, registerRun } from "../cancellation";
import { LLM_PROVIDER } from "../llm";
import { assembleReport } from "./assemble";
import { Limiter, graderLimit } from "./limit";
import { SPECIALISTS, SPECIALIST_LABELS, SpecialistName, SpecialistResult } from "./rubric";
import { runSpecialist } from "./specialists";
import type { GradeRow } from "../../db/queries";
import type { GradeReport, SpecialistState } from "./rubric";

export type PipelineDeps = {
  getGrade: (id: string) => Promise<GradeRow | null>;
  setGradeSpecialist: (id: string, name: SpecialistName, state: SpecialistState) => Promise<void>;
  completeGrade: (id: string, report: GradeReport) => Promise<boolean>;
  failGrade: (id: string, message: string) => Promise<boolean>;
  runSpecialist: typeof runSpecialist;
  limiter: Limiter;
};

// Imported lazily so the fast test can inject fakes without opening a DB pool.
async function defaultDeps(): Promise<PipelineDeps> {
  const q = await import("../../db/queries");
  return {
    getGrade: q.getGrade,
    setGradeSpecialist: q.setGradeSpecialist,
    completeGrade: q.completeGrade,
    failGrade: q.failGrade,
    runSpecialist,
    limiter: graderLimit,
  };
}

/**
 * Background grade run, started by POST /api/grades after the 202.
 * Five specialists run through the shared limiter; each result is written as
 * it lands so the pending screen ticks off. One failure aborts the rest and
 * fails the whole grade — a score missing a category would mislead.
 */
export async function runGradePipeline(id: string, injected?: PipelineDeps): Promise<void> {
  const deps = injected ?? (await defaultDeps());
  const runKey = `grade:${id}`;
  const signal = registerRun(runKey);
  // `local` also fires when a sibling fails; `signal` only on a user cancel,
  // which is how the catch below tells the two apart.
  const local = new AbortController();
  const forwardAbort = () => local.abort();
  signal.addEventListener("abort", forwardAbort, { once: true });
  // An object, not a `let`: TS narrows a `let` assigned only inside a callback
  // to `null` in the catch below, which makes the failure branch type `never`.
  const failure: { name: SpecialistName | null } = { name: null };

  try {
    const row = await deps.getGrade(id);
    if (!row || row.status !== "pending") return;
    const input = { resumeText: row.resume_text, targetRole: row.target_role, level: row.level, jdText: row.jd_text };

    const entries = await Promise.all(
      SPECIALISTS.map(async (name) => {
        try {
          const result = await deps.limiter.run(() => deps.runSpecialist(name, input, local.signal), local.signal);
          await deps.setGradeSpecialist(id, name, { status: "done", result });
          return [name, result] as const;
        } catch (err) {
          if (!local.signal.aborted) {
            failure.name = name;
            local.abort();
            await deps.setGradeSpecialist(id, name, { status: "failed" }).catch(() => {});
          }
          throw err;
        }
      })
    );

    const results = Object.fromEntries(entries) as Record<SpecialistName, SpecialistResult>;
    await deps.completeGrade(id, assembleReport(results, row.resume_text));
  } catch (err) {
    // POST /api/grades/:id/cancel already wrote 'cancelled'.
    if (signal.aborted) {
      console.log(`[grade] ${id} cancelled`);
      return;
    }
    console.error(`[grade] ${id} failed:`, err);
    const hint = LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    const message = failure.name
      ? `The ${SPECIALIST_LABELS[failure.name]} reviewer failed — ${hint} and try again.`
      : `Grading failed: ${err instanceof Error ? err.message : String(err)}`;
    await deps.failGrade(id, message).catch((e) => console.error(`[grade] ${id} could not record failure:`, e));
  } finally {
    signal.removeEventListener("abort", forwardAbort);
    clearRun(runKey);
  }
}
```

- [ ] **Step 8: Run the pipeline test to verify it passes**

Run: `cd packages/agent && npx tsx src/ai/grade/test-grade-pipeline.ts`
Expected: ends `✓ grade-pipeline test PASSED`. If it hangs, a sibling isn't honouring `local.signal`; if "failure message names the Recruiter reviewer" fails, check that `failure.name` is set before `local.abort()`.

- [ ] **Step 9: Write `api/routes/grades.ts`**

```ts
import { Router } from "express";
import multer from "multer";
import {
  cancelGrade,
  createGrade,
  deleteGrade,
  getGrade,
  getMasterResume,
  getTailoredResume,
  listGrades,
} from "../../db/queries";
import { abortRun } from "../../ai/cancellation";
import { isUuid, parseGradeRequest } from "../../ai/grade/request";
import { MAX_GRADE_TEXT_CHARS, extractPdfText, masterToText } from "../../ai/grade/resume-text";
import { runGradePipeline } from "../../ai/grade/pipeline";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// POST /api/grades — JSON for master/tailored/pasted text, multipart for a PDF upload.
// multer only touches multipart requests, so JSON bodies pass through untouched.
router.post("/", upload.single("file"), async (req, res) => {
  const parsed = parseGradeRequest({ ...(req.body ?? {}), hasFile: Boolean(req.file) });
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const input = parsed.value;

  let resumeText: string;
  let label: string;
  let jdText = input.jdText;
  try {
    if (input.source === "master") {
      resumeText = masterToText(await getMasterResume());
      label = "Master resume";
    } else if (input.source === "tailored") {
      const row = await getTailoredResume(input.resumeId!);
      if (!row) { res.status(404).json({ error: "That resume no longer exists." }); return; }
      resumeText = row.markdown ?? "";
      label = [row.company, row.job_title].filter(Boolean).join(" — ") || "Tailored resume";
      if (!jdText) jdText = row.jd_text?.trim() ?? "";
    } else if (req.file) {
      try {
        resumeText = await extractPdfText(req.file.buffer);
      } catch (err) {
        console.error("[grades] pdf text extraction failed:", err);
        res.status(400).json({ error: "Could not read text from the uploaded PDF." });
        return;
      }
      label = input.label ?? (req.file.originalname || "Uploaded resume");
    } else {
      resumeText = input.text ?? "";
      label = input.label ?? "Pasted resume";
    }
  } catch (err) {
    console.error("[grades] resolving resume failed:", err);
    res.status(500).json({ error: "Could not load the resume to grade." });
    return;
  }

  resumeText = resumeText.trim();
  if (!resumeText) {
    res.status(400).json({ error: "The resume is empty — there is nothing to grade." });
    return;
  }
  if (resumeText.length > MAX_GRADE_TEXT_CHARS) {
    res.status(400).json({ error: `The resume is too long to grade (max ${MAX_GRADE_TEXT_CHARS.toLocaleString()} characters).` });
    return;
  }

  let id: string;
  try {
    ({ id } = await createGrade({
      source: input.source,
      resumeId: input.resumeId,
      label,
      resumeText,
      targetRole: input.targetRole,
      level: input.level,
      jdText: jdText || null,
    }));
  } catch (err) {
    console.error("[grades] db error:", err);
    res.status(500).json({ error: "Failed to start grading — database error." });
    return;
  }

  // Five LLM calls can outlast Railway's ~300s edge timeout; run in the background.
  res.status(202).json({ id, status: "pending" });
  runGradePipeline(id).catch((err) => console.error("[grades] background pipeline crashed:", err));
});

// GET /api/grades[?resumeId=]
router.get("/", async (req, res) => {
  const resumeId = req.query.resumeId;
  if (resumeId !== undefined && !isUuid(resumeId)) {
    res.status(400).json({ error: "resumeId must be a resume id." });
    return;
  }
  res.json(await listGrades(resumeId as string | undefined));
});

// GET /api/grades/:id
router.get("/:id", async (req, res) => {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const row = await getGrade(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// POST /api/grades/:id/cancel
router.post("/:id/cancel", async (req, res) => {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const row = await getGrade(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status !== "pending") {
    res.status(409).json({ error: `Grade is ${row.status}, not running.` });
    return;
  }
  abortRun(`grade:${req.params.id}`);
  // Written here, not by the pipeline, so the page flips without waiting for a poll.
  // Also how an orphaned pending grade (process restarted) gets unstuck.
  try {
    if (!(await cancelGrade(req.params.id))) {
      const fresh = await getGrade(req.params.id);
      res.status(409).json({ error: `Grade already finished (${fresh?.status ?? "gone"}).` });
      return;
    }
  } catch (err) {
    console.error("[grades] cancel status write failed:", err);
    res.status(500).json({ error: "Cancelled the run but failed to update its status." });
    return;
  }
  res.json({ id: req.params.id, status: "cancelled" });
});

// DELETE /api/grades/:id
router.delete("/:id", async (req, res) => {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  abortRun(`grade:${req.params.id}`);
  if (!(await deleteGrade(req.params.id))) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

export default router;
```

Check how other routers handle a rejected `await` in an async handler (Express 4 does not catch them). If `resumes.ts` wraps handlers or the app has an error middleware, follow that; otherwise the explicit try/catch blocks above are the pattern.

- [ ] **Step 10: Mount the router**

In `packages/agent/src/api/index.ts` add `import gradesRouter from "./routes/grades";` and `router.use("/grades", gradesRouter);` after the `/review` mount.

- [ ] **Step 11: Write the live integration test**

`packages/agent/src/ai/grade/test-grade-live.ts`:

```ts
import "dotenv/config";
import { MASTER_RESUME } from "../master-resume";
import { masterToText } from "./resume-text";
import { runSpecialist } from "./specialists";
import { assembleReport } from "./assemble";
import { CATEGORIES, SPECIALISTS, SpecialistName, SpecialistResult } from "./rubric";

// Live LLM call — run manually via `npm run test:integration`, not in the fast gate.
async function main() {
  const resumeText = masterToText(MASTER_RESUME);
  const input = { resumeText, targetRole: "ml" as const, level: "intern" as const, jdText: null };
  const entries = await Promise.all(SPECIALISTS.map(async (s) => [s, await runSpecialist(s, input)] as const));
  const report = assembleReport(Object.fromEntries(entries) as Record<SpecialistName, SpecialistResult>, resumeText);

  const ok =
    report.categories.length === CATEGORIES.length &&
    report.score >= 0 && report.score <= 100 &&
    report.score === report.categories.reduce((s, c) => s + c.score, 0) &&
    report.findings.every((f) => f.title && f.problem && ["high", "medium", "low"].includes(f.severity));

  console.log(`score ${report.score}/100 —`, report.categories.map((c) => `${c.key} ${c.score}/${c.max}`).join(", "));
  console.log(`${report.findings.length} findings`);
  console.log(ok ? "\n✓ grade-live test PASSED" : "\n✗ grade-live test FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 12: Wire tests**

In `packages/agent/package.json` add:

```json
"test:grade-request": "tsx src/ai/grade/test-grade-request.ts",
"test:grade-pipeline": "tsx src/ai/grade/test-grade-pipeline.ts",
"test:grade-live": "tsx src/ai/grade/test-grade-live.ts",
```

Append ` && npm run test:grade-request && npm run test:grade-pipeline` to `"test"` and ` && npm run test:grade-live` to `"test:integration"`. Run `npx tsc --noEmit -p .` then `npm test` (agent) — expected: all green.

- [ ] **Step 13: Manual API check against local**

With Postgres up and `npm run dev:agent` running (and a valid `CLAUDE_CODE_OAUTH_TOKEN`), using the local `INTERNAL_API_SECRET` from `.env` and the agent's local port:

```bash
curl -s -X POST localhost:$PORT/api/grades -H "X-Internal-Secret: $INTERNAL_API_SECRET" -H 'content-type: application/json' \
  -d '{"source":"master","targetRole":"ml","level":"intern"}'
# → 202 {"id":"…","status":"pending"}
curl -s localhost:$PORT/api/grades/<id> -H "X-Internal-Secret: $INTERNAL_API_SECRET" | head -c 600
# repeat until status is "ready"; specialists entries flip to "done" one by one
curl -s -o /dev/null -w '%{http_code}\n' localhost:$PORT/api/grades/not-a-uuid -H "X-Internal-Secret: $INTERNAL_API_SECRET"
# → 404
```

Start a second grade and cancel it mid-run with `POST /api/grades/<id>/cancel`; expected: `{"status":"cancelled"}`, and the row stays `cancelled` after the run settles.

- [ ] **Step 14: Commit** (only if asked)

```bash
git add packages/agent/src/ai/grade packages/agent/src/api/routes/grades.ts packages/agent/src/api/index.ts packages/agent/package.json
git commit -m "feat(grade): background grading pipeline and /api/grades routes"
```

---

### Task 7: Web client types and pure helpers

**Files:**
- Modify: `packages/web/lib/api.ts`
- Create: `packages/web/lib/grade.ts`
- Test: `packages/web/lib/test-grade.ts`
- Modify: `packages/web/package.json`

**Interfaces:**
- Consumes: agent HTTP contract from Task 6.
- Produces (api.ts): types `TargetRole`, `Level`, `GradeSource`, `GradeStatus`, `GradeFinding`, `GradeCategory`, `GradeReport`, `SpecialistName`, `SpecialistState`, `GradeListItem`, `Grade`, `CreateGradeBody`; `api.createGrade(body)`, `api.createGradeFromPdf(file, fields)`, `api.listGrades(resumeId?)`, `api.getGrade(id)`, `api.cancelGrade(id)`, `api.deleteGrade(id)`.
- Produces (grade.ts): `ROLE_OPTIONS`, `LEVEL_OPTIONS`, `SPECIALIST_STEPS`, `MAX_FEEDBACK_CHARS = 12_000`, `findingsToFeedback(findings): { text: string; included: number }`, `defaultCheckedIds(findings): Set<string>`, `STALE_PENDING_MS`, `isStalePending(grade, now?)`, `rerunBody(grade): CreateGradeBody`, `roleLabel(role)`, `levelLabel(level)`.

- [ ] **Step 1: Add types and wrappers to `lib/api.ts`**

After the existing type declarations (before `async function request`):

```ts
export type TargetRole = "swe" | "frontend" | "backend" | "fullstack" | "mobile" | "devops" | "data" | "ml";
export type Level = "intern" | "entry" | "mid" | "senior" | "staff";
export type GradeSource = "master" | "tailored" | "upload";
export type GradeStatus = "pending" | "ready" | "failed" | "cancelled";
export type SpecialistName = "recruiter" | "ats" | "content" | "domain" | "storyteller";
export type CategoryKey = "ats" | "content" | "writing" | "job" | "readiness";

export type GradeFinding = {
  id: string;
  category: CategoryKey;
  title: string;
  severity: "high" | "medium" | "low";
  quote: string | null;
  problem: string;
  rewrite: string | null;
  groundedness: "grounded" | "needs-your-input";
};

export type GradeCategory = { key: CategoryKey; label: string; score: number; max: number; summary: string };
export type GradeReport = { score: number; categories: GradeCategory[]; findings: GradeFinding[] };
export type SpecialistState = { status: "pending" | "done" | "failed" };

export type GradeListItem = {
  id: string;
  label: string;
  source: GradeSource;
  resume_id: string | null;
  target_role: TargetRole;
  level: Level;
  status: GradeStatus;
  score: number | null;
  created_at: string;
};

export type Grade = GradeListItem & {
  resume_text: string;
  jd_text: string | null;
  specialists: Partial<Record<SpecialistName, SpecialistState>>;
  report: GradeReport | null;
  error: string | null;
  updated_at: string;
};

export type CreateGradeBody = {
  source: GradeSource;
  resumeId?: string;
  text?: string;
  label?: string;
  targetRole: TargetRole;
  level: Level;
  jdText?: string;
};
```

Inside the `api` object, after `submitFeedback`:

```ts
  createGrade: (body: CreateGradeBody) =>
    request<{ id: string; status: "pending" }>("POST", "/grades", body),
  createGradeFromPdf: (file: File, fields: { targetRole: TargetRole; level: Level; jdText?: string }) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("source", "upload");
    fd.append("targetRole", fields.targetRole);
    fd.append("level", fields.level);
    if (fields.jdText) fd.append("jdText", fields.jdText);
    return requestFormData<{ id: string; status: "pending" }>("POST", "/grades", fd);
  },
  listGrades: (resumeId?: string) =>
    request<GradeListItem[]>("GET", resumeId ? `/grades?resumeId=${encodeURIComponent(resumeId)}` : "/grades"),
  getGrade: (id: string) => request<Grade>("GET", `/grades/${id}`),
  cancelGrade: (id: string) => request<{ id: string; status: "cancelled" }>("POST", `/grades/${id}/cancel`),
  deleteGrade: (id: string) => request<void>("DELETE", `/grades/${id}`),
```

- [ ] **Step 2: Write the failing helper test**

`packages/web/lib/test-grade.ts`:

```ts
import { findingsToFeedback, defaultCheckedIds, isStalePending, rerunBody, MAX_FEEDBACK_CHARS, STALE_PENDING_MS } from "./grade";
import type { Grade, GradeFinding } from "./api";

let pass = true;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) { pass = false; console.log(`   ✗ [${label}] ${detail ?? "failed"}`); }
}

const finding = (id: string, severity: GradeFinding["severity"], extra: Partial<GradeFinding> = {}): GradeFinding => ({
  id, category: "content", title: `Title ${id}`, severity, quote: null, problem: `Problem ${id}.`,
  rewrite: null, groundedness: "grounded", ...extra,
});

// Feedback formatting
const fb = findingsToFeedback([
  finding("a", "high", { quote: "Built stuff", rewrite: "Built [N] services" }),
  finding("b", "low"),
]);
check("includes title and problem", fb.text.includes("Title a — Problem a."));
check("includes the quoted line", fb.text.includes('"Built stuff"'));
check("includes the suggestion", fb.text.includes("Suggested: Built [N] services"));
check("omits Suggested when there is no rewrite", !fb.text.includes("Title b — Problem b.\n   Suggested"));
check("counts included findings", fb.included === 2);

const many = Array.from({ length: 60 }, (_, i) => finding(`f${i}`, "high", { problem: "x".repeat(400) }));
const capped = findingsToFeedback(many);
check("stays within the feedback route's limit", capped.text.length <= MAX_FEEDBACK_CHARS, `${capped.text.length}`);
check("truncates to whole findings", capped.included < 60 && capped.included > 0);
check("never cuts a finding mid-way", !capped.text.includes(`Title f${capped.included}`));

// Default selection
const checked = defaultCheckedIds([finding("h", "high"), finding("m", "medium"), finding("l", "low")]);
check("high and medium pre-checked, low not", checked.has("h") && checked.has("m") && !checked.has("l"));

// Staleness
const base = { status: "pending", created_at: new Date(0).toISOString() } as Pick<Grade, "status" | "created_at">;
check("pending older than 10 min is stale", isStalePending(base, STALE_PENDING_MS + 1));
check("fresh pending is not stale", !isStalePending(base, 1000));
check("ready is never stale", !isStalePending({ ...base, status: "ready" }, STALE_PENDING_MS * 10));

// Re-run bodies
const g = (over: Partial<Grade>): Grade => ({
  id: "g", label: "Databricks — SWE Intern", source: "tailored", resume_id: "r1", target_role: "ml",
  level: "intern", status: "ready", score: 80, created_at: "", updated_at: "", resume_text: "snapshot text",
  jd_text: "JD", specialists: {}, report: null, error: null, ...over,
});
const tailored = rerunBody(g({}));
check("tailored re-run targets the resume", tailored.source === "tailored" && tailored.resumeId === "r1" && tailored.jdText === "JD");
const orphan = rerunBody(g({ resume_id: null }));
check("deleted tailored resume falls back to the snapshot",
  orphan.source === "upload" && orphan.text === "snapshot text" && orphan.label === "Databricks — SWE Intern");
const master = rerunBody(g({ source: "master", resume_id: null, jd_text: null }));
check("master re-run re-reads the master", master.source === "master" && master.text === undefined && master.jdText === undefined);
const upload = rerunBody(g({ source: "upload", resume_id: null, label: "old.pdf" }));
check("upload re-run resends the snapshot", upload.source === "upload" && upload.text === "snapshot text" && upload.label === "old.pdf");

console.log(pass ? "\n✓ grade helpers test PASSED" : "\n✗ grade helpers test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/web && npx tsx lib/test-grade.ts`
Expected: FAIL — `Cannot find module './grade'`.

- [ ] **Step 4: Write `lib/grade.ts`**

```ts
import type { CreateGradeBody, Grade, GradeFinding, Level, SpecialistName, TargetRole } from "./api";

/** Mirrors agent/src/ai/grade/rubric.ts — keep the two in sync. */
export const ROLE_OPTIONS: { value: TargetRole; label: string }[] = [
  { value: "swe", label: "Software Engineer" },
  { value: "frontend", label: "Frontend" },
  { value: "backend", label: "Backend" },
  { value: "fullstack", label: "Full-Stack" },
  { value: "mobile", label: "Mobile" },
  { value: "devops", label: "DevOps" },
  { value: "data", label: "Data" },
  { value: "ml", label: "ML / AI" },
];

export const LEVEL_OPTIONS: { value: Level; label: string }[] = [
  { value: "intern", label: "Intern" },
  { value: "entry", label: "Entry (0–2y)" },
  { value: "mid", label: "Mid (3–5y)" },
  { value: "senior", label: "Senior (6–10y)" },
  { value: "staff", label: "Staff+ (10y+)" },
];

export const roleLabel = (r: TargetRole) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;
export const levelLabel = (l: Level) => LEVEL_OPTIONS.find((o) => o.value === l)?.label ?? l;

export const SPECIALIST_STEPS: { name: SpecialistName; label: string; detail: string }[] = [
  { name: "recruiter", label: "Recruiter", detail: "First-impression skim and writing" },
  { name: "ats", label: "ATS", detail: "Parseability and structure" },
  { name: "content", label: "Content", detail: "Bullet strength and impact" },
  { name: "domain", label: "Domain", detail: "Fit for the target role" },
  { name: "storyteller", label: "Storyteller", detail: "Timeline and narrative" },
];

/** POST /api/resume/:id/feedback rejects anything longer (agent MAX_PASTE_CHARS). */
export const MAX_FEEDBACK_CHARS = 12_000;

/**
 * Formats checked findings as feedback for the existing feedback round. Drops
 * whole findings from the end rather than cutting one mid-sentence when the
 * route's length limit would be exceeded; `included` lets the UI say so.
 */
export function findingsToFeedback(findings: GradeFinding[]): { text: string; included: number } {
  let text = "Fix these issues from a resume review:\n";
  let included = 0;
  for (const f of findings) {
    const block = [
      `\n${included + 1}. ${f.title} — ${f.problem}`,
      f.quote ? `\n   Line: "${f.quote}"` : "",
      f.rewrite ? `\n   Suggested: ${f.rewrite}` : "",
    ].join("");
    if (text.length + block.length > MAX_FEEDBACK_CHARS) break;
    text += block;
    included++;
  }
  return { text, included };
}

export function defaultCheckedIds(findings: GradeFinding[]): Set<string> {
  return new Set(findings.filter((f) => f.severity !== "low").map((f) => f.id));
}

/** A process restart orphans a pending grade; after this long, offer Re-run. */
export const STALE_PENDING_MS = 10 * 60 * 1000;

export function isStalePending(g: Pick<Grade, "status" | "created_at">, now = Date.now()): boolean {
  return g.status === "pending" && now - new Date(g.created_at).getTime() > STALE_PENDING_MS;
}

/**
 * Same inputs as the original grade. Master and tailored re-read the current
 * resume (so edits show up as score movement); an upload — or a tailored grade
 * whose resume was deleted since — resends the stored snapshot.
 */
export function rerunBody(g: Grade): CreateGradeBody {
  const base = { targetRole: g.target_role, level: g.level, jdText: g.jd_text ?? undefined };
  if (g.source === "master") return { ...base, source: "master" };
  if (g.source === "tailored" && g.resume_id) return { ...base, source: "tailored", resumeId: g.resume_id };
  return { ...base, source: "upload", text: g.resume_text, label: g.label };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd packages/web && npx tsx lib/test-grade.ts`
Expected: ends `✓ grade helpers test PASSED`.

- [ ] **Step 6: Wire into web `npm test`**

In `packages/web/package.json` add `"test:grade": "tsx lib/test-grade.ts"` and append ` && npm run test:grade` to `"test"`.

- [ ] **Step 7: Commit** (only if asked)

```bash
git add packages/web/lib/api.ts packages/web/lib/grade.ts packages/web/lib/test-grade.ts packages/web/package.json
git commit -m "feat(grade): web client types and grade helpers"
```

---

### Task 8: Grader pages, components, nav and entry point

**Files:**
- Create: `packages/web/components/GradeForm.tsx`
- Create: `packages/web/components/GradeProgress.tsx`
- Create: `packages/web/components/GradeReport.tsx`
- Create: `packages/web/components/GradeView.tsx`
- Create: `packages/web/app/grader/page.tsx`
- Create: `packages/web/app/grader/[id]/page.tsx`
- Modify: `packages/web/components/Nav.tsx`
- Modify: `packages/web/components/ResumeEditor.tsx` (toolbar, after the "Email to me" button)

**Interfaces:**
- Consumes: Task 7's `api.*` grade wrappers, types and `lib/grade.ts` helpers; `api.listResumes()`, `api.getResume(id)`, `api.submitFeedback(id, text)`.
- Produces: routes `/grader` (accepts `?resumeId=`) and `/grader/[id]`.

Styling: copy class patterns from existing components — headers `font-serif text-3xl text-foreground` with `text-sm text-gray-500` subtitles, bordered controls `border border-paper-border rounded-lg hover:bg-black/[0.03] text-paper-ink`, primary buttons `bg-violet-600 hover:bg-violet-700 text-white`, error boxes `bg-red-50 border border-red-200 text-red-700`. Page padding `px-8 py-8`. Light backgrounds only.

- [ ] **Step 1: `GradeForm.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Level, ResumeListItem, TargetRole } from "../lib/api";
import { LEVEL_OPTIONS, ROLE_OPTIONS } from "../lib/grade";

type Mode = "master" | "tailored" | "paste" | "pdf";
const LAST_KEY = "grader:last";

function Chips<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
            value === o.value
              ? "border-violet-400 bg-violet-50 text-violet-800"
              : "border-paper-border hover:bg-black/[0.03] text-paper-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function GradeForm({ resumes, initialResumeId }: { resumes: ResumeListItem[]; initialResumeId?: string }) {
  const router = useRouter();
  // Only finished resumes have final Markdown worth grading.
  const gradeable = resumes.filter((r) => r.status === "ready");
  const initialTailored = gradeable.some((r) => r.id === initialResumeId) ? initialResumeId! : "";

  const [mode, setMode] = useState<Mode>(initialTailored ? "tailored" : "master");
  const [resumeId, setResumeId] = useState(initialTailored || gradeable[0]?.id || "");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [role, setRole] = useState<TargetRole>("swe");
  const [level, setLevel] = useState<Level>("intern");
  const [showJd, setShowJd] = useState(false);
  const [jd, setJd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
      if (saved?.role && ROLE_OPTIONS.some((o) => o.value === saved.role)) setRole(saved.role);
      if (saved?.level && LEVEL_OPTIONS.some((o) => o.value === saved.level)) setLevel(saved.level);
    } catch { /* storage unavailable — keep defaults */ }
  }, []);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ role, level })); } catch { /* ignore */ }
    const jdText = showJd && jd.trim() ? jd.trim() : undefined;
    try {
      const { id } =
        mode === "pdf"
          ? await api.createGradeFromPdf(file!, { targetRole: role, level, jdText })
          : await api.createGrade(
              mode === "master"
                ? { source: "master", targetRole: role, level, jdText }
                : mode === "tailored"
                ? { source: "tailored", resumeId, targetRole: role, level, jdText }
                : { source: "upload", text, targetRole: role, level, jdText }
            );
      router.push(`/grader/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start grading.");
      setSubmitting(false);
    }
  }

  const ready =
    mode === "master" ||
    (mode === "tailored" && resumeId) ||
    (mode === "paste" && text.trim()) ||
    (mode === "pdf" && file);

  return (
    <div className="border border-paper-border rounded-xl bg-white p-6 space-y-5">
      <div>
        <p className="text-sm font-medium text-paper-ink mb-2">Resume</p>
        <Chips
          options={[
            { value: "master" as Mode, label: "Master resume" },
            ...(gradeable.length ? [{ value: "tailored" as Mode, label: "A tailored resume" }] : []),
            { value: "paste" as Mode, label: "Paste text" },
            { value: "pdf" as Mode, label: "Upload PDF" },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === "tailored" && (
          <select
            value={resumeId}
            onChange={(e) => setResumeId(e.target.value)}
            className="mt-3 w-full text-sm border border-paper-border rounded-lg px-3 py-2 bg-white text-paper-ink"
          >
            {gradeable.map((r) => (
              <option key={r.id} value={r.id}>
                {[r.company, r.job_title].filter(Boolean).join(" — ") || "Untitled resume"}
              </option>
            ))}
          </select>
        )}
        {mode === "paste" && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder="Paste the resume text"
            className="mt-3 w-full text-sm border border-paper-border rounded-lg px-3 py-2 bg-white text-paper-ink"
          />
        )}
        {mode === "pdf" && (
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-3 block text-sm text-paper-ink"
          />
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-paper-ink mb-2">Target role</p>
        <Chips options={ROLE_OPTIONS} value={role} onChange={setRole} />
      </div>

      <div>
        <p className="text-sm font-medium text-paper-ink mb-2">Experience level</p>
        <Chips options={LEVEL_OPTIONS} value={level} onChange={setLevel} />
      </div>

      <div>
        <button type="button" onClick={() => setShowJd((v) => !v)} className="text-sm text-violet-700 hover:underline">
          {showJd ? "− Remove job description" : "+ Add a job description (optional)"}
        </button>
        {mode === "tailored" && !showJd && (
          <p className="text-xs text-gray-500 mt-1">Leave empty to use the job description this resume was tailored for.</p>
        )}
        {showJd && (
          <textarea
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            rows={6}
            placeholder="Paste the job description"
            className="mt-2 w-full text-sm border border-paper-border rounded-lg px-3 py-2 bg-white text-paper-ink"
          />
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!ready || submitting}
        className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        {submitting ? "Starting…" : "Grade resume"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `GradeProgress.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import type { Grade } from "../lib/api";
import { SPECIALIST_STEPS, isStalePending } from "../lib/grade";

export default function GradeProgress({ grade, onCancel, onRerun, busy }: {
  grade: Grade; onCancel: () => void; onRerun: () => void; busy: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.round((now - new Date(grade.created_at).getTime()) / 1000));
  const stale = isStalePending(grade, now);

  return (
    <div className="border border-paper-border rounded-xl bg-white p-6 max-w-xl">
      <p className="text-sm text-gray-500 mb-4">
        Five reviewers are reading your resume — usually about a minute. {elapsed}s elapsed.
      </p>
      <ul className="space-y-3">
        {SPECIALIST_STEPS.map((s) => {
          const status = grade.specialists[s.name]?.status ?? "pending";
          return (
            <li key={s.name} className="flex items-center gap-3">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                  status === "done" ? "bg-green-100 text-green-700"
                  : status === "failed" ? "bg-red-100 text-red-700"
                  : "bg-gray-100 text-gray-400 animate-pulse"
                }`}
              >
                {status === "done" ? "✓" : status === "failed" ? "!" : "•"}
              </span>
              <span className="text-sm text-paper-ink font-medium">{s.label}</span>
              <span className="text-sm text-gray-500">{s.detail}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex gap-2">
        {stale ? (
          <>
            <p className="text-sm text-gray-500 self-center mr-2">This grade looks stuck (the server may have restarted).</p>
            <button onClick={onRerun} disabled={busy}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
              Re-run
            </button>
          </>
        ) : (
          <button onClick={onCancel} disabled={busy}
            className="text-sm px-3 py-1.5 border border-paper-border rounded-lg hover:bg-black/[0.03] disabled:opacity-50 text-paper-ink">
            {busy ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `GradeReport.tsx`**

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Grade, GradeFinding, GradeReport as Report } from "../lib/api";
import { defaultCheckedIds, findingsToFeedback } from "../lib/grade";

const SEVERITY_STYLE: Record<GradeFinding["severity"], string> = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-gray-50 text-gray-600 border-gray-200",
};

function scoreTone(score: number, max: number) {
  const r = score / max;
  return r >= 0.8 ? "bg-green-500" : r >= 0.6 ? "bg-amber-500" : "bg-red-500";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      className="text-xs px-2 py-1 border border-paper-border rounded-md hover:bg-black/[0.03] text-paper-ink"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

export default function GradeReport({ grade, report }: { grade: Grade; report: Report }) {
  const router = useRouter();
  const canFix = grade.source === "tailored" && grade.resume_id !== null;
  const [checked, setChecked] = useState(() => defaultCheckedIds(report.findings));
  const [resumeStatus, setResumeStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelFor = useMemo(() => new Map(report.categories.map((c) => [c.key, c.label])), [report]);

  useEffect(() => {
    if (!canFix) return;
    api.getResume(grade.resume_id!).then((r) => setResumeStatus(r.status)).catch(() => setResumeStatus("missing"));
  }, [canFix, grade.resume_id]);

  const selected = report.findings.filter((f) => checked.has(f.id));
  const feedback = findingsToFeedback(selected);

  async function fix() {
    setSending(true);
    setError(null);
    try {
      await api.submitFeedback(grade.resume_id!, feedback.text);
      router.push(`/resume/${grade.resume_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the feedback round.");
      setSending(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row gap-8">
        <div className="border border-paper-border rounded-xl bg-white p-6 flex flex-col items-center justify-center min-w-[180px]">
          <span className="font-serif text-6xl text-foreground">{report.score}</span>
          <span className="text-sm text-gray-500">out of 100</span>
        </div>
        <div className="flex-1 border border-paper-border rounded-xl bg-white p-6 space-y-4">
          {report.categories.map((c) => (
            <div key={c.key}>
              <div className="flex justify-between text-sm">
                <span className="font-medium text-paper-ink">{c.label}</span>
                <span className="text-gray-500">{c.score}/{c.max}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full mt-1 overflow-hidden">
                <div className={`h-full ${scoreTone(c.score, c.max)}`} style={{ width: `${(c.score / c.max) * 100}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">{c.summary}</p>
            </div>
          ))}
        </div>
      </div>

      {canFix && (
        <div className="border border-paper-border rounded-xl bg-white p-4 flex flex-wrap items-center gap-3">
          <button
            onClick={fix}
            disabled={sending || resumeStatus !== "ready" || selected.length === 0}
            className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {sending ? "Sending…" : `Fix ${feedback.included} in the resume`}
          </button>
          <span className="text-sm text-gray-500">
            {resumeStatus === "missing" ? "That resume was deleted."
              : resumeStatus && resumeStatus !== "ready" ? "Finish the resume's current round first — feedback only applies to a finished resume."
              : feedback.included < selected.length ? `Only the first ${feedback.included} of ${selected.length} checked findings fit in one feedback round.`
              : "Checked findings become a feedback round you review on the resume page."}
          </span>
          {error && <span className="text-sm text-red-700">{error}</span>}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-serif text-xl text-foreground">{report.findings.length} findings</h2>
        {report.findings.map((f) => (
          <div key={f.id} className="border border-paper-border rounded-xl bg-white p-5">
            <div className="flex items-start gap-3">
              {canFix && (
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked.has(f.id)}
                  onChange={(e) => {
                    const next = new Set(checked);
                    if (e.target.checked) next.add(f.id); else next.delete(f.id);
                    setChecked(next);
                  }}
                />
              )}
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-md border ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
                  <span className="text-xs text-gray-500">{labelFor.get(f.category)}</span>
                </div>
                <p className="font-medium text-paper-ink">{f.title}</p>
                {f.quote && <blockquote className="text-sm text-gray-600 border-l-2 border-gray-200 pl-3">{f.quote}</blockquote>}
                <p className="text-sm text-paper-ink">{f.problem}</p>
                {f.rewrite && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-md border ${
                        f.groundedness === "grounded"
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-amber-50 text-amber-800 border-amber-200"
                      }`}>
                        {f.groundedness === "grounded" ? "Uses your facts" : "Needs your input"}
                      </span>
                      <CopyButton text={f.rewrite} />
                    </div>
                    <p className="text-sm text-paper-ink">{f.rewrite}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `GradeView.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Grade } from "../lib/api";
import { levelLabel, rerunBody, roleLabel } from "../lib/grade";
import GradeProgress from "./GradeProgress";
import GradeReport from "./GradeReport";

export default function GradeView({ initial }: { initial: Grade }) {
  const router = useRouter();
  const [grade, setGrade] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (grade.status !== "pending") return;
    const t = setInterval(() => {
      api.getGrade(grade.id).then(setGrade).catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [grade.id, grade.status]);

  async function rerun() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createGrade(rerunBody(grade));
      router.push(`/grader/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-run.");
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await api.cancelGrade(grade.id);
    } catch { /* already finished — the refetch shows the real state */ }
    setGrade(await api.getGrade(grade.id));
    setBusy(false);
  }

  async function remove() {
    await api.deleteGrade(grade.id);
    router.push("/grader");
    router.refresh();
  }

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/grader" className="text-sm text-gray-500 hover:underline">← Grader</Link>
          <h1 className="font-serif text-3xl text-foreground mt-1">{grade.label}</h1>
          <p className="text-sm text-gray-500 mt-1.5">
            {roleLabel(grade.target_role)} · {levelLabel(grade.level)}
            {grade.jd_text ? " · with job description" : ""} · {new Date(grade.created_at).toLocaleString()}
          </p>
        </div>
        {grade.status !== "pending" && (
          <div className="flex gap-2">
            <button onClick={rerun} disabled={busy}
              className="text-sm px-3 py-1.5 border border-paper-border rounded-lg hover:bg-black/[0.03] disabled:opacity-50 text-paper-ink">
              Re-run
            </button>
            {confirmDelete ? (
              <button onClick={remove} className="text-sm px-3 py-1.5 border border-red-200 bg-red-50 text-red-700 rounded-lg">
                Confirm delete
              </button>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="text-sm px-3 py-1.5 border border-paper-border rounded-lg hover:bg-black/[0.03] text-paper-ink">
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {grade.status === "pending" && <GradeProgress grade={grade} onCancel={cancel} onRerun={rerun} busy={busy} />}
      {grade.status === "ready" && grade.report && <GradeReport grade={grade} report={grade.report} />}
      {(grade.status === "failed" || grade.status === "cancelled") && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm max-w-xl">
          {grade.status === "cancelled" ? "This grade was cancelled." : grade.error ?? "Grading failed."} Use Re-run to try again.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Pages**

`packages/web/app/grader/page.tsx`:

```tsx
import Link from "next/link";
import { api, GradeListItem, ResumeListItem } from "../../lib/api";
import GradeForm from "../../components/GradeForm";
import { levelLabel, roleLabel } from "../../lib/grade";

type Props = { searchParams: Promise<{ resumeId?: string }> };

export default async function GraderPage({ searchParams }: Props) {
  const { resumeId } = await searchParams;
  let resumes: ResumeListItem[] = [];
  let grades: GradeListItem[] = [];
  let error: string | null = null;
  try {
    [resumes, grades] = await Promise.all([api.listResumes(), api.listGrades()]);
  } catch {
    error = "Could not load the grader — make sure the agent server is running.";
  }

  return (
    <div className="px-8 py-8 space-y-8 max-w-4xl">
      <div>
        <h1 className="font-serif text-3xl text-foreground">Resume Grader</h1>
        <p className="text-sm text-gray-500 mt-1.5">
          Five reviewers score your resume out of 100 and list every fix, with rewrites you can paste.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      <GradeForm resumes={resumes} initialResumeId={resumeId} />

      {grades.length > 0 && (
        <div>
          <h2 className="font-serif text-xl text-foreground mb-3">History</h2>
          <ul className="border border-paper-border rounded-xl bg-white divide-y divide-paper-border">
            {grades.map((g) => (
              <li key={g.id}>
                <Link href={`/grader/${g.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.02]">
                  <div>
                    <p className="text-sm font-medium text-paper-ink">{g.label}</p>
                    <p className="text-xs text-gray-500">
                      {roleLabel(g.target_role)} · {levelLabel(g.level)} · {new Date(g.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-sm text-paper-ink">
                    {g.status === "ready" ? `${g.score}/100` : g.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

`packages/web/app/grader/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { api } from "../../../lib/api";
import GradeView from "../../../components/GradeView";

type Props = { params: Promise<{ id: string }> };

export default async function GradePage({ params }: Props) {
  const { id } = await params;
  let grade;
  try {
    grade = await api.getGrade(id);
  } catch {
    notFound();
  }
  return <GradeView initial={grade} />;
}
```

- [ ] **Step 6: Nav item**

In `packages/web/components/Nav.tsx`, add an icon next to the others:

```tsx
function GaugeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  );
}
```

and add `{ href: "/grader", label: "Grader", Icon: GaugeIcon },` to `navLinks` right after the `/tailor` entry.

- [ ] **Step 7: Entry point on `/resume/[id]`**

In `packages/web/components/ResumeEditor.tsx`, right after the "Email to me" `</button>` (around line 791), add:

```tsx
          <Link
            href={`/grader?resumeId=${resume.id}`}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-paper-border rounded-lg hover:bg-black/[0.03] transition-colors text-paper-ink"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 14 4-4" />
              <path d="M3.34 19a10 10 0 1 1 17.32 0" />
            </svg>
            Grade
          </Link>
```

(`Link` is already imported at the top of the file.)

- [ ] **Step 8: Build and lint**

Run: `cd packages/web && npx tsc --noEmit && npm run lint && npm run build`
Expected: no type errors, no lint errors, build lists `/grader` and `/grader/[id]`.

- [ ] **Step 9: Verify in the browser**

Run the agent and web locally (`/run` skill or `npm run dev:agent` + `npm run dev:web`). Sign in, then:
1. Sidebar shows **Grader**; `/grader` renders the form on a light background.
2. Grade the master resume as ML / AI · Intern → lands on `/grader/<id>`, checklist ticks off, report appears with five bars summing to the big score.
3. Copy on a rewrite puts the text on the clipboard; "Needs your input" appears on any rewrite with `[…]`.
4. From a ready `/resume/<id>`, click **Grade** → form preselects that resume → grade → "Fix N in the resume" → lands on the resume page in the feedback round.
5. Start a grade and click Cancel → "This grade was cancelled." → Re-run starts a new one.
6. Reload the grader: last role/level are remembered; history lists the grades with scores.

- [ ] **Step 10: Commit** (only if asked)

```bash
git add packages/web/app/grader packages/web/components/Grade*.tsx packages/web/components/Nav.tsx packages/web/components/ResumeEditor.tsx
git commit -m "feat(grade): /grader pages, report UI and entry points"
```

---

### Task 9: Docs and final verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-10-17-resume-grader-design.md` (Status line → `Approved; implemented`)

- [ ] **Step 1: Update `CLAUDE.md`**

- **What's Already Built:** add a "Resume grader" bullet — `/grader` scores a resume (master, a tailored one, pasted text or a PDF) out of 100 across five categories (ATS & structure 25, Content quality 35, Writing quality 10, Job optimization 20, Application readiness 10), each from one specialist LLM call (`ai/grade/`), at most 2 in flight via `graderLimit`; `assembleReport` is deterministic (no 6th call) and labels each rewrite grounded / needs-your-input with `numbers()`; findings on a tailored resume can be sent into the existing feedback round. No percentile curve — there is no corpus to rank against.
- **Web app flows table:** add `/grader` (start a grade + history) and `/grader/[id]` (progress, report, Re-run, "Fix these in the resume").
- **Agent layout tree:** add `ai/grade/` with one line per file (`rubric.ts`, `specialists.ts`, `assemble.ts`, `limit.ts`, `resume-text.ts`, `request.ts`, `pipeline.ts`) and `grades.ts` to the routes list.
- **Web layout tree:** add `app/grader/page.tsx`, `app/grader/[id]/page.tsx`, the four `Grade*.tsx` components and `lib/grade.ts`.
- **Database Schema:** add the `resume_grades` block from the spec.
- **Core Pipelines:** add a "Resume grading" block:

```
POST /api/grades { source, resumeId? | text? | file?, targetRole, level, jdText? }
  → resolve resume text (master → masterToText; tailored → row.markdown, JD defaults to row.jd_text; upload → text or PDF)
    → insert resume_grades row (status='pending', all specialists 'pending'), respond 202
      → [background] runGradePipeline(id) — run key `grade:${id}`
          5 specialists via completeJSON through graderLimit (max 2 in flight)
            → each result written to specialists[name] as it lands (drives the checklist)
          one failure aborts the rest → status='failed' naming the reviewer
          assembleReport (pure) → status='ready', score, report
  → /grader/[id] polls GET /api/grades/:id; POST /api/grades/:id/cancel writes 'cancelled' itself
```

- [ ] **Step 2: Full fast gate**

Run (repo root): `npm test`
Expected: every agent and web test passes, including `test:grade-prompts`, `test:grade-assemble`, `test:grade-limit`, `test:resume-text`, `test:grade-request`, `test:grade-pipeline`, `test:grade`.

- [ ] **Step 3: Live check**

Run: `cd packages/agent && npm run test:grade-live`
Expected: prints a score and five category scores, ends `✓ grade-live test PASSED`.

- [ ] **Step 4: Review**

Run the `/code-review` skill on the branch and fix confirmed findings.

- [ ] **Step 5: Commit and PR** (only when the user asks)

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-17-resume-grader-design.md docs/superpowers/plans/2026-10-17-resume-grader.md
git commit -m "docs: resume grader in CLAUDE.md"
git push -u origin feat/resume-grader
gh pr create --title "feat: resume grader" --body "…"
```

After merge: grade the production master resume as ML / AI · Intern and compare with ResuMax's 20/30/8/18/5.
