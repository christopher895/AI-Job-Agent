import { CATEGORIES, SPECIALISTS, categoryFor, specialistResultSchema, isTargetRole, isLevel } from "./rubric";
import { buildUserMessage, systemPrompt } from "./specialists";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

// Rubric shape
check("category maxima sum to 100", CATEGORIES.reduce((s, c) => s + c.max, 0) === 100);
check("every specialist owns exactly one category",
  SPECIALISTS.every((s) => CATEGORIES.filter((c) => c.specialist === s).length === 1));
check("content quality is worth 35", categoryFor("content").max === 35);

// Schema bounds
const finding = { title: "t", severity: "high", quote: null, problem: "p", rewrite: null };
const atsSchema = specialistResultSchema(categoryFor("ats").max);
check("schema accepts a score at the max", atsSchema.safeParse({ score: 25, summary: "ok", findings: [finding] }).success);
check("schema rejects a score above the max", !atsSchema.safeParse({ score: 26, summary: "ok", findings: [] }).success);
check("schema rejects a negative score", !atsSchema.safeParse({ score: -1, summary: "ok", findings: [] }).success);
check("schema rejects a fractional score", !atsSchema.safeParse({ score: 12.5, summary: "ok", findings: [] }).success);
// An over-eager reviewer shouldn't fail the whole grade over a 7th finding.
const seven = atsSchema.safeParse({ score: 10, summary: "ok", findings: Array.from({ length: 7 }, (_, i) => ({ ...finding, title: `t${i}` })) });
check("schema keeps the first 6 of 7 findings",
  seven.success && seven.data.findings.length === 6 && seven.data.findings[5].title === "t5");
check("schema rejects an unknown severity",
  !atsSchema.safeParse({ score: 10, summary: "ok", findings: [{ ...finding, severity: "critical" }] }).success);

// Validators
check("isTargetRole accepts ml", isTargetRole("ml"));
check("isTargetRole rejects toString (prototype key)", !isTargetRole("toString"));
check("isLevel accepts intern", isLevel("intern"));
check("isLevel rejects junior", !isLevel("junior"));

// User message
const base = { resumeText: "Jane Doe\n- Built a thing", targetRole: "ml" as const, level: "intern" as const, jdText: null };
const noJd = buildUserMessage(base);
check("user message names the role", noJd.includes("ML / AI Engineer"));
check("user message names the level", noJd.includes("Intern"));
check("user message includes the resume", noJd.includes("- Built a thing"));
check("no JD block when JD is absent", !noJd.includes("<job_description>"));
check("whitespace-only JD counts as absent", !buildUserMessage({ ...base, jdText: "   \n" }).includes("<job_description>"));
const withJd = buildUserMessage({ ...base, jdText: "We need PyTorch." });
check("JD block present when JD is given", withJd.includes("<job_description>") && withJd.includes("We need PyTorch."));

// System prompts
for (const s of SPECIALISTS) {
  const p = systemPrompt(s);
  check(`${s} prompt states its own max`, p.includes(`0 to ${categoryFor(s).max}`));
  check(`${s} prompt forbids invented numbers`, p.includes("[X%]"));
}

console.log(pass ? "\n✓ grade-prompts test PASSED" : "\n✗ grade-prompts test FAILED");
process.exit(pass ? 0 : 1);
