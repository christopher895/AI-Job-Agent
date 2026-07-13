import { MASTER_RESUME } from "./master-resume";
import { renderMarkdown, lintFormat, keywordCoverage } from "./format";
import { gatherSignals } from "./critic";
import { TailoredResume } from "./types";

const JD = `Backend Software Engineer. We run Kubernetes on AWS, services in TypeScript and
Python, PostgreSQL for storage, Docker for everything. You'll own CI/CD and observability.`;

/** Strong: action verbs, surfaces JD-relevant skills, faithful numbers. */
const strong: TailoredResume = {
  experience: [
    {
      id: "exp-scout",
      bullets: [
        { sourceId: "exp-scout-3", text: "Automated infrastructure provisioning on AWS EKS with Argo CD and Crossplane, saving ~5 hrs/week with Datadog observability" },
        { sourceId: "exp-scout-2", text: "Architected an AI developer platform using MCP and LLM orchestration, cutting deployment time 75%" },
      ],
    },
  ],
  projects: [
    { id: "proj-travel", bullets: [{ sourceId: "proj-travel-2", text: "Architected backend routing and trip APIs with Firebase persistence for multi-day itineraries" }] },
  ],
  skillsOrder: ["TypeScript", "AWS EKS", "Kubernetes", "Docker", "PostgreSQL", "Python"],
  keywordsCovered: ["Kubernetes", "AWS", "TypeScript", "Docker", "PostgreSQL"],
  cut: ["exp-waves"],
  reasoning: "Led with infra/DevOps for a backend JD.",
};

/** Weak: duty-language openers, surfaces almost no JD-relevant skills. */
const weak: TailoredResume = {
  experience: [
    {
      id: "exp-scout",
      bullets: [
        { sourceId: "exp-scout-1", text: "Worked on an AI security assistant with Copilot Studio and Jira" },
        { sourceId: "exp-scout-2", text: "Responsible for an AI developer platform using MCP" },
      ],
    },
  ],
  projects: [],
  skillsOrder: ["Java"],
  keywordsCovered: [],
  cut: [],
  reasoning: "",
};

// --- New deterministic checks (Resume-Worded-style rubric) ---

const quantificationHeavy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Automated infrastructure provisioning on AWS EKS, saving 5 hrs per week" },
    { sourceId: "exp-scout-2", text: "Architected an AI developer platform, cutting deployment time 75%" },
  ] }],
};
const quantificationLight: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Automated infrastructure provisioning on AWS EKS" },
    { sourceId: "exp-scout-2", text: "Architected an AI developer platform for internal use" },
  ] }],
};

const verbRepetitionMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Built an internal dashboard for infrastructure metrics" },
    { sourceId: "exp-scout-2", text: "Built a CI/CD pipeline for the platform team" },
    { sourceId: "exp-scout-3", text: "Built a Slack bot for on-call alerting" },
  ] }],
};

const tenseMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Built an internal dashboard for infrastructure metrics" },
    { sourceId: "exp-scout-2", text: "Automated the CI/CD pipeline for faster releases" },
    { sourceId: "exp-scout-3", text: "Leading the migration to a new cloud provider" },
  ] }],
};

const buzzwordMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Recognized as a team player with a proven track record of results" },
  ] }],
};

const fillerMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Successfully and efficiently managed a very large number of tickets" },
  ] }],
};

const pronounMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "I led the migration of my team's services to Kubernetes" },
  ] }],
};

const passiveMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "The infrastructure migration was completed by the platform team" },
  ] }],
};

const spellingMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "Helped the team recieve feedback and seperate concerns cleanly" },
  ] }],
};

const glyphMessy: TailoredResume = {
  ...weak,
  experience: [{ id: "exp-scout", bullets: [
    { sourceId: "exp-scout-1", text: "★ Migrated services to Kubernetes for faster releases" },
  ] }],
};

const lintQuantHeavy = lintFormat(MASTER_RESUME, quantificationHeavy);
const lintQuantLight = lintFormat(MASTER_RESUME, quantificationLight);
const lintVerbRep = lintFormat(MASTER_RESUME, verbRepetitionMessy);
const lintTense = lintFormat(MASTER_RESUME, tenseMessy);
const lintBuzzword = lintFormat(MASTER_RESUME, buzzwordMessy);
const lintFiller = lintFormat(MASTER_RESUME, fillerMessy);
const lintPronoun = lintFormat(MASTER_RESUME, pronounMessy);
const lintPassive = lintFormat(MASTER_RESUME, passiveMessy);
const lintSpelling = lintFormat(MASTER_RESUME, spellingMessy);
const lintGlyph = lintFormat(MASTER_RESUME, glyphMessy);

