import {
  FEEDBACK_STAGE,
  appendBatch,
  composeAccepted,
  isFollowUpRound,
  undecided,
} from "./suggestion-rounds";
import { Suggestion } from "./types";

let allPass = true;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) {
    allPass = false;
    console.log(`   ✗ [${label}] ${detail ?? "failed"}`);
  }
}

function sugg(id: string, accepted: boolean | null, extra: Partial<Suggestion> = {}): Suggestion {
  return {
    id,
    kind: "skill-addition",
    targetId: "tools",
    keyword: id,
    suggestedText: id,
    rationale: "",
    groundedness: "grounded",
    accepted,
    ...extra,
  };
}

// --- appendBatch: new items land undecided, ids never collide with stored ones ---
{
  const stored = [sugg("sugg-1", true), sugg("sugg-2", false)];
  const batch = [sugg("sugg-1", null), sugg("sugg-3", null)];
  const merged = appendBatch(stored, batch);
  check("append-keeps-stored", merged.length === 4 && merged[0].id === "sugg-1" && merged[1].id === "sugg-2");
  check("append-renames-collision", merged[2].id !== "sugg-1", `got: ${merged[2].id}`);
  check("append-keeps-unique-id", merged[3].id === "sugg-3");
  check("append-batch-undecided", merged.slice(2).every((s) => s.accepted === null));
  check("append-ids-unique", new Set(merged.map((s) => s.id)).size === 4);
  check("append-stored-untouched", stored.length === 2);
}
{
  // Two collisions with the same id must still end up distinct.
  const merged = appendBatch([sugg("sugg-1", true), sugg("sugg-1-r2", true)], [sugg("sugg-1", null)]);
  check("append-double-collision", new Set(merged.map((s) => s.id)).size === 3, merged.map((s) => s.id).join(","));
}

// --- undecided / isFollowUpRound ---
{
  const stored = [sugg("a", true), sugg("b", false), sugg("c", null)];
  check("undecided-filters", undecided(stored).map((s) => s.id).join() === "c");
  check("jd-round-not-follow-up", isFollowUpRound(stored) === false);
  check("follow-up-by-source", isFollowUpRound([sugg("x", null, { source: "feedback" })]) === true);
  // A JD pass that produced nothing leaves no decided items — source, not decision state, must decide.
  check("follow-up-after-empty-jd-round", isFollowUpRound([sugg("x", null, { source: "feedback" })]) === true);
  check("decided-feedback-items-dont-count", isFollowUpRound([sugg("x", true, { source: "feedback" }), sugg("y", null, { source: "jd" })]) === false);
  check("first-round-empty", isFollowUpRound([]) === false);
}

// --- composeAccepted: prior accepted suggestions survive a later round ---
{
  const stored = [
    sugg("a", true, { kind: "bullet-rewrite", targetId: "b1", suggestedText: "round one text" }),
    sugg("b", false),
    sugg("c", null),
    sugg("d", null, { kind: "bullet-rewrite", targetId: "b1", suggestedText: "round two text" }),
  ];
  const submitted = [{ ...stored[3], suggestedText: "round two text, edited" }];
  const composed = composeAccepted(stored, submitted);
  check("compose-includes-prior-accepted", composed.some((s) => s.id === "a"));
  check("compose-excludes-prior-rejected", !composed.some((s) => s.id === "b"));
  check("compose-excludes-unchecked-current", !composed.some((s) => s.id === "c"));
  check("compose-uses-submitted-edit", composed.find((s) => s.id === "d")?.suggestedText === "round two text, edited");
  // Later rounds must come after earlier ones so a second rewrite of the same
  // bullet wins in applySuggestions' last-write-wins map.
  check("compose-prior-first", composed.map((s) => s.id).join() === "a,d", composed.map((s) => s.id).join());
}
{
  // First round: nothing stored is decided, so the result is exactly what was submitted.
  const stored = [sugg("a", null), sugg("b", null)];
  const composed = composeAccepted(stored, [stored[1]]);
  check("compose-first-round-passthrough", composed.map((s) => s.id).join() === "b");
}
{
  // A submitted item that is ALSO a prior accepted one (client re-sent it) is not duplicated.
  const stored = [sugg("a", true)];
  const composed = composeAccepted(stored, [stored[0]]);
  check("compose-no-duplicate", composed.length === 1);
}

check("feedback-stage-is-analyzing", FEEDBACK_STAGE.startsWith("Analyzing"), FEEDBACK_STAGE);

console.log(allPass ? "\n✓ suggestion-rounds test PASSED" : "\n✗ suggestion-rounds test FAILED");
process.exit(allPass ? 0 : 1);
