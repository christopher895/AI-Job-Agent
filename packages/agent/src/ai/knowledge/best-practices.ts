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

/**
 * Keyword repetition ceiling. The hiring-agent doesn't count keywords at all,
 * and generic ATS ranking benefit flattens after ~3 contextual mentions while
 * Greenhouse/Lever AI layers PENALIZE unnatural repetition. So a JD term should
 * appear at most this many times across the whole résumé. (Source: ATS keyword
 * research — frequency caps at ~3–4 with diminishing/negative returns after.)
 */
export const KEYWORD_REPEAT_CAP = 3;

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

/**
 * Renders the rules into a prompt block the tailorer/critic can consume.
 *
 * This is GUIDANCE for the writing agent, not a rigid gate — phrased as
 * principles, with the lists above given only as ILLUSTRATIVE examples. Use your
 * judgment: the examples show the shape of good/bad writing, they are not an
 * exhaustive allow/deny list. (The non-negotiable, countable guarantees — no
 * fabrication, every role/project quantified, no keyword stuffing, ATS-safe
 * layout — are enforced deterministically in format.ts / grounding.ts, so you
 * can focus here on writing well.)
 */
export function bestPracticesPromptBlock(): string {
  return [
    "PRINCIPLES (apply judgment; the lists are examples, not exhaustive rules):",
    "",
    "Write every bullet as XYZ: a strong past-tense action verb + what you built (name the tech) + a quantified result. Lead with before→after deltas and absolute scale.",
    `  e.g. strong verbs: ${STRONG_ACTION_VERBS.slice(0, 8).join(", ")}, … — any vivid ownership verb works, not only these.`,
    `  Avoid duty-language that signals no ownership (e.g. ${WEAK_PHRASES.slice(0, 4).map((p) => `"${p}"`).join(", ")}, …).`,
    "Quantify wherever a number truthfully exists in the source — latency, %, users, scale, time saved, $. If the source has no number, keep concrete scope; NEVER invent one.",
    `Keep bullets ${BULLET_GUIDELINES.idealWordRange[0]}–${BULLET_GUIDELINES.idealWordRange[1]} words, ≤${BULLET_GUIDELINES.maxLines} lines, one accomplishment each; ~${BULLET_GUIDELINES.recentRoleBulletCount.join("–")} bullets for recent roles, ${BULLET_GUIDELINES.olderRoleBulletCount.join("–")} for older.`,
    "Frame each project by what it actually does and its real-world impact — complexity, architecture, scale, users. Don't describe real work in trivial/tutorial terms; don't bolt impressive-sounding framing onto work that lacks it.",
    "Reorder bullets and skills so the JD-most-relevant lead; cut what's irrelevant. Mirror the JD's exact terminology where the underlying fact supports it — but a keyword earns nothing past a few honest mentions, so don't stuff.",
    `When truthful, spell out acronyms once (e.g. ${Object.keys(ACRONYM_EXPANSIONS).slice(0, 5).join(", ")}) so exact-string matchers connect them.`,
    "",
    `Target grader weights: ${HIRING_AGENT_RUBRIC.buckets.map((b) => `${b.name} ${b.weight}`).join(", ")}. It ignores ${HIRING_AGENT_RUBRIC.ignored.join("/")}.`,
    "ATS formatting: " + ATS_FORMATTING_RULES.join(" "),
  ].join("\n");
}
