import { MASTER_RESUME } from "./master-resume";
import { checkGrounding } from "./grounding";
import { TailoredResume } from "./types";

/** A faithful tailoring: reworded but every number/id traces to the master. */
const honest: TailoredResume = {
  experience: [
    {
      id: "exp-scout",
      bullets: [
        { sourceId: "exp-scout-2", text: "Architected an AI developer platform with MCP and LLM orchestration, cutting deployment time 75%" },
        { sourceId: "exp-scout-1", text: "Launched an AI security assistant (Copilot Studio + Jira), cutting projected support costs $800K/yr" },
      ],
    },
  ],
  projects: [
    {
      id: "proj-travel",
      bullets: [
        { sourceId: "proj-travel-1", text: "Engineered an A* router with LRU caching for 200+ mile OpenStreetMap routes" },
      ],
    },
  ],
  skillsOrder: ["TypeScript", "AWS EKS", "Kubernetes", "Python"],
  keywordsCovered: ["MCP", "LLM", "AWS"],
  cut: ["exp-waves"],
  reasoning: "Led with platform/DevOps work for an infra-leaning JD.",
};

/** A cheating tailoring: fabricated metric, invented skill, bogus source id. */
const fabricated: TailoredResume = {
  experience: [
    {
      id: "exp-scout",
      bullets: [
        { sourceId: "exp-scout-1", text: "Cut projected support costs by $2M annually with an AI assistant" }, // $2M invented (source: $800K)
        { sourceId: "exp-scout-99", text: "Built a Rust microservice mesh" }, // sourceId doesn't exist
      ],
    },
    {
      id: "exp-nope", // section id doesn't exist
      bullets: [],
    },
  ],
  projects: [],
  skillsOrder: ["Rust", "Go"], // not in master skills
  keywordsCovered: [],
  cut: [],
  reasoning: "",
};

const a = checkGrounding(MASTER_RESUME, honest);
const b = checkGrounding(MASTER_RESUME, fabricated);

console.log("HONEST  → ok:", a.ok, "| provenance rows:", a.provenance.length, "| violations:", a.violations.length);
console.log("FABRICATED → ok:", b.ok, "| violations:", b.violations.length);
for (const v of b.violations) console.log("   ✗", v.kind, "—", v.detail);

const pass =
  a.ok &&
  a.violations.length === 0 &&
  !b.ok &&
  b.violations.some((v) => v.kind === "fabricated-number") &&
  b.violations.some((v) => v.kind === "unknown-source") &&
  b.violations.some((v) => v.kind === "unknown-section") &&
  b.violations.some((v) => v.kind === "unknown-skill");

console.log(pass ? "\n✓ grounding test PASSED" : "\n✗ grounding test FAILED");
process.exit(pass ? 0 : 1);
