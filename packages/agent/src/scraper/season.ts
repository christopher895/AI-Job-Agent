import { JobListing } from "./types";

/**
 * The deterministic half of the alert filter (docs/superpowers/specs/
 * 2026-10-18-smart-alerts-design.md). Repo listings carry season tags, so
 * they must match the target exactly. Company-board postings carry none, so
 * they are dropped only when the title plainly names a different season or
 * year — everything else is left for the AI judge.
 */

const OTHER_SEASON = /\b(fall|autumn|winter|spring)\b|\bco-?op\b/i;
const YEAR = /\b(20[23]\d)\b/g;

// The season comes from a free-text preference field.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function passesSeason(job: JobListing, target: string | null): boolean {
  const want = target?.trim().toLowerCase();
  if (!want) return true;

  if (job.terms) return job.terms.some((t) => t.trim().toLowerCase() === want);

  const seasonWord = want.split(/\s+/)[0];
  const seasonPattern = new RegExp(`\\b${escapeRegExp(seasonWord)}\\b`, "i");

  // A season-only tag ("Summer", "Spring/Summer") — the repo supplies the year.
  if (job.season) return seasonPattern.test(job.season);

  const targetYear = want.match(/\b(20[23]\d)\b/)?.[1];
  const title = job.title;
  const namesTargetSeason = seasonPattern.test(title);

  if (OTHER_SEASON.test(title) && !namesTargetSeason) return false;

  const years = [...title.matchAll(YEAR)].map((m) => m[1]);
  if (targetYear && years.length > 0 && !years.includes(targetYear)) return false;

  return true;
}
