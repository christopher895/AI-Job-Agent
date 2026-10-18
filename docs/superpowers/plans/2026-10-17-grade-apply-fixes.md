# Apply Grader Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a master-resume grade hand checked, edited bullet rewrites to `/resume/master` as unsaved, highlighted edits with a to-do banner; let an upload grade copy its text with fixes applied.

**Architecture:** Web-only. A pure module `lib/gradeFixes.ts` does matching, splicing, applying and the sessionStorage hand-off; `GradeReport.tsx` gains per-finding fix controls; `MasterResumeForm.tsx` reads the hand-off on mount and renders `GradeFixBanner`.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind; `tsx` test scripts.

**Spec:** `docs/superpowers/specs/2026-10-17-grade-apply-fixes-design.md`

## Global Constraints

- No agent/API/schema changes and no LLM calls.
- Nothing is written to the master resume until the user clicks Save Changes.
- A rewrite containing `[...]`, or empty, can never be applied.
- A fix applies only if the bullet's current text still equals the `original` captured at hand-off; otherwise it is skipped and reported.
- Hand-off key `grader:master-fixes` in sessionStorage; deleted on read; ignored if older than 10 minutes.
- Only bullet `text` changes; `id`, `tech`, `metrics`, `tags` are preserved.
- Partial matches require a normalized quote of at least 20 characters.
- Light backgrounds; existing paper/ink classes.

## Review Focus

1. **Same bullet text in two entries** (copy-pasted bullet) — must be classified as a to-do, never applied to the wrong one. Pinned in Task 1 (`ambiguous` test).
2. **Master edited between report and Apply** — the stale fix must be skipped, not overwrite the newer text. Pinned in Task 1 (`applyFixes` skip test).
3. **Refresh after landing on the editor** — must not re-apply. Pinned in Task 1 (delete-on-read test).
4. **Partial quote whose casing/spacing differs from the bullet** — must splice at the right span or fall back to to-do, never corrupt text. Pinned in Task 1 (partial splice tests).
5. **User navigates to the editor without a hand-off** — editor must behave exactly as before. Covered by Task 3 manual check (no banner, no highlight).

---

### Task 1: Pure fix logic

**Files:**
- Create: `packages/web/lib/gradeFixes.ts`
- Test: `packages/web/lib/test-grade-fixes.ts`
- Modify: `packages/web/package.json` (add `test:grade-fixes`, chain into `test`)

**Interfaces — Produces:**
- `normalize(s: string): string`
- `hasPlaceholder(s: string): boolean`
- `type BulletMatch = { status: "match"; bulletId: string; owner: string; section: "Experience" | "Projects" | "Extracurriculars"; start: number; end: number; whole: boolean } | { status: "none" } | { status: "ambiguous" }`
- `matchBullet(master: MasterResume, quote: string): BulletMatch`
- `type FindingFix = { kind: "applicable"; match: Extract<BulletMatch, { status: "match" }>; original: string } | { kind: "todo"; unmatched: boolean }`
- `classifyFindings(master: MasterResume, findings: GradeFinding[]): Map<string, FindingFix>`
- `splice(original: string, match: { start: number; end: number; whole: boolean }, edited: string): string`
- `type MasterFix = { bulletId: string; original: string; text: string; title: string }`
- `applyFixes(master: MasterResume, fixes: MasterFix[]): { resume: MasterResume; applied: string[]; skipped: MasterFix[] }`
- `sectionOfBullet(master: MasterResume, bulletId: string): "Experience" | "Projects" | "Extracurriculars" | null`
- `findInText(text: string, quote: string): { start: number; end: number } | null` (null unless exactly one occurrence)
- `fixedResumeText(text: string, edits: { quote: string; text: string }[]): { text: string; replaced: number }`
- `HANDOFF_KEY`, `HANDOFF_TTL_MS`, `type Handoff`, `writeHandoff(storage, h)`, `readHandoff(storage, now?)`

- [ ] **Step 1: Write the failing test** — `packages/web/lib/test-grade-fixes.ts`:

