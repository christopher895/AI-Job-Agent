import "dotenv/config";
import { MASTER_RESUME } from "../master-resume";
import { masterToText } from "./resume-text";
import { runSpecialist } from "./specialists";
import { assembleReport } from "./assemble";
import { CATEGORIES, SPECIALISTS, SpecialistName, SpecialistResult } from "./rubric";

// Live LLM call — run manually via `npm run test:integration`, not in the fast gate.
async function main() {
  const resumeText = masterToText(MASTER_RESUME);
  const input = { resumeText, targetRole: "ml" as const, level: "intern" as const, jdText: null };
  const entries = await Promise.all(SPECIALISTS.map(async (s) => [s, await runSpecialist(s, input)] as const));
  const report = assembleReport(Object.fromEntries(entries) as Record<SpecialistName, SpecialistResult>, resumeText);

  const ok =
    report.categories.length === CATEGORIES.length &&
    report.score >= 0 && report.score <= 100 &&
    report.score === report.categories.reduce((s, c) => s + c.score, 0) &&
    report.findings.every((f) => f.title && f.problem && ["high", "medium", "low"].includes(f.severity));

  console.log(`score ${report.score}/100 —`, report.categories.map((c) => `${c.key} ${c.score}/${c.max}`).join(", "));
  console.log(`${report.findings.length} findings`);
  console.log(ok ? "\n✓ grade-live test PASSED" : "\n✗ grade-live test FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
