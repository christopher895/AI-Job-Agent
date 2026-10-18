import { assembleReport, labelRewrite } from "./assemble";
import { SpecialistName, SpecialistResult } from "./rubric";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

const resume = "Built a cache that cut latency 40% for 2,000 users\nGPA 3.8";
const f = (title: string, severity: "high" | "medium" | "low", rewrite: string | null = null) =>
  ({ title, severity, quote: null, problem: "p", rewrite });

const results: Record<SpecialistName, SpecialistResult> = {
  ats: { score: 30, summary: "ats ok", findings: [f("ats-low", "low")] },          // above max 25 → clamp
  content: { score: 28, summary: "content ok", findings: [f("content-med", "medium"), f("content-high", "high")] },
  recruiter: { score: -3, summary: "writing", findings: [] },                       // below 0 → clamp
  domain: { score: 15, summary: "domain", findings: [f("domain-high", "high")] },
  storyteller: { score: 7.6, summary: "story", findings: [f("story-med", "medium")] }, // rounds to 8
};
const report = assembleReport(results, resume);

check("categories are in rubric order",
  report.categories.map((c) => c.key).join(",") === "ats,content,writing,job,readiness");
check("score above max clamps to max", report.categories[0].score === 25);
check("negative score clamps to 0", report.categories[2].score === 0);
check("fractional score rounds", report.categories[4].score === 8);
check("total is the sum of clamped categories", report.score === 25 + 28 + 0 + 15 + 8);
check("category carries its specialist summary", report.categories[1].summary === "content ok");
check("findings sorted by severity, then category order, then original order",
  report.findings.map((x) => x.title).join(",") === "content-high,domain-high,content-med,story-med,ats-low");
check("ids are category-scoped and stable", report.findings[0].id === "content-2" && report.findings[4].id === "ats-1");
check("findings carry their category key", report.findings[1].category === "job");
check("assembling twice gives identical output",
  JSON.stringify(assembleReport(results, resume)) === JSON.stringify(report));

// Groundedness
check("no rewrite → grounded", labelRewrite(null, resume) === "grounded");
check("rewrite reusing resume numbers → grounded",
  labelRewrite("Designed a cache cutting latency 40% for 2,000 users", resume) === "grounded");
check("rewrite with a new number → needs-your-input", labelRewrite("Cut latency 55%", resume) === "needs-your-input");
check("rewrite with a placeholder → needs-your-input",
  labelRewrite("Cut latency [X%] across [N] services", resume) === "needs-your-input");
check("number formatting differences still match", labelRewrite("for 2000 users", resume) === "grounded");

console.log(pass ? "\n✓ grade-assemble test PASSED" : "\n✗ grade-assemble test FAILED");
process.exit(pass ? 0 : 1);
