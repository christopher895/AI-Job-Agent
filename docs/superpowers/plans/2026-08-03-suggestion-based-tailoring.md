# Suggestion-Based Tailoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-job tailoring's 3-pass generate→critique→revise rewrite with a single-pass keyword-suggestion step: the AI proposes a short list of targeted JD-keyword insertions against the fixed, one-page master resume, and Christopher explicitly approves/edits/rejects each one before anything is applied.

**Architecture:** `POST /api/tailor` still creates a row and responds `202` immediately, but the background job now calls a single new `suggestKeywords()` LLM call instead of the old 3-pass loop, storing the result and flipping `status` to a new `awaiting_review` state. The frontend (already polling, unchanged mechanism) renders a checklist instead of a spinner once it sees that status. Accepting a subset and submitting calls a new `POST /api/resume/:id/apply-suggestions`, which re-enters the exact same `pending`-then-`ready` pattern the app already uses everywhere, reusing the existing `fitToOnePage`/`renderPdf`/polling machinery unchanged. The old `chain.ts`/`critic.ts`/`tailor.ts` 3-pass loop is untouched and stays in use only by the dormant general-resume backend (its UI was already removed in a separate plan).

**Tech Stack:** Express, Zod, PostgreSQL (`pg`), Next.js/React.

## Global Constraints

- The master resume is never reordered, cut, or restructured by this flow — every experience/project bullet is included, in master order, for every job. Only accepted `bullet-rewrite`/`skill-addition` suggestions change anything.
- `groundedness` (`"grounded"` vs `"extrapolated"`) is computed **deterministically** after the LLM call, not self-reported by the model — see Task 3.
- Reuse the existing `renderMarkdown(master, tailored)` (`format.ts`) and `fitToOnePage()` (`fit-page.ts`) unchanged; do not build a parallel rendering path.
- `chain.ts`, `critic.ts`, and the old `tailor.ts` (`tailorResume`) are not modified — they remain the general-resume path's implementation, dormant per the UI-removal plan.
- No test runner exists for `packages/web`; frontend steps are verified by `npx tsc --noEmit` + manual QA. Agent-side pure logic gets `tsx`-run test scripts following this repo's convention (`test-grounding.ts` style: manual assertions, `process.exit(pass ? 0 : 1)`).

---

### Task 1: Schema migration + `queries.ts` support for suggestions and `awaiting_review`

**Files:**
- Modify: `packages/agent/src/db/schema.ts`
- Modify: `packages/agent/src/db/queries.ts`

**Interfaces:**
- Produces: `TailoredResumeRow.suggestions: Suggestion[] | null` and `TailoredResumeRow.status` widened to include `"awaiting_review"`; new query functions `setSuggestions(id, suggestions)`, `beginApplyingSuggestions(id)`, and `completeTailoredResume`'s `fields` gains an optional `suggestions` param — consumed by Tasks 5 and 6.

- [ ] **Step 1: Add the `suggestions` column and widen the status check**

In `packages/agent/src/db/schema.ts`, right after the existing `stage` column migration (around line 169), add:
```ts
  // The suggestion-based tailoring flow (POST /api/tailor -> awaiting_review ->
  // POST /api/resume/:id/apply-suggestions -> ready) stores its proposed keyword
  // insertions here so the checklist can be re-rendered on reload and so accepted
  // suggestions stay auditable after they're applied.
  await pool.query(`
    ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS suggestions JSONB;
  `);
  await pool.query(`
    ALTER TABLE tailored_resumes DROP CONSTRAINT IF EXISTS tailored_resumes_status_check;
    ALTER TABLE tailored_resumes ADD CONSTRAINT tailored_resumes_status_check
      CHECK (status IN ('pending','awaiting_review','ready','failed'));
  `);
```

- [ ] **Step 2: Update `TailoredResumeRow` and add the `Suggestion` import**

In `packages/agent/src/db/queries.ts`:
```diff
 import { pool } from "./pool";
-import { MasterResume, MasterResumeSchema } from "../ai/types";
+import { MasterResume, MasterResumeSchema, Suggestion } from "../ai/types";
 import { Preferences, FILTERS } from "../config";

 export type TailoredResumeRow = {
   id: string;
   job_title: string | null;
   company: string | null;
   location: string | null;
   job_url: string | null;
   jd_text: string | null;
   markdown: string;
   critic_score: number | null;
   pdf_error: string | null;
-  status: "pending" | "ready" | "failed";
+  status: "pending" | "awaiting_review" | "ready" | "failed";
   error: string | null;
   stage: string | null;
+  suggestions: Suggestion[] | null;
   created_at: Date;
   updated_at: Date;
 };
```
(`Suggestion` doesn't exist yet — it's added in Task 2. This file won't typecheck until that task lands; that's fine, they're implemented in the same PR.)

- [ ] **Step 3: Add `suggestions` to the shared column list**

```diff
 const TAILORED_RESUME_COLUMNS =
-  "id, job_title, company, location, job_url, jd_text, markdown, critic_score, pdf_error, status, error, stage, created_at, updated_at";
+  "id, job_title, company, location, job_url, jd_text, markdown, critic_score, pdf_error, status, error, stage, suggestions, created_at, updated_at";
```

- [ ] **Step 4: Add `setSuggestions` and `beginApplyingSuggestions`**

Add these next to `updateResumeStage`:
```ts
/** Stores the freshly generated suggestions and moves the row into human review. */
export async function setSuggestions(id: string, suggestions: Suggestion[]): Promise<void> {
  await pool.query(
    `UPDATE tailored_resumes SET suggestions = $1, status = 'awaiting_review', stage = NULL, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(suggestions), id]
  );
}

