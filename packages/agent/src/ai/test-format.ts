import { MASTER_RESUME } from "./master-resume";
import { renderMarkdown, lintFormat, keywordCoverage } from "./format";
import { gatherSignals } from "./critic";
import { TailoredResume } from "./types";

const JD = `Backend Software Engineer. We run Kubernetes on AWS, services in TypeScript and
Python, PostgreSQL for storage, Docker for everything. You'll own CI/CD and observability.`;

/** Strong: action verbs, surfaces JD-relevant skills, faithful numbers. */
const strong: TailoredResume = {
  summary: "Backend-leaning AI engineer with Kubernetes/AWS and TypeScript experience.",
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
  summary: "",
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
  sigWeak.grounding.ok;

console.log(pass ? "\n✓ format + signal-discrimination test PASSED" : "\n✗ test FAILED");
process.exit(pass ? 0 : 1);
