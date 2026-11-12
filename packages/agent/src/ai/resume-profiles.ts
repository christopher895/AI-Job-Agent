/**
 * Resume profiles — several base resumes (e.g. "Main" for SWE, "ML" for
 * machine-learning roles) that tailoring can start from. Profile 1 is the
 * original master resume: it always exists, can't be deleted, and is the
 * fallback whenever nothing else matches. Pure helpers only; DB access lives
 * in db/queries.ts.
 */

export const DEFAULT_PROFILE_ID = 1;
export const MAX_PROFILE_NAME = 60;
export const MAX_PROFILE_KEYWORDS = 30;

export type ProfileSummary = { id: number; name: string; keywords: string[] };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive: "ML" matches "ML Engineer Intern" but not "HTML". */
export function titleHasKeyword(title: string, keyword: string): boolean {
  const kw = keyword.trim();
  if (!kw) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(kw)}($|[^a-z0-9])`, "i").test(title);
}

/**
 * The profile a job should start from, judged on its title alone — a SWE
 * posting's JD often lists "machine learning" under nice-to-haves, so the body
 * would pull ordinary SWE roles onto the ML profile. The first non-default
 * profile (lowest id) with a keyword in the title wins; otherwise the default.
 */
export function pickProfile(title: string | null | undefined, profiles: ProfileSummary[]): number {
  const t = title?.trim() ?? "";
  if (t) {
    const candidates = profiles
      .filter((p) => p.id !== DEFAULT_PROFILE_ID)
      .sort((a, b) => a.id - b.id);
    for (const p of candidates) {
      if (p.keywords.some((k) => titleHasKeyword(t, k))) return p.id;
    }
  }
  return DEFAULT_PROFILE_ID;
}

/** Accepts an array or a comma-separated string; trims, drops blanks and case-insensitive duplicates. */
export function normalizeKeywords(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const k = item.trim().slice(0, 60);
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
    if (out.length >= MAX_PROFILE_KEYWORDS) break;
  }
  return out;
}

/** A positive integer id from a body/query value, or null when it isn't one. */
export function parseProfileId(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * POST /api/tailor's `baseResumeId`: omitted, null or "auto" → pick by title;
 * a number → that profile. Anything else is a client bug.
 */
export function parseBaseResumeChoice(v: unknown): { ok: true; value: number | "auto" } | { ok: false } {
  if (v === undefined || v === null || v === "" || v === "auto") return { ok: true, value: "auto" };
  const id = parseProfileId(v);
  return id === null ? { ok: false } : { ok: true, value: id };
}
