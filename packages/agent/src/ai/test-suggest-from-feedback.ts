import { buildFeedbackUserMessage, currentMaster, currentResumeSlice } from "./suggest-from-feedback";
import { labelGroundedness } from "./apply-suggestions";
import { MasterResume, Suggestion } from "./types";

let allPass = true;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) {
    allPass = false;
    console.log(`   ✗ [${label}] ${detail ?? "failed"}`);
  }
}

const master = {
  basics: { name: "T", email: "", phone: "", location: "", github: "", linkedin: "", portfolio: "" },
  education: [],
  experience: [
    { id: "exp-1", company: "Acme", title: "Dev", location: "", start: "", end: "", bullets: [{ id: "b1", text: "Built a thing", tech: [], metrics: [] }] },
  ],
  projects: [],
  skills: { languages: ["TypeScript"], frameworks: [], tools: ["PostgreSQL"], interests: ["Chess"] },
  extracurriculars: [],
} as unknown as MasterResume;

function sugg(p: Partial<Suggestion>): Suggestion {
  return { id: "x", kind: "skill-addition", targetId: "tools", keyword: "", suggestedText: "", rationale: "", groundedness: "grounded", accepted: true, ...p };
}

// --- currentResumeSlice: reflects earlier accepted suggestions, never interests ---
{
  const slice = currentResumeSlice(master, [
    sugg({ id: "a", kind: "bullet-rewrite", targetId: "b1", suggestedText: "Built a thing with SQL" }),
    sugg({ id: "b", kind: "skill-addition", targetId: "tools", suggestedText: "Git" }),
  ]);
  check("slice-applies-rewrite", slice.experience[0].bullets[0].text === "Built a thing with SQL", JSON.stringify(slice.experience));
  check("slice-keeps-bullet-id", slice.experience[0].bullets[0].id === "b1");
  check("slice-applies-skill", slice.skills.tools.includes("Git") && slice.skills.tools.includes("PostgreSQL"));
  check("slice-omits-interests", !("interests" in slice.skills));
  check("slice-does-not-mutate-master", master.experience[0].bullets[0].text === "Built a thing" && !master.skills.tools.includes("Git"));
}
{
  const slice = currentResumeSlice(master, []);
  check("slice-empty-prior", slice.experience[0].bullets[0].text === "Built a thing");
}

// --- currentMaster feeds labelGroundedness: a term added in round one is grounded in round two ---
{
  const cur = currentMaster(master, [sugg({ id: "b", kind: "skill-addition", targetId: "tools", suggestedText: "Git" })]);
  const roundTwo = sugg({ id: "c", kind: "skill-addition", targetId: "tools", keyword: "Git", suggestedText: "GitHub", accepted: null });
  check("grounded-against-current", labelGroundedness(cur, roundTwo) === "grounded");
  check("extrapolated-against-raw", labelGroundedness(master, roundTwo) === "extrapolated");
  check("currentMaster-keeps-interests", cur.skills.interests.includes("Chess"));
}

// --- buildFeedbackUserMessage: feedback first, JD optional, résumé last ---
{
  const msg = buildFeedbackUserMessage("  Add SQL next to PostgreSQL  ", "We need SQL", currentResumeSlice(master, []));
  const fb = msg.indexOf("=== REVIEWER FEEDBACK ===");
  const jd = msg.indexOf("=== JOB DESCRIPTION");
  const rs = msg.indexOf("=== RÉSUMÉ");
  check("msg-has-all-sections", fb >= 0 && jd > fb && rs > jd, msg.slice(0, 200));
  check("msg-trims-feedback", msg.includes("\nAdd SQL next to PostgreSQL\n"));
  check("msg-includes-resume-json", msg.includes('"b1"'));
}
{
  const msg = buildFeedbackUserMessage("fix it", null, currentResumeSlice(master, []));
  check("msg-omits-empty-jd", !msg.includes("=== JOB DESCRIPTION"), msg);
  check("msg-omits-blank-jd", !buildFeedbackUserMessage("fix it", "   ", currentResumeSlice(master, [])).includes("=== JOB DESCRIPTION"));
}

console.log(allPass ? "\n✓ suggest-from-feedback test PASSED" : "\n✗ suggest-from-feedback test FAILED");
process.exit(allPass ? 0 : 1);