```ts
import {
  normalize, hasPlaceholder, matchBullet, classifyFindings, splice, applyFixes, sectionOfBullet,
  findInText, fixedResumeText, writeHandoff, readHandoff, HANDOFF_KEY, HANDOFF_TTL_MS, Handoff,
} from "./gradeFixes";
import type { GradeFinding, MasterResume } from "./api";

let pass = true;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) { pass = false; console.log(`   ✗ [${label}] ${detail ?? "failed"}`); }
}

const bullet = (id: string, text: string) => ({ id, text, tech: ["TS"], metrics: ["40%"], tags: ["backend"] });
const master: MasterResume = {
  basics: { name: "N", location: "", email: "", phone: "", github: "", linkedin: "", portfolio: "", summary: "" },
  education: [],
  experience: [
    { id: "exp-a", company: "Scout Motors", title: "AI Engineer", location: "", start: "", end: "", bullets: [
      bullet("a1", "Architected an AI developer platform with MCP and LLM orchestration to streamline deployments."),
      bullet("a2", "Built a caching layer that cut p95 latency 40% for 2,000 users"),
    ] },
    { id: "exp-b", company: "Mandy", title: "SWE", location: "", start: "", end: "", bullets: [
      bullet("b1", "Shipped features"),
    ] },
  ],
  projects: [
    { id: "p", name: "Travel Planner", tech: [], start: "", end: "", link: "", repo: "", bullets: [
      bullet("p1", "Shipped features"),
      bullet("p2", "Engineered an A* router with LRU caching for 200+ mile routes"),
    ] },
  ],
  extracurriculars: [
    { id: "x", company: "Waves Swim Team", title: "Captain", location: "", start: "", end: "", bullets: [
      bullet("x1", "Led a 40-person team through a championship season"),
    ] },
  ],
  skills: { languages: [], frameworks: [], tools: [], interests: [] },
  aboutMe: "",
};

// normalize
check("normalize strips marker, bold, period, case, space",
  normalize("- **Built**  a  Thing.") === "built a thing");
check("normalize unifies dashes and curly quotes",
  normalize("Led “core” work — fast") === normalize('Led "core" work - fast'));

// placeholders
check("placeholder [X%]", hasPlaceholder("cut [X%]"));
check("placeholder [N users]", hasPlaceholder("for [N users]"));
check("no placeholder in plain text", !hasPlaceholder("cut 40%"));
check("parentheses are not placeholders", !hasPlaceholder("cut 40% (p95)"));

// matchBullet
const whole = matchBullet(master, "- Architected an AI developer platform with MCP and LLM orchestration to streamline deployments");
check("whole match ignores marker and trailing period",
  whole.status === "match" && whole.bulletId === "a1" && whole.whole && whole.owner === "Scout Motors" && whole.section === "Experience");
const partial = matchBullet(master, "cut p95 latency 40% for 2,000 users");
check("partial match ≥20 chars finds the span",
  partial.status === "match" && partial.bulletId === "a2" && !partial.whole &&
  master.experience[0].bullets[1].text.slice(partial.start, partial.end) === "cut p95 latency 40% for 2,000 users");
const partialCase = matchBullet(master, "CUT P95 LATENCY 40% FOR 2,000 USERS");
check("partial match is case-insensitive and keeps original span",
  partialCase.status === "match" && master.experience[0].bullets[1].text.slice(partialCase.start, partialCase.end) === "cut p95 latency 40% for 2,000 users");
check("short partial (<20) does not match", matchBullet(master, "cut p95").status === "none");
check("same text in two entries is ambiguous", matchBullet(master, "Shipped features").status === "ambiguous");
const extra = matchBullet(master, "Led a 40-person team through a championship season");
check("extracurricular bullets match", extra.status === "match" && extra.section === "Extracurriculars" && extra.owner === "Waves Swim Team");
check("unknown text is none", matchBullet(master, "Frameworks: React, Node.js").status === "none");

// classifyFindings
const f = (id: string, quote: string | null): GradeFinding => ({
  id, category: "content", title: id, severity: "high", quote, problem: "p", rewrite: "r", groundedness: "grounded",
});
const classes = classifyFindings(master, [f("q-null", null), f("q-none", "Frameworks: React"), f("q-amb", "Shipped features"), f("q-ok", "Shipped features? no"), f("q-a1", "Architected an AI developer platform with MCP and LLM orchestration to streamline deployments.")]);
check("null quote → todo (not unmatched)", classes.get("q-null")?.kind === "todo" && !(classes.get("q-null") as { unmatched: boolean }).unmatched);
check("unmatched quote → todo, unmatched", classes.get("q-none")?.kind === "todo" && (classes.get("q-none") as { unmatched: boolean }).unmatched);
check("ambiguous quote → todo, unmatched", classes.get("q-amb")?.kind === "todo");
const ok = classes.get("q-a1");
check("single match → applicable with original text",
  ok?.kind === "applicable" && ok.match.bulletId === "a1" && ok.original === master.experience[0].bullets[0].text);

// splice
check("whole splice replaces everything", splice("old text", { start: 0, end: 8, whole: true }, "new") === "new");
check("partial splice keeps surrounding text",
  splice("Built a cache that cut it 40% today", { start: 19, end: 29, whole: false }, "cut it [X%]") === "Built a cache that cut it [X%] today");

// applyFixes
const a1 = master.experience[0].bullets[0];
const res = applyFixes(master, [
  { bulletId: "a1", original: a1.text, text: "Architected a platform used by 30 engineers", title: "t1" },
  { bulletId: "x1", original: "stale text", text: "should not apply", title: "t2" },
  { bulletId: "missing", original: "x", text: "y", title: "t3" },
]);
check("applied fix replaces text", res.resume.experience[0].bullets[0].text === "Architected a platform used by 30 engineers");
check("applied fix keeps id/tech/metrics/tags",
  JSON.stringify({ ...res.resume.experience[0].bullets[0], text: "" }) === JSON.stringify({ ...a1, text: "" }));
check("stale fix is skipped", res.resume.extracurriculars[0].bullets[0].text === master.extracurriculars[0].bullets[0].text);
check("applied/skipped reported", res.applied.join() === "a1" && res.skipped.map((s) => s.bulletId).join() === "x1,missing");
check("input master not mutated", master.experience[0].bullets[0].text === a1.text);
check("other bullets untouched", res.resume.projects[0].bullets[1].text === master.projects[0].bullets[1].text);

// sectionOfBullet
check("sectionOfBullet finds projects", sectionOfBullet(master, "p2") === "Projects");
check("sectionOfBullet unknown → null", sectionOfBullet(master, "zzz") === null);

// upload text
const text = "Jane\n- Built a cache that cut latency 40%\n- Wrote docs\n- Wrote docs";
check("findInText unique line", findInText(text, "- Built a cache that cut latency 40%.") !== null);
check("findInText duplicate → null", findInText(text, "Wrote docs") === null);
const fixed = fixedResumeText(text, [
  { quote: "Built a cache that cut latency 40%", text: "Built a Redis cache that cut latency 40%" },
  { quote: "Wrote docs", text: "never applied" },
]);
check("fixedResumeText replaces unique quotes only",
  fixed.replaced === 1 && fixed.text.includes("Built a Redis cache that cut latency 40%") && !fixed.text.includes("never applied"));

// hand-off
const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
const h: Handoff = { gradeId: "g", targetRole: "ml", level: "intern", jdText: null, createdAt: 1000,
  fixes: [{ bulletId: "a1", original: "o", text: "t", title: "x" }], todos: [] };
writeHandoff(storage, h);
check("handoff round-trips", JSON.stringify(readHandoff(storage, 2000)) === JSON.stringify(h));
check("handoff deleted after read", !store.has(HANDOFF_KEY) && readHandoff(storage, 2000) === null);
writeHandoff(storage, h);
check("expired handoff → null", readHandoff(storage, 1000 + HANDOFF_TTL_MS + 1) === null && !store.has(HANDOFF_KEY));
store.set(HANDOFF_KEY, "{not json");
check("malformed handoff → null and deleted", readHandoff(storage, 2000) === null && !store.has(HANDOFF_KEY));
store.set(HANDOFF_KEY, JSON.stringify({ ...h, fixes: "nope" }));
check("wrong-shape handoff → null", readHandoff(storage, 2000) === null);

console.log(pass ? "\n✓ grade-fixes test PASSED" : "\n✗ grade-fixes test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 2: Run it — expect FAIL** `Cannot find module './gradeFixes'`. Run: `cd packages/web && npx tsx lib/test-grade-fixes.ts`

- [ ] **Step 3: Implement `packages/web/lib/gradeFixes.ts`:**

```ts
import type { GradeFinding, Level, MasterResume, TargetRole } from "./api";

