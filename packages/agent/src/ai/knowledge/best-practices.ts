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
 * Resume-Worded-style rubric. The critic loop scores drafts against this;
 * the tailorer optimizes for the levers it can move truthfully. Unlike the
 * hiring-agent rubric this replaces, every bucket here is something a
 * rewrite can actually change — it does not score which credentials the
 * candidate happens to have.
 */
export const RESUME_QUALITY_RUBRIC = {
  buckets: [
    { name: "Weak roles", weight: 60, rewards: "Each role/project tells a specific, credible, impactful story — not a duty list. Reward concrete scope, ownership, and outcome; penalize generic or interchangeable-sounding bullets." },
    { name: "Brevity & Style", weight: 40, rewards: "Concise, active voice, no buzzword/cliché/filler pile-up, easy to scan." },
  ],
  ignored: ["name", "gender", "college/university", "GPA", "city/location"],
} as const;

/** Self-praise clichés — distinct from FILLER_WORDS below (these oversell, filler pads). */
export const BUZZWORDS_CLICHES = [
  "team player", "results-driven", "results-oriented", "synergy", "detail-oriented",
  "self-starter", "go-getter", "proven track record", "think outside the box",
  "hardworking", "dynamic", "passionate", "motivated individual", "excellent communication skills",
];

/** Structural padding — hedge words and throat-clearing, not self-praise. */
export const FILLER_WORDS = [
  "very", "really", "just", "basically", "actually", "in order to", "a lot of",
  "numerous", "various", "successfully", "efficiently", "effectively",
];

/** First-person pronouns — resume bullets use implied first person; zero-tolerance. Regex source strings (compiled per-use with the `i` flag). */
export const PERSONAL_PRONOUNS = ["\\bi\\b", "\\bme\\b", "\\bmy\\b", "\\bmyself\\b"];

/** Non-standard glyphs an ATS text-extraction pass may drop, mis-split, or choke on. Safe set: hyphen, standard "•" bullet (already what renderMarkdown emits). */
export const ATS_UNSAFE_GLYPHS = /[★➤◆♦▶✦""'']|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/** Resume Worded's own stated bar: best-performing resumes quantify 75%+ of bullets. */
export const QUANTIFICATION_TARGET_RATIO = 0.75;

/** A leading verb shouldn't open more than this many bullets resume-wide (LinkedIn Career Advice consensus). */
export const VERB_REPEAT_CAP = 2;

/** Common typos, curated (no spellchecking dependency) — same shape/spirit as ACRONYM_EXPANSIONS above. */
export const COMMON_MISSPELLINGS: Record<string, string> = {
  "recieve": "receive",
  "seperate": "separate",
  "definately": "definitely",
  "occured": "occurred",
  "managment": "management",
  "enviroment": "environment",
  "acheive": "achieve",
  "acheived": "achieved",
  "buisness": "business",
  "collaberate": "collaborate",
  "sucessful": "successful",
  "publically": "publicly",
  "thier": "their",
  "recomend": "recommend",
  "developement": "development",
  "excelent": "excellent",
  "committment": "commitment",
  "occassion": "occasion",
};

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
    `Target grader weights: ${RESUME_QUALITY_RUBRIC.buckets.map((b) => `${b.name} ${b.weight}`).join(", ")}. It ignores ${RESUME_QUALITY_RUBRIC.ignored.join("/")}.`,
    "ATS formatting: " + ATS_FORMATTING_RULES.join(" "),
  ].join("\n");
}
