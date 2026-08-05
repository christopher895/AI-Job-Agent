import { MATCH_MIN_SCORE, MATCH_AMBIGUITY_MARGIN } from "../config";

export type MatchCandidate = { id: string; company: string; role: string };
export type MatchResult = { applicationId: string; score: number } | null;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Token Jaccard similarity of two strings, 0..1. */
function jaccard(a: string, b: string): number {
  const sa = new Set(norm(a).split(" ").filter(Boolean));
  const sb = new Set(norm(b).split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Company weighted more than role — a right-company/wrong-role email is usually still the right application. */
function score(candidate: MatchCandidate, target: { company: string; role: string }): number {
  const companySim = jaccard(candidate.company, target.company);
  const roleSim = jaccard(candidate.role, target.role);
  return 0.7 * companySim + 0.3 * roleSim;
}

export function matchApplication(
  candidates: MatchCandidate[],
  target: { company: string; role: string },
  opts: { minScore?: number; margin?: number } = {}
): MatchResult {
  const minScore = opts.minScore ?? MATCH_MIN_SCORE;
  const margin = opts.margin ?? MATCH_AMBIGUITY_MARGIN;
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((c) => ({ id: c.id, score: score(c, target) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (top.score < minScore) return null;                       // nothing confident
  if (ranked[1] && top.score - ranked[1].score < margin) return null; // ambiguous
  return { applicationId: top.id, score: top.score };
}