/** Moves an awaiting_review row back into 'pending' right as POST /apply-suggestions starts its background work — reuses the same pending/polling UI the rest of the app already has. */
export async function beginApplyingSuggestions(id: string): Promise<void> {
  await pool.query(`UPDATE tailored_resumes SET status = 'pending', stage = NULL WHERE id = $1`, [id]);
}
```

- [ ] **Step 5: Let `completeTailoredResume` optionally persist the final accepted suggestions**

```diff
 export async function completeTailoredResume(
   id: string,
-  fields: { markdown: string; criticScore?: number }
+  fields: { markdown: string; criticScore?: number; suggestions?: Suggestion[] }
 ): Promise<void> {
   const { rowCount } = await pool.query(
     `UPDATE tailored_resumes
      SET markdown     = $1,
          critic_score = $2,
+         suggestions  = COALESCE($3, suggestions),
          status       = 'ready',
          error        = NULL,
          updated_at   = NOW()
-     WHERE id = $3`,
-    [fields.markdown, fields.criticScore ?? null, id]
+     WHERE id = $4`,
+    [fields.markdown, fields.criticScore ?? null, fields.suggestions ? JSON.stringify(fields.suggestions) : null, id]
   );
   if (rowCount === 0) {
     console.warn(`[queries] completeTailoredResume: row ${id} no longer exists (deleted mid-generation?)`);
   }
 }
```

- [ ] **Step 6: Commit** (deferred — this file won't compile until Task 2's `Suggestion` type exists; commit both together)

Skip committing here; proceed directly to Task 2 and commit both at the end of Task 2's Step 3.

---

### Task 2: `Suggestion`/`RawSuggestion` schemas + export `numbers()` from `grounding.ts`

**Files:**
- Modify: `packages/agent/src/ai/types.ts`
- Modify: `packages/agent/src/ai/grounding.ts:30`

**Interfaces:**
- Produces: `RawSuggestionSchema`/`RawSuggestion` (LLM output shape, no `groundedness`/`accepted`), `SuggestionSchema`/`Suggestion` (adds `groundedness`/`accepted`, stored in the DB and sent to the frontend) — consumed by Tasks 3, 4, 5, 6. `numbers(text: string): Set<string>` exported from `grounding.ts` — consumed by Task 3.

- [ ] **Step 1: Add the suggestion schemas**

At the end of `packages/agent/src/ai/types.ts`, after `TailoredResumeSchema`:
```ts
/* ------------------------------------------------------------------ */
/* Keyword-insertion suggestions — the per-job tailoring flow's only  */
/* output. The master resume itself is never reordered or cut; these  */
/* are small, individually-approved wording/skill additions.          */
/* ------------------------------------------------------------------ */

export const RawSuggestionSchema = z.object({
  /** Stable id for this suggestion within one batch, e.g. "sugg-1". */
  id: z.string(),
  kind: z.enum(["bullet-rewrite", "skill-addition"]),
  /** bullet-rewrite: the master Bullet.id being reworded.
   *  skill-addition: one of "languages" | "frameworks" | "tools" (never "interests"). */
  targetId: z.string(),
  /** The JD term this suggestion surfaces. */
  keyword: z.string(),
  /** bullet-rewrite only: the bullet's current text, verbatim. */
  originalText: z.string().optional(),
  /** bullet-rewrite: the full reworded bullet text.
   *  skill-addition: the single skill/tool name to add. */
  suggestedText: z.string(),
  /** One sentence: why this JD keyword fits here. */
  rationale: z.string(),
});
export type RawSuggestion = z.infer<typeof RawSuggestionSchema>;

/**
 * A RawSuggestion plus fields computed AFTER the LLM call, never
 * self-reported by the model:
 *   - groundedness: deterministic, via apply-suggestions.ts's labelGroundedness().
 *   - accepted: review state — null until the user checks/unchecks it.
 */
export const SuggestionSchema = RawSuggestionSchema.extend({
  groundedness: z.enum(["grounded", "extrapolated"]),
  accepted: z.boolean().nullable().default(null),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;
```

- [ ] **Step 2: Export `numbers()` from `grounding.ts`**

```diff
-function numbers(text: string): Set<string> {
+export function numbers(text: string): Set<string> {
```

- [ ] **Step 3: Typecheck and commit (Tasks 1 + 2 together)**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors (Task 1's `queries.ts` now resolves `Suggestion`).

```bash
git add packages/agent/src/db/schema.ts packages/agent/src/db/queries.ts packages/agent/src/ai/types.ts packages/agent/src/ai/grounding.ts
git commit -m "$(cat <<'EOF'
feat: add Suggestion schema, awaiting_review status, and suggestions column

Schema and query-layer groundwork for the suggestion-based tailoring
flow: tailored_resumes gains a suggestions JSONB column and a fourth
status value, and grounding.ts's numbers() helper is exported for
reuse by the new groundedness labeling logic.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `apply-suggestions.ts` — groundedness labeling + the apply function

**Files:**
- Create: `packages/agent/src/ai/apply-suggestions.ts`
- Create: `packages/agent/src/ai/test-apply-suggestions.ts`
- Modify: `packages/agent/package.json` (add `test:apply-suggestions` script)

**Interfaces:**
- Consumes: `numbers` from `./grounding` (Task 2); `MasterResume`, `RawSuggestion`, `Suggestion`, `TailoredResume` from `./types`.
- Produces: `labelGroundedness(master, raw): "grounded" | "extrapolated"` and `applySuggestions(master, accepted): { master: MasterResume; tailored: TailoredResume }` — consumed by Task 5 (labeling) and Task 6 (apply).

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/ai/test-apply-suggestions.ts`:
```ts
import { MASTER_RESUME } from "./master-resume";
import { labelGroundedness, applySuggestions } from "./apply-suggestions";
import { RawSuggestion, Suggestion } from "./types";

// exp-scout-1's real text: "Launched an AI security assistant with Copilot Studio
// and Jira, reducing projected support costs by $800K annually" (tech: Copilot
// Studio, Jira; metrics: "$800K projected annual support cost reduction").

const groundedRewrite: RawSuggestion = {
  id: "sugg-1",
  kind: "bullet-rewrite",
  targetId: "exp-scout-1",
  keyword: "Jira",
  originalText: "Launched an AI security assistant with Copilot Studio and Jira, reducing projected support costs by $800K annually",
  suggestedText: "Launched an AI security assistant with Copilot Studio and Jira workflows, reducing projected support costs by $800K annually",
  rationale: "JD mentions Jira; the source bullet already names it.",
};

const fabricatedNumberRewrite: RawSuggestion = {
  id: "sugg-2",
  kind: "bullet-rewrite",
  targetId: "exp-scout-1",
  keyword: "Jira",
  originalText: "Launched an AI security assistant with Copilot Studio and Jira, reducing projected support costs by $800K annually",
  suggestedText: "Launched an AI security assistant with Copilot Studio and Jira, reducing projected support costs by $2M annually",
  rationale: "Inflates the real $800K figure — must be flagged even though Jira is grounded.",
};

const unrelatedSkillAddition: RawSuggestion = {
  id: "sugg-3",
  kind: "skill-addition",
  targetId: "tools",
  keyword: "Terraform",
  suggestedText: "Terraform",
  rationale: "JD wants IaC experience, but Terraform is never mentioned anywhere in the master resume.",
};

const groundedSkillAddition: RawSuggestion = {
  id: "sugg-4",
  kind: "skill-addition",
  targetId: "tools",
  keyword: "Kubernetes",
  suggestedText: "Kubernetes",
  rationale: "Already named in exp-scout-3's bullet text, just not in the skills list under this exact spelling check.",
};

const gRewrite = labelGroundedness(MASTER_RESUME, groundedRewrite);
const gFabricated = labelGroundedness(MASTER_RESUME, fabricatedNumberRewrite);
const gUnrelated = labelGroundedness(MASTER_RESUME, unrelatedSkillAddition);
const gGrounded = labelGroundedness(MASTER_RESUME, groundedSkillAddition);

console.log("grounded rewrite      →", gRewrite, "(expect grounded)");
console.log("fabricated number     →", gFabricated, "(expect extrapolated)");
console.log("unrelated skill       →", gUnrelated, "(expect extrapolated)");
console.log("grounded skill        →", gGrounded, "(expect grounded — Kubernetes is already in master.skills.tools)");

const accepted: Suggestion[] = [
  { ...groundedRewrite, groundedness: "grounded", accepted: true },
  { ...unrelatedSkillAddition, groundedness: "extrapolated", accepted: true }, // accepted anyway — Christopher's call, not ours to block
];

const { master: adjustedMaster, tailored } = applySuggestions(MASTER_RESUME, accepted);

const scoutSection = tailored.experience.find((e) => e.id === "exp-scout")!;
const bullet1 = scoutSection.bullets.find((b) => b.sourceId === "exp-scout-1")!;
const bullet2 = scoutSection.bullets.find((b) => b.sourceId === "exp-scout-2")!;

const rewriteApplied = bullet1.text === groundedRewrite.suggestedText;
const untouchedBulletUnchanged = bullet2.text === MASTER_RESUME.experience[0].bullets[1].text;
const skillAdded = adjustedMaster.skills.tools.some((t) => t.toLowerCase() === "terraform");
const originalMasterUntouched = !MASTER_RESUME.skills.tools.some((t) => t.toLowerCase() === "terraform");
const noReorderingOrCutting =
  tailored.experience.length === MASTER_RESUME.experience.length &&
  tailored.projects.length === MASTER_RESUME.projects.length &&
  tailored.cut.length === 0;

console.log("rewrite applied:", rewriteApplied);
console.log("untouched bullet unchanged:", untouchedBulletUnchanged);
console.log("skill added to adjusted master:", skillAdded);
console.log("original MASTER_RESUME left untouched (deep clone):", originalMasterUntouched);
console.log("no reordering/cutting:", noReorderingOrCutting);

const pass =
  gRewrite === "grounded" &&
  gFabricated === "extrapolated" &&
  gUnrelated === "extrapolated" &&
  gGrounded === "grounded" &&
  rewriteApplied &&
  untouchedBulletUnchanged &&
  skillAdded &&
  originalMasterUntouched &&
  noReorderingOrCutting;

console.log(pass ? "\n✓ apply-suggestions test PASSED" : "\n✗ apply-suggestions test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/agent && npx tsx src/ai/test-apply-suggestions.ts`
Expected: fails with `Cannot find module './apply-suggestions'`.

- [ ] **Step 3: Implement `apply-suggestions.ts`**

Create `packages/agent/src/ai/apply-suggestions.ts`:
```ts
import { MasterResume, RawSuggestion, Suggestion, TailoredResume, Bullet } from "./types";
import { numbers } from "./grounding";

function allBullets(master: MasterResume): Bullet[] {
  return [...master.experience, ...master.projects].flatMap((section) => section.bullets);
}

function findBullet(master: MasterResume, id: string): Bullet | null {
  return allBullets(master).find((b) => b.id === id) ?? null;
}

/** Every word a suggestion could plausibly point back to: bullet text/tech/metrics plus all skills. */
function masterHaystack(master: MasterResume): string {
  const bulletText = allBullets(master)
    .flatMap((b) => [b.text, ...b.tech, ...b.metrics])
    .join(" ");
  const skillText = [...master.skills.languages, ...master.skills.frameworks, ...master.skills.tools].join(" ");
  return `${bulletText} ${skillText}`.toLowerCase();
}

/**
 * Deterministic, not LLM-self-reported (a model grading its own honesty is a
 * weak signal — see grounding.ts's existing "deterministic backstop"
 * philosophy). A suggestion is "grounded" only if:
 *   - its JD keyword already appears somewhere in the master resume, AND
 *   - (bullet-rewrite only) it introduces no number beyond the source bullet's own.
 * Anything else is "extrapolated" — still shown to the user, never silently blocked.
 */
export function labelGroundedness(master: MasterResume, raw: RawSuggestion): "grounded" | "extrapolated" {
  const haystack = masterHaystack(master);
  const keywordGrounded = haystack.includes(raw.keyword.toLowerCase());

  if (raw.kind === "skill-addition") {
    return keywordGrounded ? "grounded" : "extrapolated";
  }

  const source = findBullet(master, raw.targetId);
  if (!source) return "extrapolated"; // unknown bullet id — treat conservatively

  const allowedNumbers = numbers(`${source.text} ${source.metrics.join(" ")}`);
  const hasNewNumber = [...numbers(raw.suggestedText)].some((n) => !allowedNumbers.has(n));

  return keywordGrounded && !hasNewNumber ? "grounded" : "extrapolated";
}

const SKILL_CATEGORIES = ["languages", "frameworks", "tools"] as const;
type SkillCategory = (typeof SKILL_CATEGORIES)[number];
function isSkillCategory(s: string): s is SkillCategory {
  return (SKILL_CATEGORIES as readonly string[]).includes(s);
}

/**
 * Applies only the accepted suggestions on top of the master resume. Every
 * bullet from every experience/project is included, in master order — this
 * flow never reorders, cuts, or restructures anything, only rewrites specific
 * bullets or adds specific skills that Christopher explicitly checked off.
 *
 * Returns an adjusted master (skill additions merged in) plus a full-coverage
 * TailoredResume, so the existing renderMarkdown(master, tailored) from
 * format.ts can render the result unchanged — no new markdown renderer.
 */
export function applySuggestions(
  master: MasterResume,
  accepted: Suggestion[]
): { master: MasterResume; tailored: TailoredResume } {
  const adjustedMaster: MasterResume = JSON.parse(JSON.stringify(master));

  for (const s of accepted) {
    if (s.kind !== "skill-addition" || !isSkillCategory(s.targetId)) continue;
    const category = adjustedMaster.skills[s.targetId];
    const already = category.some((c) => c.toLowerCase() === s.suggestedText.toLowerCase());
    if (!already) category.push(s.suggestedText);
  }

  const rewrites = new Map(
    accepted.filter((s) => s.kind === "bullet-rewrite").map((s) => [s.targetId, s.suggestedText])
  );

  const tailorSection = (sections: MasterResume["experience"] | MasterResume["projects"]) =>
    sections.map((section) => ({
      id: section.id,
      bullets: section.bullets.map((bullet) => ({
        sourceId: bullet.id,
        text: rewrites.get(bullet.id) ?? bullet.text,
      })),
    }));

  const tailored: TailoredResume = {
    experience: tailorSection(master.experience),
    projects: tailorSection(master.projects),
    skillsOrder: [], // renderMarkdown falls back to master's own order when empty — nothing is re-ranked
    keywordsCovered: accepted.map((s) => s.keyword),
    cut: [],
    reasoning: "",
  };

  return { master: adjustedMaster, tailored };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/agent && npx tsx src/ai/test-apply-suggestions.ts`
Expected: all six console lines match their `(expect ...)` comments, ending in `✓ apply-suggestions test PASSED`. This test is pure/offline — no LLM call, no network — so it must pass deterministically every run.

- [ ] **Step 5: Register the npm script**

```diff
     "test:critic": "tsx src/ai/test-critic.ts",
+    "test:apply-suggestions": "tsx src/ai/test-apply-suggestions.ts",
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/ai/apply-suggestions.ts packages/agent/src/ai/test-apply-suggestions.ts packages/agent/package.json
git commit -m "$(cat <<'EOF'
feat: add applySuggestions() and deterministic groundedness labeling

groundedness is computed after the LLM call (keyword must trace to the
master resume; bullet-rewrites may never introduce a new number),
never self-reported by the model. applySuggestions() never reorders
or cuts anything — every master bullet stays, in place, with only
accepted rewrites/additions applied.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `suggest-keywords.ts` — the single LLM call

**Files:**
- Create: `packages/agent/src/ai/suggest-keywords.ts`
- Create: `packages/agent/src/ai/test-suggest-keywords.ts`
- Modify: `packages/agent/package.json` (add `test:suggest-keywords` script)

**Interfaces:**
- Consumes: `completeJSON` from `./llm`; `MasterResume`, `RawSuggestion`, `RawSuggestionSchema` from `./types` (Task 2).
- Produces: `suggestKeywords(jd: string, master: MasterResume): Promise<RawSuggestion[]>` — consumed by Task 5.

- [ ] **Step 1: Write the test script (fails until Step 2 exists)**

Create `packages/agent/src/ai/test-suggest-keywords.ts`:
```ts
import { MASTER_RESUME } from "./master-resume";
import { suggestKeywords } from "./suggest-keywords";

const JD = `
Senior Platform Engineer — Infrastructure Team

We're looking for an engineer with hands-on experience running production
workloads on Kubernetes, managing infrastructure as code with Terraform, and
building CI/CD pipelines with GitHub Actions. Experience with GitOps tools
like Argo CD is a strong plus. You'll work closely with our observability
team, so familiarity with Datadog or similar tools is valuable.
`.trim();

async function main() {
  const suggestions = await suggestKeywords(JD, MASTER_RESUME);

  console.log(`Got ${suggestions.length} suggestions:`);
  for (const s of suggestions) {
    console.log(`  [${s.kind}] target=${s.targetId} keyword="${s.keyword}"`);
    console.log(`    → "${s.suggestedText}"`);
  }

  const reasonableCount = suggestions.length >= 1 && suggestions.length <= 10;
  const allHaveRequiredFields = suggestions.every(
    (s) => s.id && s.kind && s.targetId && s.keyword && s.suggestedText && s.rationale
  );
  const skillAdditionsUseValidCategory = suggestions
    .filter((s) => s.kind === "skill-addition")
    .every((s) => ["languages", "frameworks", "tools"].includes(s.targetId));
  const bulletRewritesTargetRealBullets = suggestions
    .filter((s) => s.kind === "bullet-rewrite")
    .every((s) =>
      [...MASTER_RESUME.experience, ...MASTER_RESUME.projects].some((section) =>
        section.bullets.some((b) => b.id === s.targetId)
      )
    );

  console.log("Reasonable count (1-10):", reasonableCount);
  console.log("All have required fields:", allHaveRequiredFields);
  console.log("Skill-additions use a valid category:", skillAdditionsUseValidCategory);
  console.log("Bullet-rewrites target real bullet ids:", bulletRewritesTargetRealBullets);

  const pass =
    reasonableCount && allHaveRequiredFields && skillAdditionsUseValidCategory && bulletRewritesTargetRealBullets;
  console.log(pass ? "\n✓ suggest-keywords test PASSED" : "\n✗ suggest-keywords test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/agent && npx tsx src/ai/test-suggest-keywords.ts`
Expected: fails with `Cannot find module './suggest-keywords'`.

- [ ] **Step 3: Implement `suggest-keywords.ts`**

Create `packages/agent/src/ai/suggest-keywords.ts`:
```ts
import { z } from "zod";
import { completeJSON } from "./llm";
import { MasterResume, RawSuggestion, RawSuggestionSchema } from "./types";

const SYSTEM_PROMPT = `You analyze a job description against a candidate's résumé and suggest a
SHORT list of targeted keyword insertions. That is your entire scope.

HARD RULES:
- The résumé below is FIXED and already exactly one page. Do NOT propose
  removing, reordering, cutting, or restructuring anything — every existing
  bullet and skill stays exactly where it is, for every job.
- Each suggestion is one of:
  - "bullet-rewrite": a small wording change to ONE existing bullet (referenced
    by its exact "id" from the source below) that works in a JD keyword or
    technology the bullet doesn't currently mention.
  - "skill-addition": a single skill/technology name to add to one of the
    candidate's skill categories — "targetId" must be exactly "languages",
    "frameworks", or "tools" (never "interests").
- Never suggest more than one change per bullet.
- Never touch Education, Extracurriculars, or any field not shown to you below.
- It is acceptable to suggest a plausible extrapolation beyond what's literally
  stated (e.g. a closely related tool to one already named) — the candidate
  reviews and approves every suggestion before anything is applied. Do not
  invent something wildly unrelated to the source material below.
- Prefer fewer, higher-confidence suggestions (aim for 3-8) over many marginal
  ones. If the JD has little to add, return fewer suggestions — never pad the
  list.

OUTPUT: JSON matching:
{
  "suggestions": [
    {
      "id": string,                 // e.g. "sugg-1"
      "kind": "bullet-rewrite" | "skill-addition",
      "targetId": string,           // bullet-rewrite: an id from the source below.
                                     // skill-addition: "languages" | "frameworks" | "tools"
      "keyword": string,            // the JD term this addresses
      "originalText": string,       // bullet-rewrite only: the bullet's CURRENT text, verbatim
      "suggestedText": string,      // bullet-rewrite: the full reworded bullet text.
                                     // skill-addition: the skill/tool name to add
      "rationale": string           // one sentence: why this JD keyword fits here
    }
  ]
}
Return ONLY the JSON object.`;

const ResponseSchema = z.object({ suggestions: z.array(RawSuggestionSchema) });

function tailorableSlice(master: MasterResume) {
  return {
    experience: master.experience.map((e) => ({
      id: e.id,
      company: e.company,
      bullets: e.bullets.map((b) => ({ id: b.id, text: b.text, tech: b.tech })),
    })),
    projects: master.projects.map((p) => ({
      id: p.id,
      name: p.name,
      bullets: p.bullets.map((b) => ({ id: b.id, text: b.text, tech: b.tech })),
    })),
    skills: {
      languages: master.skills.languages,
      frameworks: master.skills.frameworks,
      tools: master.skills.tools,
    },
  };
}

export async function suggestKeywords(jd: string, master: MasterResume): Promise<RawSuggestion[]> {
  const result = await completeJSON(ResponseSchema, {
    system: SYSTEM_PROMPT,
    user: [
      "=== JOB DESCRIPTION ===",
      jd.trim(),
      "=== RÉSUMÉ (fixed, one page — reference bullets by id) ===",
      JSON.stringify(tailorableSlice(master)),
    ].join("\n\n"),
    temperature: 0.3,
  });
  return result.suggestions;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/agent && npx tsx src/ai/test-suggest-keywords.ts`
Expected: prints each suggestion, all four checks `true`, ending in `✓ suggest-keywords test PASSED`. (Real LLM call — same caveat as `test-critic.ts`: needs `CLAUDE_CODE_OAUTH_TOKEN` or `OPENAI_API_KEY` configured.)

- [ ] **Step 5: Register the npm script**

```diff
     "test:apply-suggestions": "tsx src/ai/test-apply-suggestions.ts",
+    "test:suggest-keywords": "tsx src/ai/test-suggest-keywords.ts",
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/ai/suggest-keywords.ts packages/agent/src/ai/test-suggest-keywords.ts packages/agent/package.json
git commit -m "$(cat <<'EOF'
feat: add suggestKeywords() — single-pass JD keyword suggestions

Replaces the old approach of regenerating/reordering the résumé per
job: one LLM call proposes a short list of bullet-rewrite/skill-
addition suggestions against the fixed master resume, for the user to
review before anything is applied.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Rewrite `routes/tailor.ts`'s background pipeline

**Files:**
- Modify: `packages/agent/src/api/routes/tailor.ts`

**Interfaces:**
- Consumes: `suggestKeywords` (Task 4), `labelGroundedness` (Task 3), `setSuggestions` (Task 1), `getMasterResume` (existing).
- Produces: the `POST /api/tailor` background job now ends at `status = 'awaiting_review'` with `suggestions` populated, instead of running the old 3-pass loop through to `ready`.

- [ ] **Step 1: Replace the pipeline function**

In `packages/agent/src/api/routes/tailor.ts`, replace the imports and `runTailorPipeline`:
```diff
 import { Router } from "express";
-import { generateBestResume } from "../../ai/chain";
+import { suggestKeywords } from "../../ai/suggest-keywords";
+import { labelGroundedness } from "../../ai/apply-suggestions";
+import { getMasterResume } from "../../db/queries";
 import {
   createPendingResume,
   completeTailoredResume,
   failTailoredResume,
   storePdf,
   setPdfError,
   updateResumeStage,
+  setSuggestions,
 } from "../../db/queries";
 import { fetchJd } from "../../scraper/fetch-jd";
-import { renderPdf } from "../../ai/render-pdf";
-import { fitToOnePage } from "../../ai/fit-page";
 import { LLM_PROVIDER } from "../../ai/llm";
+import { Suggestion } from "../../ai/types";
```
(`renderPdf`/`fitToOnePage` are no longer used in this file — they move to `resumes.ts` in Task 6, which is where the apply-suggestions pipeline runs.)

Replace the whole `runTailorPipeline` function body:
```diff
-router.post("/", async (req, res) => {
+router.post("/", async (req, res) => {
```
(the route handler above `runTailorPipeline` is unchanged — same JD-fetch, `createPendingResume`, `202` response — only the function it calls afterward changes):
```diff
-  runTailorPipeline(row.id, jd, { jobTitle: resolvedTitle, company: resolvedCompany }).catch((err) => {
+  runSuggestPipeline(row.id, jd).catch((err) => {
     console.error("[tailor] background pipeline crashed:", err);
   });
 });

-async function runTailorPipeline(
-  id: string,
-  jd: string,
-  opts: { jobTitle?: string; company?: string }
-) {
-  let result;
-  try {
-    result = await generateBestResume(jd, {
-      ...opts,
-      onProgress: (stage) => {
-        updateResumeStage(id, stage).catch((err) => {
-          console.error("[tailor] stage update failed:", err);
-        });
-      },
-    });
-  } catch (err) {
-    console.error("[tailor] pipeline error:", err);
-    const credentialHint =
-      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
-    await failTailoredResume(id, `Tailoring failed — ${credentialHint} and try again.`);
-    return;
-  }
-
-  // Fit to one page (page-count check + LLM trim/widow-fix loop). A failure
-  // here degrades gracefully — the resume still completes with the
-  // un-fitted markdown, and the PDF render further down reports the error
-  // via pdf_error, same as any other PDF render failure.
-  await updateResumeStage(id, "Finalizing formatting").catch((err) => {
-    console.error("[tailor] stage update failed:", err);
-  });
-  let finalMarkdown = result.markdown;
-  let fittedPdf: Buffer | null = null;
-  try {
-    const fitted = await fitToOnePage(result.markdown);
-    finalMarkdown = fitted.markdown;
-    fittedPdf = fitted.pdf;
-  } catch (err) {
-    console.error("[tailor] fitToOnePage failed, continuing with un-fitted markdown:", err);
-  }
-
-  try {
-    await completeTailoredResume(id, {
-      markdown: finalMarkdown,
-      criticScore: result.critic.finalScore,
-    });
-  } catch (err) {
-    console.error("[tailor] db error saving result:", err);
-    await failTailoredResume(id, "Failed to save resume — database error.").catch(() => {});
-    return;
-  }
-
-  // Store the PDF fitToOnePage already rendered, if it succeeded; otherwise
-  // fall back to rendering the un-fitted markdown directly, same as before
-  // this change. Either way this runs in the background — /pdf generates
-  // on-demand if not ready yet.
-  if (fittedPdf) {
-    storePdf(id, fittedPdf).catch((err) => {
-      console.error("[tailor] pdf store failed:", err);
-      setPdfError(id, err instanceof Error ? err.message : String(err)).catch(() => {});
-    });
-  } else {
-    renderPdf(finalMarkdown)
-      .then((pdf) => storePdf(id, pdf))
-      .catch((err) => {
-        console.error("[tailor] pdf render failed:", err);
-        const message = err instanceof Error ? err.message : String(err);
-        setPdfError(id, message).catch(() => {});
-      });
-  }
-}
+async function runSuggestPipeline(id: string, jd: string) {
+  try {
+    await updateResumeStage(id, "Analyzing job description");
+    const master = await getMasterResume();
+    const raw = await suggestKeywords(jd, master);
+    const suggestions: Suggestion[] = raw.map((s) => ({
+      ...s,
+      groundedness: labelGroundedness(master, s),
+      accepted: null,
+    }));
+    await setSuggestions(id, suggestions);
+  } catch (err) {
+    console.error("[tailor] suggestion pipeline error:", err);
+    const credentialHint =
+      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
+    await failTailoredResume(id, `Generating suggestions failed — ${credentialHint} and try again.`);
+  }
+}
```
`storePdf`/`setPdfError` remain imported but now unused in this file after the diff — remove them from the import list:
```diff
 import {
   createPendingResume,
   completeTailoredResume,
   failTailoredResume,
-  storePdf,
-  setPdfError,
   updateResumeStage,
   setSuggestions,
 } from "../../db/queries";
```
(`completeTailoredResume`/`failTailoredResume` stay imported — `failTailoredResume` is used above; `completeTailoredResume` is no longer called in this file either, so remove it too if unused — check with the typecheck step below and remove any import TypeScript flags as unused.)

- [ ] **Step 2: Typecheck**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors. If `completeTailoredResume` shows as an unused import, remove it from `tailor.ts`'s import list (it's still used by `resumes.ts` in Task 6, a separate file).

- [ ] **Step 3: Manual verification**

With the agent server running:
```bash
curl -s -X POST http://localhost:3001/api/tailor \
  -H "Content-Type: application/json" \
  -d '{"jdText": "Looking for an engineer with Kubernetes, Terraform, and Datadog experience.", "jobTitle": "Platform Engineer", "company": "TestCo"}'
```
Expected: immediate `202 {"id": "...", "status": "pending"}`. Poll `GET /api/resume/<id>` a few times a couple seconds apart:
```bash
curl -s http://localhost:3001/api/resume/<id> | python3 -m json.tool
```
Expected: `status` starts `"pending"` with `stage: "Analyzing job description"`, then flips to `"awaiting_review"` with a non-empty `suggestions` array and `stage: null`.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/api/routes/tailor.ts
git commit -m "$(cat <<'EOF'
feat: POST /api/tailor now generates suggestions, not a full rewrite

The background pipeline calls suggestKeywords() once instead of the
old 3-pass generate->critique->revise loop, and ends at a new
awaiting_review status with the proposed suggestions attached —
POST /api/resume/:id/apply-suggestions (next commit) takes it from
there.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `POST /api/resume/:id/apply-suggestions`

**Files:**
- Modify: `packages/agent/src/api/routes/resumes.ts`

**Interfaces:**
- Consumes: `applySuggestions` (Task 3), `renderMarkdown` from `../../ai/format` (existing), `fitToOnePage` from `../../ai/fit-page` (existing), `beginApplyingSuggestions`/`completeTailoredResume` (Task 1).
- Produces: `POST /api/resume/:id/apply-suggestions` — body `{ accepted: Suggestion[] }`, responds `202 { id, status: "pending" }`, then runs the same apply→fit→render→ready pipeline `tailor.ts` used to run, reusing the existing pending/polling UI unchanged.

- [ ] **Step 1: Add the imports**

```diff
 import { Router } from "express";
 import { Resend } from "resend";
 import {
   listTailoredResumes,
   getTailoredResume,
   updateTailoredResume,
   deleteTailoredResume,
   getPdf,
   storePdf,
   setPdfError,
   getMasterResume,
+  beginApplyingSuggestions,
+  completeTailoredResume,
+  failTailoredResume,
+  updateResumeStage,
 } from "../../db/queries";
 import { renderPdf } from "../../ai/render-pdf";
+import { renderMarkdown } from "../../ai/format";
+import { fitToOnePage } from "../../ai/fit-page";
+import { applySuggestions } from "../../ai/apply-suggestions";
+import { Suggestion } from "../../ai/types";
+import { LLM_PROVIDER } from "../../ai/llm";
 import { buildResumeFilename } from "../../utils/filename";
```

- [ ] **Step 2: Add the route and its background pipeline**

Add right after the `PATCH /api/resume/:id` route (before `DELETE /api/resume/:id`):
```ts
// POST /api/resume/:id/apply-suggestions — applies the accepted suggestions
// from the awaiting_review checklist and produces the final one-page resume.
// Same async shape as POST /api/tailor: responds immediately, runs in the
// background, and reuses the existing pending/polling UI.
router.post("/resume/:id/apply-suggestions", async (req, res) => {
  const { accepted } = req.body as { accepted?: Suggestion[] };
  if (!Array.isArray(accepted)) {
    res.status(400).json({ error: "accepted must be an array of suggestions" });
    return;
  }

  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status !== "awaiting_review") {
    res.status(409).json({ error: `Resume is ${row.status}, not awaiting review.` });
    return;
  }

  await beginApplyingSuggestions(req.params.id);
  res.status(202).json({ id: req.params.id, status: "pending" });

  runApplyPipeline(req.params.id, accepted).catch((err) => {
    console.error("[resume] apply-suggestions pipeline crashed:", err);
  });
});

async function runApplyPipeline(id: string, accepted: Suggestion[]) {
  try {
    await updateResumeStage(id, "Applying your selections");
    const master = await getMasterResume();
    const { master: adjustedMaster, tailored } = applySuggestions(master, accepted);
    let markdown = renderMarkdown(adjustedMaster, tailored);

    await updateResumeStage(id, "Finalizing formatting");
    let pdf: Buffer | null = null;
    try {
      const fitted = await fitToOnePage(markdown);
      markdown = fitted.markdown;
      pdf = fitted.pdf;
    } catch (err) {
      console.error("[resume] fitToOnePage failed, continuing with un-fitted markdown:", err);
    }

    await completeTailoredResume(id, { markdown, suggestions: accepted });

    if (pdf) {
      await storePdf(id, pdf).catch((err) => {
        console.error("[resume] pdf store failed:", err);
        setPdfError(id, errorMessage(err)).catch(() => {});
      });
    } else {
      try {
        const rendered = await renderPdf(markdown);
        await storePdf(id, rendered);
      } catch (err) {
        console.error("[resume] pdf render failed:", err);
        await setPdfError(id, errorMessage(err));
      }
    }
  } catch (err) {
    console.error("[resume] apply-suggestions pipeline error:", err);
    const credentialHint =
      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    await failTailoredResume(id, `Applying suggestions failed — ${credentialHint} and try again.`);
  }
}
```
(`errorMessage` is already defined at the top of this file — reused, not redefined.)

- [ ] **Step 3: Typecheck**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Continuing from Task 5's manual test (an `awaiting_review` row with real suggestions from `GET /api/resume/<id>`), accept one suggestion:
```bash
curl -s -X POST http://localhost:3001/api/resume/<id>/apply-suggestions \
  -H "Content-Type: application/json" \
  -d '{"accepted": [<paste one suggestion object from the previous GET, unchanged>]}'
```
Expected: immediate `202 {"id": "...", "status": "pending"}`. Poll `GET /api/resume/<id>` again: `status` moves `pending` (`stage` cycling through "Applying your selections" → "Finalizing formatting") → `"ready"`, with `markdown` reflecting the accepted change and `suggestions` now holding the accepted list. Confirm `GET /api/resume/<id>/pdf` returns a one-page PDF.

Also verify the guard: calling apply-suggestions again on the now-`ready` row:
```bash
curl -s -X POST http://localhost:3001/api/resume/<id>/apply-suggestions -H "Content-Type: application/json" -d '{"accepted": []}'
```
Expected: `409 {"error":"Resume is ready, not awaiting review."}`.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/api/routes/resumes.ts
git commit -m "$(cat <<'EOF'
feat: add POST /api/resume/:id/apply-suggestions

Applies only the accepted suggestions on top of the master resume,
renders via the existing renderMarkdown/fitToOnePage/renderPdf
pipeline, and reuses the existing pending-status polling UI end to
end.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Frontend types, API client, and the new stage stepper

**Files:**
- Modify: `packages/web/lib/api.ts`
- Modify: `packages/web/lib/resumeStage.ts`

**Interfaces:**
- Produces: `Suggestion` type, `Resume.suggestions`, `Resume.status` widened to include `"awaiting_review"`, `api.applySuggestions(id, accepted)` — consumed by Task 8. `STAGE_SEGMENTS`/`segmentIndex` updated to the new 3-stage vocabulary — consumed by Task 8 (this replaces the 4-stage chain.ts-era stepper, which is safe because `ResumeEditor` is no longer reachable for the dormant general-resume path after the UI-removal plan).

- [ ] **Step 1: Add the `Suggestion` type and widen `status`**

In `packages/web/lib/api.ts`:
```diff
+export type Suggestion = {
+  id: string;
+  kind: "bullet-rewrite" | "skill-addition";
+  targetId: string;
+  keyword: string;
+  originalText?: string;
+  suggestedText: string;
+  groundedness: "grounded" | "extrapolated";
+  rationale: string;
+  accepted: boolean | null;
+};
+
 export type ResumeListItem = {
   id: string;
   job_title: string | null;
   company: string | null;
   location: string | null;
   job_url: string | null;
   critic_score: number | null;
   pdf_error: string | null;
-  status: "pending" | "ready" | "failed";
+  status: "pending" | "awaiting_review" | "ready" | "failed";
   error: string | null;
   stage: string | null;
+  suggestions: Suggestion[] | null;
   created_at: string;
   updated_at: string;
 };
```

- [ ] **Step 2: Add `api.applySuggestions`**

```diff
   tailorResume: (body: {
     jdText?: string;
     jobUrl?: string;
     jobTitle?: string;
     company?: string;
     location?: string;
   }) =>
     request<{ id: string; status: "pending" }>("POST", "/tailor", body),
+  applySuggestions: (id: string, accepted: Suggestion[]) =>
+    request<{ id: string; status: "pending" }>("POST", `/resume/${id}/apply-suggestions`, { accepted }),
```

- [ ] **Step 3: Replace the stage stepper**

`packages/web/lib/resumeStage.ts`, full replacement:
```ts
/** The 3 fixed stepper segments shown on the resume-pending screen, in order. */
export const STAGE_SEGMENTS = ["Analyzing", "Applying", "Finalizing"] as const;

/**
 * Maps a raw backend stage string to one of the 3 fixed segment indices
 * above, matched by prefix (mirrors the tailoring pipeline's two phases:
 * "Analyzing job description" while suggestions are generated, then
 * "Applying your selections" / "Finalizing formatting" once accepted
 * suggestions are submitted). Returns -1 when the stage is null or
 * unrecognized (caller falls back to a generic spinner in that case).
 */
export function segmentIndex(stage: string | null): number {
  if (!stage) return -1;
  if (stage.startsWith("Analyzing")) return 0;
  if (stage.startsWith("Applying")) return 1;
  if (stage.startsWith("Finalizing")) return 2;
  return -1;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json`
Expected: errors in `ResumeEditor.tsx` referencing the old 4-segment assumptions are expected here — Task 8 fixes them. If nothing else in the repo references `STAGE_SEGMENTS`/`segmentIndex` besides `ResumeEditor.tsx`, this is the only expected fallout; confirm with:
```bash
grep -rn "STAGE_SEGMENTS\|segmentIndex" packages/web --include=*.tsx --include=*.ts
```
Expected: only `resumeStage.ts` (definition) and `ResumeEditor.tsx` (usage).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/api.ts packages/web/lib/resumeStage.ts
git commit -m "$(cat <<'EOF'
feat: add Suggestion type, applySuggestions API client, 3-stage stepper

The stepper shrinks from 4 segments (Drafting/Critiquing/Revising/
Finalizing, driven by the old 3-pass loop) to 3 (Analyzing/Applying/
Finalizing, matching the new suggestion-based pipeline). Safe to
replace outright: ResumeEditor is no longer reachable for the dormant
general-resume path after the general-resume UI removal.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `SuggestionChecklist.tsx` + `ResumeEditor.tsx`'s `awaiting_review` state

**Files:**
- Create: `packages/web/components/SuggestionChecklist.tsx`
- Modify: `packages/web/components/ResumeEditor.tsx`

**Interfaces:**
- Consumes: `api.applySuggestions` (Task 7), `Suggestion` type (Task 7).
- Produces: `ResumeEditor` renders the checklist when `meta.status === "awaiting_review"`, and resumes polling once the user submits.

- [ ] **Step 1: Create `SuggestionChecklist.tsx`**

```tsx
"use client";
import { useState } from "react";
import { api, Suggestion } from "../lib/api";

type Item = Suggestion & { accepted: boolean };

export default function SuggestionChecklist({
  resumeId,
  suggestions,
  onApplied,
}: {
  resumeId: string;
  suggestions: Suggestion[];
  onApplied: () => void;
}) {
  const [items, setItems] = useState<Item[]>(suggestions.map((s) => ({ ...s, accepted: false })));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, accepted: !it.accepted } : it)));
  }

  function editText(id: string, text: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, suggestedText: text } : it)));
  }

  async function apply() {
    setSubmitting(true);
    setError(null);
    try {
      const accepted = items.filter((it) => it.accepted);
      await api.applySuggestions(resumeId, accepted);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply suggestions.");
      setSubmitting(false);
    }
  }

  const acceptedCount = items.filter((it) => it.accepted).length;

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
        <p className="text-sm text-gray-500 max-w-sm">
          No keyword suggestions found for this job description — your resume already covers it well.
        </p>
        <button
          onClick={apply}
          disabled={submitting}
          className="text-sm px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {submitting ? "Continuing…" : "Continue with resume as-is"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-6 pt-6 pb-2 flex-shrink-0">
        <p className="text-sm text-gray-600">
          Review each suggested change before it&apos;s applied. Nothing here is final — uncheck
          anything you don&apos;t want, or edit the wording directly.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <div className="flex flex-col gap-3">
          {items.map((it) => (
            <label
              key={it.id}
              className="flex gap-3 border border-gray-200 rounded-xl p-3 bg-white hover:border-violet-300 transition-colors cursor-pointer"
            >
              <input type="checkbox" checked={it.accepted} onChange={() => toggle(it.id)} className="mt-1" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-700">{it.keyword}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      it.groundedness === "grounded"
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}
                  >
                    {it.groundedness}
                  </span>
                </div>
                {it.kind === "bullet-rewrite" ? (
                  <textarea
                    value={it.suggestedText}
                    onChange={(e) => editText(it.id, e.target.value)}
                    rows={2}
                    onClick={(e) => e.preventDefault()}
                    className="w-full text-sm font-mono border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
                  />
                ) : (
                  <p className="text-sm font-medium text-gray-900">
                    Add &quot;{it.suggestedText}&quot; to {it.targetId}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">{it.rationale}</p>
              </div>
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-200 flex-shrink-0">
        <button
          onClick={apply}
          disabled={submitting}
          className="text-sm px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {submitting ? "Applying…" : `Apply ${acceptedCount} selected`}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
```
(The textarea's `onClick={(e) => e.preventDefault()}` stops a click inside it from also toggling the wrapping `<label>`'s checkbox — otherwise clicking to place a text cursor would flip `accepted`.)

- [ ] **Step 2: Wire `awaiting_review` into `ResumeEditor.tsx`**

Add the import and a `suggestions` field to `meta`:
```diff
 import { STAGE_SEGMENTS, segmentIndex } from "../lib/resumeStage";
+import SuggestionChecklist from "./SuggestionChecklist";
```
```diff
   const [meta, setMeta] = useState({
     status: resume.status,
     error: resume.error,
     critic_score: resume.critic_score,
     location: resume.location,
     job_url: resume.job_url,
     created_at: resume.created_at,
     stage: resume.stage,
+    suggestions: resume.suggestions,
   });
```
In the polling `useEffect`, carry `suggestions` through on each poll (it's the same shape of update already done for `stage`/`status`/etc.):
```diff
         hasAttemptedLoadRef.current = false;
         setMeta({
           status: fresh.status,
           error: fresh.error,
           critic_score: fresh.critic_score,
           location: fresh.location,
           job_url: fresh.job_url,
           created_at: fresh.created_at,
           stage: fresh.stage,
+          suggestions: fresh.suggestions,
         });
```
Update the pending-screen fallback copy (it currently describes the old 3-pass loop):
```diff
                 <p className="text-xs text-gray-500 mt-4">
-                  The generate → critique → revise loop usually takes a few minutes. This page updates automatically.
+                  This usually takes well under a minute. This page updates automatically.
                 </p>
```
Add the `awaiting_review` branch right after the existing `if (meta.status === "pending")` block's closing `}` and before `if (meta.status === "failed")`:
```tsx
  if (meta.status === "awaiting_review") {
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="border-b border-gray-200 px-6 py-3 flex-shrink-0">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1 w-fit transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
        </div>
        <div className="px-6 pt-4 flex-shrink-0">
          <p className="text-sm font-medium text-gray-900">
            Review suggestions{title ? ` for ${title}` : ""}
          </p>
        </div>
        <SuggestionChecklist
          resumeId={resume.id}
          suggestions={meta.suggestions ?? []}
          onApplied={() => setMeta((m) => ({ ...m, status: "pending", stage: null }))}
        />
      </div>
    );
  }

```
(`onApplied` flips `meta.status` back to `"pending"` — the existing polling `useEffect`'s guard is `if (meta.status !== "pending") return;`, so this alone re-arms polling with no other changes needed; it'll pick up `"Applying your selections"` / `"Finalizing formatting"` stage updates the same way it already does.)

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Via `/run`, submit a real JD through `/tailor`. Confirm:
1. The pending screen shows the 3-segment stepper (Analyzing → Applying → Finalizing), lighting up "Analyzing" first.
2. Once suggestions are ready, the page switches to the checklist — each suggestion shows its keyword, a grounded/extrapolated badge, editable text (for bullet-rewrites) or a "Add X to Y" line (for skill-additions), and a rationale.
3. Check a couple of suggestions, optionally hand-edit one's wording, click "Apply N selected".
4. Confirm the page switches back to the pending stepper (now on "Applying"/"Finalizing"), then to the normal editor once `ready`, with the accepted changes reflected in the markdown and PDF, and the resume still one page.

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/SuggestionChecklist.tsx packages/web/components/ResumeEditor.tsx
git commit -m "$(cat <<'EOF'
feat: add the suggestion review checklist to ResumeEditor

Renders when a resume is awaiting_review: each suggestion shows its
JD keyword, a grounded/extrapolated badge, editable wording, and a
rationale. Submitting flips status back to pending, re-arming the
existing polling loop through to the finished, one-page resume.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Dashboard badge + polling for `awaiting_review`

**Files:**
- Modify: `packages/web/components/ResumeCard.tsx`
- Modify: `packages/web/components/DashboardClient.tsx`

**Interfaces:**
- Produces: the dashboard shows a "Needs review" badge for `awaiting_review` rows and keeps refreshing the list while any row is `pending` or `awaiting_review`, so the badge updates without a manual reload.

- [ ] **Step 1: Add the badge**

In `packages/web/components/ResumeCard.tsx`, right after the existing `"pending"`/`"failed"` badges:
```diff
             {resume.status === "pending" && (
               <span className="text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 text-[10px] font-medium">
                 Generating…
               </span>
             )}
+            {resume.status === "awaiting_review" && (
+              <span className="text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5 text-[10px] font-medium">
+                Needs review
+              </span>
+            )}
             {resume.status === "failed" && (
```

- [ ] **Step 2: Widen the polling condition**

In `packages/web/components/DashboardClient.tsx`:
```diff
   useEffect(() => {
-    if (!items.some((r) => r.status === "pending")) return;
+    if (!items.some((r) => r.status === "pending" || r.status === "awaiting_review")) return;
     const interval = setInterval(async () => {
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Manual verification**

On the dashboard (`/`), submit a JD via `/tailor`, then navigate back to `/`. Confirm the card shows "Generating…" then flips to "Needs review" without a manual page reload, then to no badge once you open it and apply suggestions through to `ready`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/ResumeCard.tsx packages/web/components/DashboardClient.tsx
git commit -m "$(cat <<'EOF'
feat: show a "Needs review" badge for awaiting_review resumes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Self-Review Notes

- Spec coverage: Tasks 1-2 implement the data model; Task 3 implements groundedness + the apply function; Task 4 implements suggestion generation; Tasks 5-6 implement the pipeline/API surface; Tasks 7-9 implement the frontend review UI and progress stepper. Together these cover design spec section C in full, including the "impact on the progress stepper" callout.
- Type consistency checked: `Suggestion` (agent `types.ts` and web `lib/api.ts`) match field-for-field; `applySuggestions`'s return shape (`{ master, tailored }`) matches what Task 6's route destructures; `api.applySuggestions`'s response type (`{ id, status: "pending" }`) matches what `SuggestionChecklist`'s `onApplied` expects (it doesn't need the response body, just success/failure).
- No placeholders — every step shows the exact diff or full file content.
- Dependency order respected: Task 1 references `Suggestion` from Task 2 but both are committed together at the end of Task 2 (noted explicitly in Task 1 Step 6) rather than leaving a broken intermediate commit.
