export type Preferences = {
  titleKeywords: string[];
  requiredKeywords: string[];
  termFilter: string | null;
  targetLocations: string[];
  maxPerEmail: number;
  priorityCompanies: string[];
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
};
