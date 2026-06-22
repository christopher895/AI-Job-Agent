export const FILTERS = {
  // Job title must contain at least one of these (case-insensitive)
  titleKeywords: [
    "engineer",
    "software",
    "developer",
    "swe",
    "fullstack",
    "full-stack",
    "backend",
    "frontend",
    "ai",
    "ml",
    "machine learning",
  ],

  // Set to e.g. "Summer 2027" to only match that term, or null for all
  termFilter: null as string | null,
};
