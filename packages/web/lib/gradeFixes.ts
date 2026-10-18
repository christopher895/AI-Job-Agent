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

/**
 * Rewrites often arrive as "- text" because the grader reads bullets as lines;
 * the marker belongs to the layout, not the bullet, so it never gets stored.
 */
function stripMarker(s: string): string {
  return s.replace(/^\s*[-•*]\s+/, "");
}

/** The full new bullet text: the edit replaces the whole bullet or just the quoted span. */
export function splice(original: string, m: { start: number; end: number; whole: boolean }, edited: string): string {
  const text = stripMarker(edited);
  return m.whole ? text : original.slice(0, m.start) + keepOnePeriod(text, original, m.end) + original.slice(m.end);
}

/** The span stops before the original's own period; a rewrite ending in one would double it. */
function keepOnePeriod(text: string, original: string, end: number): string {
  return text.endsWith(".") && original[end] === "." ? text.slice(0, -1) : text;
}

export type FixStatus = "ready" | "empty" | "placeholder" | "confirm-number";

/**
 * Whether an edited rewrite can be applied as-is. An *unedited* rewrite the
 * grader flagged as needing input carries a number the resume doesn't have —
 * the model's guess, not a fact — so it is never pre-checked. Once edited, the
 * numbers are Christopher's own.
 */
export function fixStatus(f: GradeFinding, edit: string): FixStatus {
  if (!edit.trim()) return "empty";
  if (hasPlaceholder(edit)) return "placeholder";
  if (f.groundedness === "needs-your-input" && edit.trim() === (f.rewrite ?? "").trim()) return "confirm-number";
  return "ready";
}

/** Ids of checked fixes that target a bullet an earlier checked fix already rewrites. */
export function sameBulletConflicts(items: { id: string; bulletId: string }[]): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const it of items) {
    if (seen.has(it.bulletId)) out.add(it.id);
    else seen.add(it.bulletId);
  }
  return out;
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
    // The span excludes the line's own marker, so drop the rewrite's.
    out = out.slice(0, span.start) + keepOnePeriod(stripMarker(e.text), out, span.end) + out.slice(span.end);
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

/** Stamps createdAt here so callers (React event handlers) stay free of Date.now(). */
export function writeHandoff(storage: Pick<Storage, "setItem">, h: Omit<Handoff, "createdAt">, now = Date.now()): void {
  storage.setItem(HANDOFF_KEY, JSON.stringify({ ...h, createdAt: now }));
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
