/**
 * Résumé best-practice rules as STRUCTURED DATA (not a prose blob), so they can
 * be both (a) rendered into the tailoring prompt and (b) enforced by validation.
 *
 * Sourced from current (2024–2026) ATS + LLM-screener guidance and the actual
 * scoring rubric of the target grader, interviewstreet/hiring-agent.
 */

/** Duty-language openers to avoid — no ownership or impact. */
export const WEAK_PHRASES = [
  "responsible for",
  "worked on",
  "helped with",
  "assisted in",
  "tasked with",
  "duties included",
  "in charge of",
];

/** Preferred openers for SWE accomplishments (past tense). */
export const STRONG_ACTION_VERBS = [
  "Architected", "Engineered", "Built", "Designed", "Implemented", "Optimized",
  "Reduced", "Accelerated", "Scaled", "Migrated", "Automated", "Refactored",
  "Launched", "Shipped", "Streamlined", "Integrated", "Deployed", "Resolved",
  "Led", "Drove", "Delivered",
];

/**
 * Acronyms that should appear in BOTH short and spelled-out form at least once,
 * so exact-string ATS matchers connect them. Extend as the master résumé grows.
 */
export const ACRONYM_EXPANSIONS: Record<string, string> = {
  "CI/CD": "continuous integration / continuous deployment",
  "AWS": "Amazon Web Services",
  "EKS": "Elastic Kubernetes Service",
  "K8s": "Kubernetes",
  "ML": "machine learning",
  "AI": "artificial intelligence",
  "API": "application programming interface",
  "MCP": "Model Context Protocol",
  "LLM": "large language model",
  "CMS": "content management system",
};

export const BULLET_GUIDELINES = {
  maxLines: 2,
  idealWordRange: [12, 20] as const,
  recentRoleBulletCount: [3, 5] as const,
  olderRoleBulletCount: [2, 3] as const,
};

/** ATS-safe formatting invariants the rendered résumé must respect. */
export const ATS_FORMATTING_RULES = [
  "Single column, top-to-bottom; no tables, text boxes, columns, or icons.",
  "Contact info in the body, never in a header/footer (many parsers skip those).",
  "Standard section headings: Experience, Education, Skills, Projects.",
  "Standard font; export as text-based PDF or .docx (never a scanned image).",
  "Name the tech inside each bullet — it doubles as keyword placement.",
];

/**
 * The target grader's rubric. The critic loop scores drafts against this; the
 * tailorer optimizes for the levers it can move truthfully.
 */
export const HIRING_AGENT_RUBRIC = {
  buckets: [
    { name: "Open source", weight: 35, rewards: "PRs to OTHERS' repos, popular projects (1000+ stars), GSoC. Personal repos do NOT count." },
    { name: "Self projects", weight: 30, rewards: "Complex, real-world, advanced architecture, multiple technologies. A working link is decisive." },
    { name: "Production", weight: 25, rewards: "Real internship/work experience; founder / early-employee credit." },
    { name: "Technical skills", weight: 10, rewards: "Language and tool breadth demonstrated across work and projects." },
  ],
  bonuses: ["GSoC +5", "Founder +3–5", "Early engineer +2–3", "Portfolio site +2", "Tech blog +1–3", "LinkedIn +1"],
  penalties: [
    "Project without a link: −3 to −5 each (the single biggest lever).",
    "Tutorial-grade project (todo/calculator/weather/basic CRUD): −2 to −5.",
    "Generic project name: −1 each.",
  ],
  ignored: ["name", "gender", "college/university", "GPA", "city/location"],
} as const;

/** Renders the rules into a prompt block the tailorer/critic can consume. */
export function bestPracticesPromptBlock(): string {
  return [
    "BULLET FORMULA (XYZ): action verb + what you built (with named tech) + quantified impact.",
    `Length ${BULLET_GUIDELINES.idealWordRange[0]}–${BULLET_GUIDELINES.idealWordRange[1]} words, ≤${BULLET_GUIDELINES.maxLines} lines, one accomplishment each.`,
    `Recent roles: ${BULLET_GUIDELINES.recentRoleBulletCount.join("–")} bullets; older roles: ${BULLET_GUIDELINES.olderRoleBulletCount.join("–")}.`,
    `Start every bullet with a strong action verb (e.g. ${STRONG_ACTION_VERBS.slice(0, 8).join(", ")}).`,
    `Never use weak duty-language openers: ${WEAK_PHRASES.map((p) => `"${p}"`).join(", ")}.`,
    "Lead with before→after deltas and absolute scale. If no metric exists in the source, keep concrete scope — never invent a number.",
    `Include both acronym and spelled-out form once for: ${Object.keys(ACRONYM_EXPANSIONS).join(", ")} (only when truthful).`,
    "Reorder bullets and skills so the JD-most-relevant lead. Cut what's irrelevant.",
    `Target grader weights: ${HIRING_AGENT_RUBRIC.buckets.map((b) => `${b.name} ${b.weight}`).join(", ")}. It ignores ${HIRING_AGENT_RUBRIC.ignored.join("/")}.`,
    "ATS formatting: " + ATS_FORMATTING_RULES.join(" "),
  ].join("\n");
}