/**
 * Turns grader findings into resume edits without another LLM call — see
 * docs/superpowers/specs/2026-10-17-grade-apply-fixes-design.md.
 */

type FixSection = "Experience" | "Projects" | "Extracurriculars";

/** Comparison form: what a grader quote and a stored bullet share even when punctuation drifts. */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-•*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
}

/** Lighter cleanup for splicing: keep the quote's own characters, drop only wrapping. */
function cleanQuote(s: string): string {
  return s.replace(/\*\*/g, "").replace(/^\s*[-•*]\s+/, "").trim().replace(/\.$/, "");
}

export function hasPlaceholder(s: string): boolean {
  return /\[[^\]\n]+\]/.test(s);
}

type Group = { owner: string; section: FixSection; bullets: { id: string; text: string }[] };

function groups(m: MasterResume): Group[] {
  return [
    ...m.experience.map((e) => ({ owner: e.company, section: "Experience" as const, bullets: e.bullets })),
    ...m.projects.map((p) => ({ owner: p.name, section: "Projects" as const, bullets: p.bullets })),
    ...m.extracurriculars.map((e) => ({ owner: e.company, section: "Extracurriculars" as const, bullets: e.bullets })),
  ];
}

export type BulletMatch =
  | { status: "match"; bulletId: string; owner: string; section: FixSection; start: number; end: number; whole: boolean }
  | { status: "none" }
  | { status: "ambiguous" };

