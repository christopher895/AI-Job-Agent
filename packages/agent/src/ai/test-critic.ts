import "dotenv/config";
import { MASTER_RESUME } from "./master-resume";
import { evaluate } from "./critic";
import { TailoredResume } from "./types";

/**
 * Live critic evaluation harness — the "is the critic good?" check.
 * Asserts the critic DISCRIMINATES (strong > weak) and GATES fabrication.
 * Skips gracefully when OPENAI_API_KEY is absent (the deterministic guts are
 * already proven offline in test-format.ts / test-grounding.ts).
 */

const JD = `Backend Software Engineer. Kubernetes on AWS, services in TypeScript and Python,
PostgreSQL, Docker. You'll own CI/CD and observability.`;

const strong: TailoredResume = {
  summary: "Backend-leaning engineer with Kubernetes/AWS and TypeScript experience.",
  experience: [
    {
      id: "exp-scout",
      bullets: [
        { sourceId: "exp-scout-3", text: "Automated infrastructure provisioning on AWS EKS with Argo CD and Crossplane, saving ~5 hrs/week with Datadog observability" },
        { sourceId: "exp-scout-2", text: "Architected an AI developer platform using MCP and LLM orchestration, cutting deployment time 75%" },
      ],
    },
  ],
  projects: [{ id: "proj-travel", bullets: [{ sourceId: "proj-travel-2", text: "Architected backend routing and trip APIs with Firebase persistence" }] }],
  skillsOrder: ["TypeScript", "Kubernetes", "Docker", "PostgreSQL", "Python"],
  keywordsCovered: ["Kubernetes", "AWS", "TypeScript", "Docker", "PostgreSQL"],
  cut: ["exp-waves"],
  reasoning: "",
};

const weak: TailoredResume = {
  summary: "",
  experience: [
    { id: "exp-scout", bullets: [{ sourceId: "exp-scout-1", text: "Worked on an AI security assistant with Copilot Studio and Jira" }] },
  ],
  projects: [],
  skillsOrder: ["Java"],
  keywordsCovered: [],
  cut: [],
  reasoning: "",
};

const fabricated: TailoredResume = {
  ...strong,
  experience: [
    { id: "exp-scout", bullets: [{ sourceId: "exp-scout-1", text: "Cut support costs by $5M annually with an AI assistant" }] }, // $5M fabricated
  ],
};

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.log("⏭  test-critic skipped — no OPENAI_API_KEY. (Deterministic signals proven in test-format.ts.)");
    return;
  }

  const [s, w, f] = await Promise.all([
    evaluate(MASTER_RESUME, strong, JD),
    evaluate(MASTER_RESUME, weak, JD),
    evaluate(MASTER_RESUME, fabricated, JD),
  ]);

  console.log(`STRONG     finalScore ${s.finalScore} gated ${s.gated}`);
  console.log(`WEAK       finalScore ${w.finalScore} gated ${w.gated}`);
  console.log(`FABRICATED finalScore ${f.finalScore} gated ${f.gated} (should be gated & ≤25)`);

  const pass = s.finalScore > w.finalScore && f.gated && f.finalScore <= 25;
  console.log(pass ? "\n✓ critic discriminates and gates fabrication — PASSED" : "\n✗ critic FAILED");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
