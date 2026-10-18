import {
  normalize, hasPlaceholder, matchBullet, classifyFindings, splice, applyFixes, sectionOfBullet,
  findInText, fixedResumeText, writeHandoff, readHandoff, HANDOFF_KEY, HANDOFF_TTL_MS, Handoff,
  fixStatus, sameBulletConflicts,
} from "./gradeFixes";
import type { GradeFinding, MasterResume } from "./api";

let pass = true;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) { pass = false; console.log(`   ✗ [${label}] ${detail ?? "failed"}`); }
}

const bullet = (id: string, text: string) => ({ id, text, tech: ["TS"], metrics: ["40%"], tags: ["backend"] });
const master: MasterResume = {
  basics: { name: "N", location: "", email: "", phone: "", github: "", linkedin: "", portfolio: "", summary: "" },
  education: [],
  experience: [
    { id: "exp-a", company: "Scout Motors", title: "AI Engineer", location: "", start: "", end: "", bullets: [
      bullet("a1", "Architected an AI developer platform with MCP and LLM orchestration to streamline deployments."),
      bullet("a2", "Built a caching layer that cut p95 latency 40% for 2,000 users"),
    ] },
    { id: "exp-b", company: "Mandy", title: "SWE", location: "", start: "", end: "", bullets: [
      bullet("b1", "Shipped features"),
    ] },
  ],
  projects: [
    { id: "p", name: "Travel Planner", tech: [], start: "", end: "", link: "", repo: "", bullets: [
      bullet("p1", "Shipped features"),
      bullet("p2", "Engineered an A* router with LRU caching for 200+ mile routes"),
    ] },
  ],
  extracurriculars: [
    { id: "x", company: "Waves Swim Team", title: "Captain", location: "", start: "", end: "", bullets: [
      bullet("x1", "Led a 40-person team through a championship season"),
    ] },
  ],
  skills: { languages: [], frameworks: [], tools: [], interests: [] },
  aboutMe: "",
};

// normalize
check("normalize strips marker, bold, period, case, space",
  normalize("- **Built**  a  Thing.") === "built a thing");
check("normalize unifies dashes and curly quotes",
  normalize("Led “core” work — fast") === normalize('Led "core" work - fast'));

// placeholders
check("placeholder [X%]", hasPlaceholder("cut [X%]"));
check("placeholder [N users]", hasPlaceholder("for [N users]"));
check("no placeholder in plain text", !hasPlaceholder("cut 40%"));
check("parentheses are not placeholders", !hasPlaceholder("cut 40% (p95)"));

// matchBullet
const whole = matchBullet(master, "- Architected an AI developer platform with MCP and LLM orchestration to streamline deployments");
check("whole match ignores marker and trailing period",
  whole.status === "match" && whole.bulletId === "a1" && whole.whole && whole.owner === "Scout Motors" && whole.section === "Experience");
const partial = matchBullet(master, "cut p95 latency 40% for 2,000 users");
check("partial match ≥20 chars finds the span",
  partial.status === "match" && partial.bulletId === "a2" && !partial.whole &&
  master.experience[0].bullets[1].text.slice(partial.start, partial.end) === "cut p95 latency 40% for 2,000 users");
const partialCase = matchBullet(master, "CUT P95 LATENCY 40% FOR 2,000 USERS");
check("partial match is case-insensitive and keeps original span",
  partialCase.status === "match" && master.experience[0].bullets[1].text.slice(partialCase.start, partialCase.end) === "cut p95 latency 40% for 2,000 users");
check("short partial (<20) does not match", matchBullet(master, "cut p95").status === "none");
check("same text in two entries is ambiguous", matchBullet(master, "Shipped features").status === "ambiguous");
const extra = matchBullet(master, "Led a 40-person team through a championship season");
check("extracurricular bullets match", extra.status === "match" && extra.section === "Extracurriculars" && extra.owner === "Waves Swim Team");
check("unknown text is none", matchBullet(master, "Frameworks: React, Node.js").status === "none");