const MIN_PARTIAL = 20;

/**
 * Exactly one bullet must match. Whole-bullet equality (normalized) first;
 * otherwise a case-insensitive substring of ≥20 chars, located in the
 * bullet's own text so the splice keeps its original characters around it.
 */
export function matchBullet(master: MasterResume, quote: string): BulletMatch {
  const nq = normalize(quote);
  if (!nq) return { status: "none" };
  const all = groups(master).flatMap((g) => g.bullets.map((b) => ({ g, b })));

  const whole = all.filter(({ b }) => normalize(b.text) === nq);
  if (whole.length > 1) return { status: "ambiguous" };
  if (whole.length === 1) {
    const { g, b } = whole[0];
    return { status: "match", bulletId: b.id, owner: g.owner, section: g.section, start: 0, end: b.text.length, whole: true };
  }

  if (nq.length < MIN_PARTIAL) return { status: "none" };
  const needle = cleanQuote(quote).toLowerCase();
  const partial = all
    .map(({ g, b }) => ({ g, b, at: b.text.toLowerCase().indexOf(needle) }))
    .filter((x) => x.at >= 0);
  if (partial.length > 1) return { status: "ambiguous" };
  if (partial.length === 0) return { status: "none" };
  const { g, b, at } = partial[0];
  return { status: "match", bulletId: b.id, owner: g.owner, section: g.section, start: at, end: at + needle.length, whole: false };
}

export type FindingFix =
  | { kind: "applicable"; match: Extract<BulletMatch, { status: "match" }>; original: string }
  | { kind: "todo"; unmatched: boolean };

export function classifyFindings(master: MasterResume, findings: GradeFinding[]): Map<string, FindingFix> {
  const out = new Map<string, FindingFix>();
  const textOf = new Map(groups(master).flatMap((g) => g.bullets.map((b) => [b.id, b.text] as const)));
  for (const f of findings) {
    if (!f.quote) { out.set(f.id, { kind: "todo", unmatched: false }); continue; }
    const m = matchBullet(master, f.quote);
    out.set(f.id, m.status === "match"
      ? { kind: "applicable", match: m, original: textOf.get(m.bulletId)! }
      : { kind: "todo", unmatched: true });
  }
  return out;
}

/** The full new bullet text: the edit replaces the whole bullet or just the quoted span. */
export function splice(original: string, m: { start: number; end: number; whole: boolean }, edited: string): string {
  return m.whole ? edited : original.slice(0, m.start) + edited + original.slice(m.end);
}

