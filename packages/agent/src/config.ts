export const FILTERS = {
  // Title must contain at least one of these (case-insensitive)
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

  // Title must contain ALL of these as whole words
  requiredKeywords: ["intern"] as string[],

  // Set to e.g. "2027" to only match Summer 2027 postings, or null for any
  termFilter: null as string | null,

  // Jobs must be in one of these cities (or remote/unspecified)
  targetLocations: [
    "new york",
    "seattle",
    "san francisco",
    "chicago",
    "los angeles",
    "remote",
  ],

  // Max jobs per email — sorted by score, top N only
  maxPerEmail: 5,

  // These companies get a score bonus — you want to hear about them first
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