// classifyFindings
const f = (id: string, quote: string | null): GradeFinding => ({
  id, category: "content", title: id, severity: "high", quote, problem: "p", rewrite: "r", groundedness: "grounded",
});
const classes = classifyFindings(master, [f("q-null", null), f("q-none", "Frameworks: React"), f("q-amb", "Shipped features"), f("q-ok", "Shipped features? no"), f("q-a1", "Architected an AI developer platform with MCP and LLM orchestration to streamline deployments.")]);
check("null quote → todo (not unmatched)", classes.get("q-null")?.kind === "todo" && !(classes.get("q-null") as { unmatched: boolean }).unmatched);
check("unmatched quote → todo, unmatched", classes.get("q-none")?.kind === "todo" && (classes.get("q-none") as { unmatched: boolean }).unmatched);
check("ambiguous quote → todo, unmatched", classes.get("q-amb")?.kind === "todo");
const ok = classes.get("q-a1");
check("single match → applicable with original text",
  ok?.kind === "applicable" && ok.match.bulletId === "a1" && ok.original === master.experience[0].bullets[0].text);

// splice
check("whole splice replaces everything", splice("old text", { start: 0, end: 8, whole: true }, "new") === "new");
check("partial splice keeps surrounding text",
  splice("Built a cache that cut it 40% today", { start: 19, end: 29, whole: false }, "cut it [X%]") === "Built a cache that cut it [X%] today");

// The grader sees bullets as "- text" lines, so rewrites often come back with the marker.
check("whole splice drops a leading bullet marker", splice("old", { start: 0, end: 3, whole: true }, "- Reached 10M+ views") === "Reached 10M+ views");
check("whole splice drops a leading • marker", splice("old", { start: 0, end: 3, whole: true }, "•  Led a team") === "Led a team");
check("hyphenated first word is kept", splice("old", { start: 0, end: 3, whole: true }, "Co-led a team") === "Co-led a team");
const dashed = fixedResumeText("Jane\n- Built a cache that cut latency 40%\n", [{ quote: "- Built a cache that cut latency 40%", text: "- Built a Redis cache" }]);
check("upload fix doesn't double the marker", dashed.text === "Jane\n- Built a Redis cache\n", JSON.stringify(dashed.text));

// The quote's trailing period is outside the span, so a rewrite ending in one must not double it.
check("partial splice doesn't double the period",
  splice("Built a pipeline daily. Cut costs.", { start: 0, end: 22, whole: false }, "Built a Kafka pipeline daily.") === "Built a Kafka pipeline daily. Cut costs.");
const dot = fixedResumeText("- Built a data pipeline that processed logs daily.\n", [{ quote: "Built a data pipeline that processed logs daily.", text: "Built a Kafka pipeline processing 2M logs daily." }]);
check("upload fix doesn't double the period", dot.text === "- Built a Kafka pipeline processing 2M logs daily.\n", JSON.stringify(dot.text));

// fixStatus — an unedited rewrite with a number the resume doesn't have is the model's, not his
const nf = (rewrite: string, groundedness: "grounded" | "needs-your-input"): GradeFinding => ({
  id: "n", category: "content", title: "t", severity: "high", quote: "q", problem: "p", rewrite, groundedness });
check("grounded unedited rewrite is ready", fixStatus(nf("Cut latency 40%", "grounded"), "Cut latency 40%") === "ready");
check("unedited invented number needs confirming", fixStatus(nf("Cut latency 55%", "needs-your-input"), "Cut latency 55%") === "confirm-number");
check("edited text is his own facts", fixStatus(nf("Cut latency 55%", "needs-your-input"), "Cut latency 52%") === "ready");
check("placeholder blocks", fixStatus(nf("Cut [X%]", "needs-your-input"), "Cut [X%]") === "placeholder");
check("empty blocks", fixStatus(nf("x", "grounded"), "   ") === "empty");