export type MasterFix = { bulletId: string; original: string; text: string; title: string };

export function applyFixes(
  master: MasterResume,
  fixes: MasterFix[]
): { resume: MasterResume; applied: string[]; skipped: MasterFix[] } {
  const resume: MasterResume = structuredClone(master);
  const byId = new Map(groups(resume).flatMap((g) => g.bullets.map((b) => [b.id, b] as const)));
  const applied: string[] = [];
  const skipped: MasterFix[] = [];
  for (const fix of fixes) {
    const b = byId.get(fix.bulletId);
    // The bullet changed since the report was read — never overwrite newer text.
    if (!b || b.text !== fix.original) { skipped.push(fix); continue; }
    b.text = fix.text;
    applied.push(fix.bulletId);
  }
  return { resume, applied, skipped };
}

export function sectionOfBullet(master: MasterResume, bulletId: string): FixSection | null {
  return groups(master).find((g) => g.bullets.some((b) => b.id === bulletId))?.section ?? null;
}

/** Span of the quote in free text, only when it occurs exactly once (case-insensitive). */
export function findInText(text: string, quote: string): { start: number; end: number } | null {
  const needle = cleanQuote(quote).toLowerCase();
  if (!needle) return null;
  const hay = text.toLowerCase();
  const first = hay.indexOf(needle);
  if (first < 0 || hay.indexOf(needle, first + 1) >= 0) return null;
  return { start: first, end: first + needle.length };
}

export function fixedResumeText(text: string, edits: { quote: string; text: string }[]): { text: string; replaced: number } {
  let out = text;
  let replaced = 0;
  for (const e of edits) {
    const span = findInText(out, e.quote);
    if (!span) continue;
    out = out.slice(0, span.start) + e.text + out.slice(span.end);
    replaced++;
  }
  return { text: out, replaced };
}

// ── Hand-off from /grader/[id] to /resume/master ────────────────────────────

export const HANDOFF_KEY = "grader:master-fixes";
export const HANDOFF_TTL_MS = 10 * 60 * 1000;