const newChecksPass =
  lintQuantHeavy.score > lintQuantLight.score &&
  lintQuantLight.issues.some((i) => i.rule === "quantification-low") &&
  lintVerbRep.issues.some((i) => i.rule === "verb-repetition") &&
  lintTense.issues.some((i) => i.rule === "wrong-tense") &&
  lintBuzzword.issues.some((i) => i.rule === "buzzword") &&
  lintFiller.issues.some((i) => i.rule === "filler-word") &&
  lintPronoun.issues.some((i) => i.rule === "personal-pronoun") &&
  lintPassive.issues.some((i) => i.rule === "passive-voice") &&
  lintSpelling.issues.some((i) => i.rule === "spelling") &&
  lintGlyph.issues.some((i) => i.rule === "ats-glyph");

console.log(
  `NEW CHECKS quant(${lintQuantHeavy.score}v${lintQuantLight.score}) verbRep:${lintVerbRep.issues.some((i) => i.rule === "verb-repetition")} tense:${lintTense.issues.some((i) => i.rule === "wrong-tense")} buzzword:${lintBuzzword.issues.some((i) => i.rule === "buzzword")} filler:${lintFiller.issues.some((i) => i.rule === "filler-word")} pronoun:${lintPronoun.issues.some((i) => i.rule === "personal-pronoun")} passive:${lintPassive.issues.some((i) => i.rule === "passive-voice")} spelling:${lintSpelling.issues.some((i) => i.rule === "spelling")} glyph:${lintGlyph.issues.some((i) => i.rule === "ats-glyph")}`
);

// --- Format safety of the rendered document ---
const md = renderMarkdown(MASTER_RESUME, strong);
const hasStandardHeadings = ["## Experience", "## Skills", "## Education"].every((h) => md.includes(h));
const noTableRows = !md.split("\n").some((l) => l.trim().startsWith("|")); // single-column, no tables
const singleColumn = !/\t{2,}/.test(md);

// --- Lint discrimination ---
const lintStrong = lintFormat(MASTER_RESUME, strong);
const lintWeak = lintFormat(MASTER_RESUME, weak);
const weakHasWeakOpenerError = lintWeak.issues.some((i) => i.rule === "weak-opener" && i.level === "error");

// --- Keyword coverage discrimination ---
const covStrong = keywordCoverage(MASTER_RESUME, strong, JD);
const covWeak = keywordCoverage(MASTER_RESUME, weak, JD);

// --- Combined deterministic signal discrimination (the "good critic" proof) ---
const sigStrong = gatherSignals(MASTER_RESUME, strong, JD);
const sigWeak = gatherSignals(MASTER_RESUME, weak, JD);

console.log("FORMAT  standard headings:", hasStandardHeadings, "| no table rows:", noTableRows, "| single column:", singleColumn);
console.log(`LINT    strong score ${lintStrong.score} vs weak ${lintWeak.score} | weak flags weak-opener: ${weakHasWeakOpenerError}`);
console.log(`COVERAGE strong ${(covStrong.ratio * 100).toFixed(0)}% (missing: ${covStrong.missing.join(",") || "none"}) vs weak ${(covWeak.ratio * 100).toFixed(0)}%`);
console.log(`SIGNALS  strong grounded:${sigStrong.grounding.ok} fmt:${sigStrong.format.score} | weak grounded:${sigWeak.grounding.ok} fmt:${sigWeak.format.score}`);

const pass =
  hasStandardHeadings &&
  noTableRows &&
  singleColumn &&
  lintStrong.score > lintWeak.score &&
  weakHasWeakOpenerError &&
  covStrong.ratio > covWeak.ratio &&
  sigStrong.grounding.ok &&
  sigWeak.grounding.ok &&
  newChecksPass;

console.log(pass ? "\n✓ format + signal-discrimination test PASSED" : "\n✗ test FAILED");
process.exit(pass ? 0 : 1);
