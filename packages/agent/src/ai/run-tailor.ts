import "dotenv/config";
import "../polyfills";
import { generateBestResume } from "./chain";

/**
 * Live end-to-end demo of the generate → critique → revise loop.
 * Usage: npm run tailor -w @job-agent/agent            (uses the sample JD below)
 *        npm run tailor -w @job-agent/agent -- "<paste a JD>"
 */

const SAMPLE_JD = `Software Engineer, Backend Infrastructure — Summer Intern

We're looking for a backend/infrastructure-leaning engineer to help scale our platform.
You'll work with Kubernetes on AWS, write services in TypeScript and Python, manage
PostgreSQL, and own parts of our CI/CD and observability stack. Experience with Docker,
infrastructure-as-code, and LLM-powered developer tooling is a strong plus.`;

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set in .env — cannot run the live loop.");
    process.exit(1);
  }

  const jd = process.argv[2]?.trim() || SAMPLE_JD;
  console.log("Running generate → critique → revise loop…\n");

  const result = await generateBestResume(jd, { jobTitle: "Backend Infrastructure Intern", targetScore: 80 });

  console.log("ITERATION HISTORY:");
  for (const h of result.history) console.log(`  pass ${h.iteration}: score ${h.finalScore}${h.gated ? " (GATED)" : ""}`);

  const c = result.critic;
  console.log(`\nFINAL SCORE: ${c.finalScore}  |  grounded: ${c.signals.grounding.ok}  |  format: ${c.signals.format.score}/100  |  JD coverage: ${(c.signals.coverage.ratio * 100).toFixed(0)}%`);
  console.log("\nBUCKET SCORES:");
  for (const b of c.critique.buckets) console.log(`  ${b.name}: ${b.score}/${b.max} — ${b.reasons[0] ?? ""}`);
  if (c.fixes.length) {
    console.log("\nREMAINING FIXES:");
    for (const f of c.fixes.slice(0, 6)) console.log(`  - ${f}`);
  }

  console.log("\n========== TAILORED RÉSUMÉ (ATS-safe) ==========\n");
  console.log(result.markdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