export type Handoff = {
  gradeId: string;
  targetRole: TargetRole;
  level: Level;
  jdText: string | null;
  createdAt: number;
  fixes: MasterFix[];
  todos: { title: string; category: string; problem: string; rewrite: string | null }[];
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function writeHandoff(storage: Pick<Storage, "setItem">, h: Handoff): void {
  storage.setItem(HANDOFF_KEY, JSON.stringify(h));
}

/** Read once: always deletes the key, so a refresh never re-applies. */
export function readHandoff(storage: Pick<Store, "getItem" | "removeItem">, now = Date.now()): Handoff | null {
  const raw = storage.getItem(HANDOFF_KEY);
  if (raw === null) return null;
  storage.removeItem(HANDOFF_KEY);
  try {
    const h = JSON.parse(raw) as Handoff;
    if (typeof h?.createdAt !== "number" || !Array.isArray(h.fixes) || !Array.isArray(h.todos)) return null;
    if (now - h.createdAt > HANDOFF_TTL_MS) return null;
    return h;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run — expect PASS.** Fix any failing case by fixing code, not the test.
- [ ] **Step 5:** add `"test:grade-fixes": "tsx lib/test-grade-fixes.ts"` to web `package.json`, chain into `"test"`; `npx tsc --noEmit`.

---

### Task 2: Fix controls on the grade report

**Files:** Modify `packages/web/components/GradeReport.tsx`.

**Consumes:** Task 1 (`classifyFindings`, `splice`, `hasPlaceholder`, `findInText`, `fixedResumeText`, `writeHandoff`, `MasterFix`, `Handoff`); `api.getMasterResume()`.

Behavior (per spec):
- `mode = grade.source` (`"master" | "upload" | "tailored"`). Tailored keeps today's checkbox + "Fix N in the resume" exactly.
- **master:** on mount fetch master; `classes = classifyFindings(master, findings)`. Load failure → every finding treated as to-do and a note "Couldn't load your master resume to match lines."
- **upload:** a finding is applicable when `quote && findInText(grade.resume_text, quote)`; otherwise it has no fix controls (to-dos don't apply — there's no editor to hand them to).
- State: `edits: Record<findingId, string>` initialised from `rewrite ?? ""`; `checked: Set<string>`, defaulting to applicable findings with severity ≠ low whose rewrite is non-empty and placeholder-free.
- Applicable card: checkbox (disabled when edit is empty or `hasPlaceholder(edit)`; unchecks itself when that becomes true), "Applies to: {owner}" (master) , the rewrite becomes an auto-sized `<textarea>` with the Copy button, badge "Ready" (green) or "Fill in the [ ] parts" (amber).
- Master to-do card: checkbox "Add to to-do list"; when `unmatched`, muted note "Couldn't match this to a single bullet — edit by hand"; rewrite box shown read-only as today.
- Action bar (above findings):
  - master: **Apply {n} to master resume** (+ "and {t} to-dos" when t>0), enabled when n+t>0. On click: build `fixes: MasterFix[]` with `text = splice(original, match, edit)`, `todos` from checked to-dos; `writeHandoff(sessionStorage, {...})` in try/catch (failure → inline error "Your browser blocked session storage"); `router.push("/resume/master")`.
  - upload: **Copy fixed resume text** → `navigator.clipboard.writeText(fixedResumeText(resume_text, checked edits).text)`, label flips to "Copied ✓ ({replaced} fixes)".

Verify: `npx tsc --noEmit`, `npx eslint components/GradeReport.tsx`, browser check on a master grade and an upload grade.

---

### Task 3: Master editor hand-off, banner and highlights

**Files:** Create `packages/web/components/GradeFixBanner.tsx`; modify `packages/web/components/MasterResumeForm.tsx`.

**Consumes:** Task 1 (`readHandoff`, `applyFixes`, `sectionOfBullet`, `Handoff`); `api.createGrade`.

- `BulletList` gets an optional `highlighted?: ReadonlySet<string>` prop; a highlighted bullet's textarea adds `ring-2 ring-violet-300 bg-violet-50/40`. Pass it at all three call sites (experience, projects, extracurriculars).
- New state in `MasterResumeForm`: `gradeFix: { handoff: Handoff; applied: Set<string>; skipped: number; saved: boolean } | null`.
- Mount effect (deferred via `setTimeout(…, 0)` like GradeForm, for the set-state-in-effect lint rule): `readHandoff(sessionStorage)` in try/catch; if non-null, `applyFixes(initial, h.fixes)` → `setResume(result.resume)`, set `gradeFix`, and `setActiveSection(sectionOfBullet(initial, applied[0]) ?? "Basics")` when anything applied.
- `save()` success: if `gradeFix`, set `saved: true` and clear highlights (`applied: new Set()`).
- `GradeFixBanner` (rendered under the header, above the import panel) props: `{ appliedCount, skipped, todos, saved, onDiscard, onRegrade, regrading, regradeError }`:
  - unsaved: "**{n} fixes from your grade applied** — review the highlighted bullets, then Save Changes." + skipped line + [Discard].
  - saved: "Saved. [Re-grade]".
  - Todos list (title · category, problem, suggestion when present), each with a dismiss ×; dismissed state local to the banner.
  - Close × on the banner hides it once saved.
- Discard: `setResume(initial)`, `setGradeFix(null)`.
- Re-grade: `api.createGrade({ source: "master", targetRole, level, jdText: jdText ?? undefined })` → `router.push(\`/grader/${id}\`)`; error shows in banner.

Verify: tsc, eslint, `npm run build`, browser: open `/resume/master` directly → no banner; full flow report → Apply → highlighted bullets + to-dos → Discard restores; repeat → Save → Re-grade lands on a pending grade; refresh after landing shows no banner.

---

### Task 4: Docs and verification

- CLAUDE.md: extend the Resume grader bullet and `/grader/[id]` row with the apply flow; add `lib/gradeFixes.ts` and `components/GradeFixBanner.tsx` to the web tree.
- Spec status → "Approved; implemented".
- `npm test` (root) green; final whole-branch review of these changes; then commit to `feat/resume-grader` and push (PR #164) when the user asks.
