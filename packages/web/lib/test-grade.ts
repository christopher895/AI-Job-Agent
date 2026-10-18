import { findingsToFeedback, defaultCheckedIds, isStalePending, rerunBody, pendingActions, MAX_FEEDBACK_CHARS, STALE_PENDING_MS } from "./grade";
import type { Grade, GradeFinding } from "./api";

let pass = true;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) { pass = false; console.log(`   ✗ [${label}] ${detail ?? "failed"}`); }
}

const finding = (id: string, severity: GradeFinding["severity"], extra: Partial<GradeFinding> = {}): GradeFinding => ({
  id, category: "content", title: `Title ${id}`, severity, quote: null, problem: `Problem ${id}.`,
  rewrite: null, groundedness: "grounded", ...extra,
});

// Feedback formatting
const fb = findingsToFeedback([
  finding("a", "high", { quote: "Built stuff", rewrite: "Built [N] services" }),
  finding("b", "low"),
]);
check("includes title and problem", fb.text.includes("Title a — Problem a."));
check("includes the quoted line", fb.text.includes('"Built stuff"'));
check("includes the suggestion", fb.text.includes("Suggested: Built [N] services"));
check("omits Suggested when there is no rewrite", !fb.text.includes("Title b — Problem b.\n   Suggested"));
check("counts included findings", fb.included === 2);

const many = Array.from({ length: 60 }, (_, i) => finding(`f${i}`, "high", { problem: "x".repeat(400) }));
const capped = findingsToFeedback(many);
check("stays within the feedback route's limit", capped.text.length <= MAX_FEEDBACK_CHARS, `${capped.text.length}`);
check("truncates to whole findings", capped.included < 60 && capped.included > 0);
check("never cuts a finding mid-way", !capped.text.includes(`Title f${capped.included}`));

// Default selection
const checked = defaultCheckedIds([finding("h", "high"), finding("m", "medium"), finding("l", "low")]);
check("high and medium pre-checked, low not", checked.has("h") && checked.has("m") && !checked.has("l"));

// Staleness
const base = { status: "pending", created_at: new Date(0).toISOString() } as Pick<Grade, "status" | "created_at">;
check("pending older than 10 min is stale", isStalePending(base, STALE_PENDING_MS + 1));
check("fresh pending is not stale", !isStalePending(base, 1000));
check("ready is never stale", !isStalePending({ ...base, status: "ready" }, STALE_PENDING_MS * 10));

// Pending actions — a stuck grade must stay cancellable, not just re-runnable
const fresh = pendingActions(base, 1000);
check("fresh pending grade offers Cancel only", fresh.canCancel && !fresh.canRerun);
const stuck = pendingActions(base, STALE_PENDING_MS + 1);
check("stale pending grade offers Cancel AND Re-run", stuck.canCancel && stuck.canRerun);
const done = pendingActions({ ...base, status: "ready" }, 1000);
check("settled grade offers Re-run, not Cancel", !done.canCancel && done.canRerun);

// Re-run bodies
const g = (over: Partial<Grade>): Grade => ({
  id: "g", label: "Databricks — SWE Intern", source: "tailored", resume_id: "r1", target_role: "ml",
  level: "intern", status: "ready", score: 80, created_at: "", updated_at: "", resume_text: "snapshot text",
  jd_text: "JD", specialists: {}, report: null, error: null, ...over,
});
const tailored = rerunBody(g({}));
check("tailored re-run targets the resume", tailored.source === "tailored" && tailored.resumeId === "r1" && tailored.jdText === "JD");
const orphan = rerunBody(g({ resume_id: null }));
check("deleted tailored resume falls back to the snapshot",
  orphan.source === "upload" && orphan.text === "snapshot text" && orphan.label === "Databricks — SWE Intern");
const master = rerunBody(g({ source: "master", resume_id: null, jd_text: null }));
check("master re-run re-reads the master", master.source === "master" && master.text === undefined && master.jdText === undefined);
const upload = rerunBody(g({ source: "upload", resume_id: null, label: "old.pdf" }));
check("upload re-run resends the snapshot", upload.source === "upload" && upload.text === "snapshot text" && upload.label === "old.pdf");

console.log(pass ? "\n✓ grade helpers test PASSED" : "\n✗ grade helpers test FAILED");
process.exit(pass ? 0 : 1);
