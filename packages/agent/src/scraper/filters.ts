import { FILTERS, Preferences } from "../config";
import { JobListing } from "./types";

let activePrefs: Preferences = FILTERS;

export function applyPreferences(prefs: Preferences): void {
  activePrefs = prefs;
}

// Required keywords match on word boundaries, but "intern" alone misses how
// employers actually title internships: banks post "Summer Analyst", and
// /\bintern\b/ rejects both "Internship" and "Co-Op". The alternatives are
// spelled out rather than prefix-matched (/\bintern/) on purpose — a prefix
// would swallow "Internal Audit", "Internal Controls" and "International".
const REQUIRED_KEYWORD_SYNONYMS: Record<string, string[]> = {
  intern: ["intern", "interns", "internship", "internships", "summer analyst", "co-op", "coop"],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// \b only asserts a boundary next to a word character, so anchoring a keyword
// like "c++" with a trailing \b would never match ("C++ Engineer"). Anchor each
// end only when the keyword actually ends in a word character.
function bounded(keyword: string): string {
  const lead = /^\w/.test(keyword) ? "\\b" : "";
  const trail = /\w$/.test(keyword) ? "\\b" : "";
  return `${lead}${escapeRegExp(keyword)}${trail}`;
}

// Preferences are user-editable, so a stored keyword can be anything — escape
// it before it reaches the RegExp constructor (an unescaped "c++" throws).
function requiredKeywordPattern(keyword: string): RegExp {
  const alternatives = REQUIRED_KEYWORD_SYNONYMS[keyword.toLowerCase()] ?? [keyword];
  return new RegExp(`(?:${alternatives.map(bounded).join("|")})`, "i");
}

export function matchesFilters(title: string): boolean {
  const lower = title.toLowerCase();

  if (activePrefs.requiredKeywords.some((kw) => !requiredKeywordPattern(kw).test(title))) return false;
  if (activePrefs.termFilter && !lower.includes(activePrefs.termFilter.toLowerCase())) return false;
  return activePrefs.titleKeywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// Extract the city portion from a stored preference like "New York, New York" or legacy "new york"
function cityToken(pref: string): string {
  return pref.toLowerCase().split(",")[0].trim();
}

export function matchesLocation(location: string): boolean {
  if (!location || location.trim() === "") return true;

  const lower = location.toLowerCase();
  if (lower.includes("remote") || lower.includes("anywhere")) return true;
  return activePrefs.targetLocations.some((pref) => lower.includes(cityToken(pref)));
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
  } else if (activePrefs.targetLocations.some((pref) => location.includes(cityToken(pref)))) {
    score += 20;
  }

  return score;
}
