import { MASTER_RESUME } from "./master-resume";
import { suggestKeywords } from "./suggest-keywords";

const JD = `
Senior Platform Engineer — Infrastructure Team

We're looking for an engineer with hands-on experience running production
workloads on Kubernetes, managing infrastructure as code with Terraform, and
building CI/CD pipelines with GitHub Actions. Experience with GitOps tools
like Argo CD is a strong plus. You'll work closely with our observability
team, so familiarity with Datadog or similar tools is valuable.
`.trim();

async function main() {
  const suggestions = await suggestKeywords(JD, MASTER_RESUME);

  console.log(`Got ${suggestions.length} suggestions:`);
  for (const s of suggestions) {
    console.log(`  [${s.kind}] target=${s.targetId} keyword="${s.keyword}"`);
    console.log(`    → "${s.suggestedText}"`);
  }

  const reasonableCount = suggestions.length >= 1 && suggestions.length <= 10;
  const allHaveRequiredFields = suggestions.every(
    (s) => s.id && s.kind && s.targetId && s.keyword && s.suggestedText && s.rationale
  );
  const skillAdditionsUseValidCategory = suggestions
    .filter((s) => s.kind === "skill-addition")
    .every((s) => ["languages", "frameworks", "tools"].includes(s.targetId));
  const bulletRewritesTargetRealBullets = suggestions
    .filter((s) => s.kind === "bullet-rewrite")
    .every((s) =>
      [...MASTER_RESUME.experience, ...MASTER_RESUME.projects].some((section) =>
        section.bullets.some((b) => b.id === s.targetId)
      )
    );

  console.log("Reasonable count (1-10):", reasonableCount);
  console.log("All have required fields:", allHaveRequiredFields);
  console.log("Skill-additions use a valid category:", skillAdditionsUseValidCategory);
  console.log("Bullet-rewrites target real bullet ids:", bulletRewritesTargetRealBullets);

  const pass =
    reasonableCount && allHaveRequiredFields && skillAdditionsUseValidCategory && bulletRewritesTargetRealBullets;
  console.log(pass ? "\n✓ suggest-keywords test PASSED" : "\n✗ suggest-keywords test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
