export const FILTERS = {
  // Title must contain at least one of these (case-insensitive)
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
    "data",
    "research",
  ],

  // Title must contain ALL of these (use for role type — e.g. "intern")
  requiredKeywords: ["intern"] as string[],

  // Set to e.g. "Summer 2027" to narrow by term, or null for any
  termFilter: null as string | null,
};
