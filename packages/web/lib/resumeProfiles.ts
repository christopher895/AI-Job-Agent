import type { ResumeProfile } from "./api";

/**
 * Client-side mirror of packages/agent/src/ai/resume-profiles.ts's
 * pickProfile — lets /tailor show which profile "Auto" will use. The server
 * makes the real choice (it also sees a title fetched from the job URL), so a
 * drift here only mislabels the hint; test-resume-profiles.ts pins both to
 * the same cases.
 */

export const DEFAULT_PROFILE_ID = 1;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function titleHasKeyword(title: string, keyword: string): boolean {
  const kw = keyword.trim();
  if (!kw) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(kw)}($|[^a-z0-9])`, "i").test(title);
}

export function pickProfile(
  title: string | null | undefined,
  profiles: Pick<ResumeProfile, "id" | "keywords">[]
): number {
  const t = title?.trim() ?? "";
  if (t) {
    const candidates = profiles.filter((p) => p.id !== DEFAULT_PROFILE_ID).sort((a, b) => a.id - b.id);
    for (const p of candidates) {
      if (p.keywords.some((k) => titleHasKeyword(t, k))) return p.id;
    }
  }
  return DEFAULT_PROFILE_ID;
}

/** "ML, machine learning" → ["ML", "machine learning"]; the server normalizes again. */
export function parseKeywordInput(text: string): string[] {
  return text.split(",").map((k) => k.trim()).filter(Boolean);
}
