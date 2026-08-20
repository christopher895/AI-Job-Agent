import { MASTER_RESUME } from "./master-resume";
import {
  labelGroundedness,
  applySuggestions,
  placeSkill,
  coalesceParentheticalGroups,
} from "./apply-suggestions";
import { MasterResume, RawSuggestion, Suggestion } from "./types";

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

function withAwsGroup(): MasterResume {
  const clone: MasterResume = JSON.parse(JSON.stringify(MASTER_RESUME));
  clone.skills.tools = ["AWS (EKS, Lambda, Bedrock)", "Docker", "Kubernetes", "PostgreSQL", "Git"];
  return clone;
}

const groupedMaster = withAwsGroup();

const nestViaRewrite: Suggestion = {
  id: "sugg-5",
  kind: "skill-addition",
  targetId: "tools",
  keyword: "CloudWatch",
  originalText: "AWS (EKS, Lambda, Bedrock)",
  suggestedText: "AWS (EKS, Lambda, Bedrock, CloudWatch)",
  rationale: "CloudWatch belongs with the existing AWS group.",
  groundedness: "extrapolated",
  accepted: true,
};

const { master: nestedViaRewrite } = applySuggestions(groupedMaster, [nestViaRewrite]);
const rewriteNested =
  nestedViaRewrite.skills.tools[0] === "AWS (EKS, Lambda, Bedrock, CloudWatch)" &&
  !nestedViaRewrite.skills.tools.includes("CloudWatch");
console.log("CloudWatch nested via group rewrite:", rewriteNested);

const { master: nestedViaBackstop } = applySuggestions(groupedMaster, [
  {
    id: "sugg-6",
    kind: "skill-addition",
    targetId: "tools",
    keyword: "CloudWatch",
    suggestedText: "CloudWatch",
    rationale: "Model forgot originalText — apply path should still nest into AWS.",
    groundedness: "extrapolated",
    accepted: true,
  },
]);
const backstopNested =
  nestedViaBackstop.skills.tools[0] === "AWS (EKS, Lambda, Bedrock, CloudWatch)" &&
  !nestedViaBackstop.skills.tools.includes("CloudWatch");
console.log("CloudWatch nested via family backstop:", backstopNested);

const { master: twoFolds } = applySuggestions(groupedMaster, [
  nestViaRewrite,
  {
    id: "sugg-7",
    kind: "skill-addition",
    targetId: "tools",
    keyword: "S3",
    originalText: "AWS (EKS, Lambda, Bedrock)",
    suggestedText: "AWS (EKS, Lambda, Bedrock, S3)",
    rationale: "Second fold into the same group must union, not replace.",
    groundedness: "extrapolated",
    accepted: true,
  },
]);
const unioned =
  twoFolds.skills.tools[0] === "AWS (EKS, Lambda, Bedrock, CloudWatch, S3)" && twoFolds.skills.tools.length === 5;
console.log("two AWS folds union (no dropped items):", unioned);

const insertAfter = ["Docker", "Kubernetes", "PostgreSQL"];
placeSkill(insertAfter, "Kafka", "Kubernetes");
const insertedAfterNeighbor = insertAfter.join("|") === "Docker|Kubernetes|Kafka|PostgreSQL";
console.log("standalone skill inserted after neighbor:", insertedAfterNeighbor);

const noDup = ["AWS (EKS, Lambda, Bedrock, CloudWatch)", "Docker"];
placeSkill(noDup, "CloudWatch");
const skippedDuplicate = noDup.length === 2 && noDup[0] === "AWS (EKS, Lambda, Bedrock, CloudWatch)";
console.log("already-in-group skill not duplicated:", skippedDuplicate);

const orphanMaster = withAwsGroup();
orphanMaster.skills.tools.push("CloudWatch");
const { master: foldedOrphan } = applySuggestions(orphanMaster, []);
const orphanFolded =
  foldedOrphan.skills.tools[0] === "AWS (EKS, Lambda, Bedrock, CloudWatch)" &&
  !foldedOrphan.skills.tools.includes("CloudWatch");
console.log("trailing CloudWatch folded into AWS on apply:", orphanFolded);

const splitFragments = ["AWS (EKS", "Lambda", "Bedrock)", "Docker", "Kubernetes", "Terraform", "PostgreSQL", "Git", "Argo CD", "Kargo", "n8n"];
const coalesced = coalesceParentheticalGroups(splitFragments);
const fragmentsRejoined =
  coalesced[0] === "AWS (EKS, Lambda, Bedrock)" && coalesced[1] === "Docker" && coalesced.length === 9;
console.log("comma-split AWS fragments rejoined:", fragmentsRejoined);

const splitMaster = withAwsGroup();
splitMaster.skills.tools = [...splitFragments];
const { master: mergedSplit } = applySuggestions(splitMaster, [
  {
    id: "sugg-8",
    kind: "skill-addition",
    targetId: "tools",
    keyword: "SageMaker",
    suggestedText: "AWS (EKS, Lambda, Bedrock, SageMaker, Redshift, Athena)",
    rationale: "JD wants SageMaker/Redshift/Athena — must merge into the existing AWS group, not append a second one.",
    groundedness: "extrapolated",
    accepted: true,
  },
]);
const awsGroups = mergedSplit.skills.tools.filter((t) => t.toLowerCase().startsWith("aws"));
const noDuplicateAwsGroup =
  awsGroups.length === 1 &&
  awsGroups[0] === "AWS (EKS, Lambda, Bedrock, SageMaker, Redshift, Athena)" &&
  mergedSplit.skills.tools.includes("Docker") &&
  mergedSplit.skills.tools.includes("n8n");
console.log("split master + full AWS rewrite merges to one group:", noDuplicateAwsGroup);

const alreadyDuplicated = withAwsGroup();
alreadyDuplicated.skills.tools = [
  "AWS (EKS, Lambda, Bedrock)",
  "Docker",
  "Kubernetes",
  "n8n",
  "AWS (EKS, Lambda, Bedrock, SageMaker, Redshift, Athena)",
];
const { master: collapsed } = applySuggestions(alreadyDuplicated, []);
const collapsedDupes =
  collapsed.skills.tools.filter((t) => t.toLowerCase().startsWith("aws")).length === 1 &&
  collapsed.skills.tools[0] === "AWS (EKS, Lambda, Bedrock, SageMaker, Redshift, Athena)";
console.log("two AWS groups collapse on apply:", collapsedDupes);

const pass =
  gRewrite === "grounded" &&
  gFabricated === "extrapolated" &&
  gUnrelated === "extrapolated" &&
  gGrounded === "grounded" &&
  rewriteApplied &&
  untouchedBulletUnchanged &&
  skillAdded &&
  originalMasterUntouched &&
  noReorderingOrCutting &&
  rewriteNested &&
  backstopNested &&
  unioned &&
  insertedAfterNeighbor &&
  skippedDuplicate &&
  orphanFolded &&
  fragmentsRejoined &&
  noDuplicateAwsGroup &&
  collapsedDupes;

console.log(pass ? "\n✓ apply-suggestions test PASSED" : "\n✗ apply-suggestions test FAILED");
process.exit(pass ? 0 : 1);
