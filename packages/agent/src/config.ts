export type Preferences = {
  titleKeywords: string[];
  requiredKeywords: string[];
  termFilter: string | null;
  targetLocations: string[];
  maxPerEmail: number;
  priorityCompanies: string[];
  watchedRepos: string[];
};

export const FILTERS: Preferences = {
  titleKeywords: [
    "software",
    "engineer",
    "developer",
    "swe",
    "sde",
    "ai",
    "backend",
    "frontend",
    "fullstack",
    "full stack",
  ],
  requiredKeywords: ["intern"],
  termFilter: null,
  targetLocations: [
    "new york",
    "seattle",
    "san francisco",
    "chicago",
    "los angeles",
    "remote",
  ],
  maxPerEmail: 5,
  priorityCompanies: [
    "Amazon",
    "Google",
    "Meta",
    "Apple",
    "Microsoft",
    "OpenAI",
    "Anthropic",
    "xAI",
    "Perplexity",
    "Cursor",
  ],
  watchedRepos: ["https://github.com/vanshb03/Summer2027-Internships"],
};

// ── Gmail ingestion tuning ───────────────────────────────────────────────────
export const MATCH_MIN_SCORE = 0.6;      // below this → review queue
export const MATCH_AMBIGUITY_MARGIN = 0.15; // top-2 within this → ambiguous → review queue
