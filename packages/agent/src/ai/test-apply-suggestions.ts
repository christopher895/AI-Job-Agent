import { MASTER_RESUME } from "./master-resume";
import { labelGroundedness, applySuggestions } from "./apply-suggestions";
import { RawSuggestion, Suggestion } from "./types";

// exp-scout-1's real text: "Launched an AI security assistant with Copilot Studio
// and Jira, reducing projected support costs by $800K annually" (tech: Copilot
// Studio, Jira; metrics: "$800K projected annual support cost reduction").

const groundedRewrite: RawSuggestion = {
  id: "sugg-1",
  kind: "bullet-rewrite",
  targetId: "exp-scout-1",
  keyword: "Jira",
  originalText: "Launched an AI security assistant with Copilot Studio and Jira, reducing projected support costs by $800K annually",
  suggestedText: "Launched an AI security assistant with Copilot Studio and Jira workflows, reducing projected support costs by $800K annually",
  rationale: "JD mentions Jira; the source bullet already names it.",
};

const fabricatedNumberRewrite: RawSuggestion = {
  id: "sugg-2",
  kind: "bullet-rewrite",
  targetId: "exp-scout-1",
  keyword: "Jira",
  originalText: "Launched an AI security assistant with Copilot Studio and Jira, reducing projected support costs by $800K annually",
  suggestedText: "Launched an AI security assistant with Copilot Studio and Jira, reducing projected support costs by $2M annually",
  rationale: "Inflates the real $800K figure — must be flagged even though Jira is grounded.",
};

const unrelatedSkillAddition: RawSuggestion = {
  id: "sugg-3",
  kind: "skill-addition",
  targetId: "tools",
  keyword: "Terraform",
  suggestedText: "Terraform",
  rationale: "JD wants IaC experience, but Terraform is never mentioned anywhere in the master resume.",
};

const groundedSkillAddition: RawSuggestion = {
  id: "sugg-4",
  kind: "skill-addition",
  targetId: "tools",
  keyword: "Kubernetes",
  suggestedText: "Kubernetes",
  rationale: "Already named in exp-scout-3's bullet text, just not in the skills list under this exact spelling check.",
};

const gRewrite = labelGroundedness(MASTER_RESUME, groundedRewrite);
const gFabricated = labelGroundedness(MASTER_RESUME, fabricatedNumberRewrite);
const gUnrelated = labelGroundedness(MASTER_RESUME, unrelatedSkillAddition);
const gGrounded = labelGroundedness(MASTER_RESUME, groundedSkillAddition);

console.log("grounded rewrite      →", gRewrite, "(expect grounded)");
console.log("fabricated number     →", gFabricated, "(expect extrapolated)");
console.log("unrelated skill       →", gUnrelated, "(expect extrapolated)");
console.log("grounded skill        →", gGrounded, "(expect grounded — Kubernetes is already in master.skills.tools)");

const accepted: Suggestion[] = [
  { ...groundedRewrite, groundedness: "grounded", accepted: true },
  { ...unrelatedSkillAddition, groundedness: "extrapolated", accepted: true }, // accepted anyway — Christopher's call, not ours to block
];

const { master: adjustedMaster, tailored } = applySuggestions(MASTER_RESUME, accepted);

const scoutSection = tailored.experience.find((e) => e.id === "exp-scout")!;
const bullet1 = scoutSection.bullets.find((b) => b.sourceId === "exp-scout-1")!;
const bullet2 = scoutSection.bullets.find((b) => b.sourceId === "exp-scout-2")!;

const rewriteApplied = bullet1.text === groundedRewrite.suggestedText;
const untouchedBulletUnchanged = bullet2.text === MASTER_RESUME.experience[0].bullets[1].text;
const skillAdded = adjustedMaster.skills.tools.some((t) => t.toLowerCase() === "terraform");
const originalMasterUntouched = !MASTER_RESUME.skills.tools.some((t) => t.toLowerCase() === "terraform");
const noReorderingOrCutting =
  tailored.experience.length === MASTER_RESUME.experience.length &&
  tailored.projects.length === MASTER_RESUME.projects.length &&
  tailored.cut.length === 0;

console.log("rewrite applied:", rewriteApplied);
console.log("untouched bullet unchanged:", untouchedBulletUnchanged);
console.log("skill added to adjusted master:", skillAdded);
console.log("original MASTER_RESUME left untouched (deep clone):", originalMasterUntouched);
console.log("no reordering/cutting:", noReorderingOrCutting);

const pass =
  gRewrite === "grounded" &&
  gFabricated === "extrapolated" &&
  gUnrelated === "extrapolated" &&
  gGrounded === "grounded" &&
  rewriteApplied &&
  untouchedBulletUnchanged &&
  skillAdded &&
  originalMasterUntouched &&
  noReorderingOrCutting;

console.log(pass ? "\n✓ apply-suggestions test PASSED" : "\n✗ apply-suggestions test FAILED");
process.exit(pass ? 0 : 1);
