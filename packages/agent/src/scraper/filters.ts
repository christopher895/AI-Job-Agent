import { FILTERS, Preferences } from "../config";
import { JobListing } from "./playwright";

let activePrefs: Preferences = FILTERS;

export function applyPreferences(prefs: Preferences): void {
  activePrefs = prefs;
}

export function matchesFilters(title: string): boolean {
  const lower = title.toLowerCase();

  if (activePrefs.requiredKeywords.some((kw) => !new RegExp(`\\b${kw}\\b`, "i").test(title))) return false;
  if (activePrefs.termFilter && !lower.includes(activePrefs.termFilter.toLowerCase())) return false;
  return activePrefs.titleKeywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export function matchesLocation(location: string): boolean {
  if (!location || location.trim() === "") return true;

  const lower = location.toLowerCase();
  if (lower.includes("remote") || lower.includes("anywhere")) return true;
  return activePrefs.targetLocations.some((city) => lower.includes(city));
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

  if (AI_ROLE_KEYWORDS.some((kw) => title.includes(kw))) score += 50;
  else if (SWE_ROLE_KEYWORDS.some((kw) => title.includes(kw))) score += 35;
  else score += 20;

  if (activePrefs.priorityCompanies.map((c) => c.toLowerCase()).includes(job.company.toLowerCase())) {
    score += 30;
  }

  if (location === "" || location.includes("remote")) {
    score += 10;
  } else if (activePrefs.targetLocations.some((city) => location.includes(city))) {
    score += 20;
  }

  return score;
}