// Two checked fixes on one bullet would make the second silently skip — flag every later one.
const conflicts = sameBulletConflicts([{ id: "f1", bulletId: "a1" }, { id: "f2", bulletId: "a2" }, { id: "f3", bulletId: "a1" }]);
check("later fix on the same bullet conflicts", conflicts.has("f3") && !conflicts.has("f1") && !conflicts.has("f2"));

// applyFixes
const a1 = master.experience[0].bullets[0];
const res = applyFixes(master, [
  { bulletId: "a1", original: a1.text, text: "Architected a platform used by 30 engineers", title: "t1" },
  { bulletId: "x1", original: "stale text", text: "should not apply", title: "t2" },
  { bulletId: "missing", original: "x", text: "y", title: "t3" },
]);
check("applied fix replaces text", res.resume.experience[0].bullets[0].text === "Architected a platform used by 30 engineers");
check("applied fix keeps id/tech/metrics/tags",
  JSON.stringify({ ...res.resume.experience[0].bullets[0], text: "" }) === JSON.stringify({ ...a1, text: "" }));
check("stale fix is skipped", res.resume.extracurriculars[0].bullets[0].text === master.extracurriculars[0].bullets[0].text);
check("applied/skipped reported", res.applied.join() === "a1" && res.skipped.map((s) => s.bulletId).join() === "x1,missing");
check("input master not mutated", master.experience[0].bullets[0].text === a1.text);
check("other bullets untouched", res.resume.projects[0].bullets[1].text === master.projects[0].bullets[1].text);

// sectionOfBullet
check("sectionOfBullet finds projects", sectionOfBullet(master, "p2") === "Projects");
check("sectionOfBullet unknown → null", sectionOfBullet(master, "zzz") === null);

// upload text
const text = "Jane\n- Built a cache that cut latency 40%\n- Wrote docs\n- Wrote docs";
check("findInText unique line", findInText(text, "- Built a cache that cut latency 40%.") !== null);
check("findInText duplicate → null", findInText(text, "Wrote docs") === null);
const fixed = fixedResumeText(text, [
  { quote: "Built a cache that cut latency 40%", text: "Built a Redis cache that cut latency 40%" },
  { quote: "Wrote docs", text: "never applied" },
]);
check("fixedResumeText replaces unique quotes only",
  fixed.replaced === 1 && fixed.text.includes("Built a Redis cache that cut latency 40%") && !fixed.text.includes("never applied"));

// hand-off
const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
const h: Handoff = { gradeId: "g", targetRole: "ml", level: "intern", jdText: null, createdAt: 1000,
  fixes: [{ bulletId: "a1", original: "o", text: "t", title: "x" }], todos: [] };
const unstamped: Omit<Handoff, "createdAt"> = { gradeId: h.gradeId, targetRole: h.targetRole, level: h.level, jdText: h.jdText, fixes: h.fixes, todos: h.todos };
writeHandoff(storage, unstamped, 1000);
check("handoff round-trips with createdAt stamped", JSON.stringify(readHandoff(storage, 2000)) === JSON.stringify({ ...unstamped, createdAt: 1000 }));
check("handoff deleted after read", !store.has(HANDOFF_KEY) && readHandoff(storage, 2000) === null);
writeHandoff(storage, unstamped, 1000);
check("expired handoff → null", readHandoff(storage, 1000 + HANDOFF_TTL_MS + 1) === null && !store.has(HANDOFF_KEY));
store.set(HANDOFF_KEY, "{not json");
check("malformed handoff → null and deleted", readHandoff(storage, 2000) === null && !store.has(HANDOFF_KEY));
store.set(HANDOFF_KEY, JSON.stringify({ ...h, fixes: "nope" }));
check("wrong-shape handoff → null", readHandoff(storage, 2000) === null);

console.log(pass ? "\n✓ grade-fixes test PASSED" : "\n✗ grade-fixes test FAILED");
process.exit(pass ? 0 : 1);
