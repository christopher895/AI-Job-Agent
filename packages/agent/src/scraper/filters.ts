import { FILTERS } from "../config";
import { JobListing } from "./playwright";

export function matchesFilters(title: string): boolean {
  const lower = title.toLowerCase();

  // All requiredKeywords must appear as whole words
  if (FILTERS.requiredKeywords.some((kw) => !new RegExp(`\\b${kw}\\b`, "i").test(title))) return false;

  // termFilter must appear if set
  if (FILTERS.termFilter && !lower.includes(FILTERS.termFilter.toLowerCase())) return false;

  // At least one titleKeyword must appear
  return FILTERS.titleKeywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export function matchesLocation(location: string): boolean {
  // No location specified — let it through, we can't be sure it's wrong
  if (!location || location.trim() === "") return true;

  const lower = location.toLowerCase();

  // Remote is always fine
  if (lower.includes("remote") || lower.includes("anywhere")) return true;

  // Must match at least one target city
  return FILTERS.targetLocations.some((city) => lower.includes(city));
}

const AI_ROLE_KEYWORDS = [
  "ai engineer",
  "ml engineer",
  "machine learning",
  "research engineer",
  "research scientist",
];

const SWE_ROLE_KEYWORDS = [
  "software engineer",
  "software developer",
  "swe",
  "backend",
  "frontend",
  "fullstack",
  "full stack",
];

export function scoreJob(job: JobListing): number {
  const title = job.title.toLowerCase();
  const location = (job.location ?? "").toLowerCase();
  let score = 0;

  // Role tier
  if (AI_ROLE_KEYWORDS.some((kw) => title.includes(kw))) score += 50;
  else if (SWE_ROLE_KEYWORDS.some((kw) => title.includes(kw))) score += 35;
  else score += 20;

  // Priority company bonus
  if (FILTERS.priorityCompanies.map((c) => c.toLowerCase()).includes(job.company.toLowerCase())) {
    score += 30;
  }

  // Target location bonus
  if (location === "" || location.includes("remote")) {
    score += 10;
  } else if (FILTERS.targetLocations.some((city) => location.includes(city))) {
    score += 20;
  }

  return score;
}
