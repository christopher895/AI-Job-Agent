/**
 * Helpers for stacking suggestion rounds on one tailored resume.
 *
 * Round one is the JD keyword pass (suggest-keywords.ts). Later rounds come
 * from pasted reviewer feedback (suggest-from-feedback.ts) on a resume that is
 * already `ready`. All rounds share the row's single `suggestions` column:
 *   - accepted === null   → proposed in the round currently under review
 *   - accepted === true   → applied in an earlier round; must stay applied
 *   - accepted === false  → rejected in an earlier round
 * Since the apply pass always regenerates from the master resume, a later
 * round only composes on an earlier one if the earlier accepted items are
 * re-applied alongside it — that is what composeAccepted() guarantees.
 */
import { Suggestion } from "./types";

/**
 * Stage string written while a feedback round's LLM call runs. Starts with
 * "Analyzing" so the pending-screen stepper (web/lib/resumeStage.ts) maps it
 * to the same first segment as the JD pass, and the cancel route uses it to
 * tell a feedback round apart from an apply pass (both have suggestions set).
 */
export const FEEDBACK_STAGE = "Analyzing feedback";

/** Suggestions still awaiting a decision in the current round. */
export function undecided(stored: Suggestion[]): Suggestion[] {
  return stored.filter((s) => s.accepted === null);
}

/** True when the batch under review came from pasted feedback rather than the JD pass. */
export function isFollowUpRound(stored: Suggestion[]): boolean {
  return undecided(stored).some((s) => s.source === "feedback");
}

/**
 * Appends a freshly generated batch to the stored set as undecided items.
 * The model numbers each batch from "sugg-1", so ids are re-suffixed on
 * collision to keep every id in the row unique (the checklist and the apply
 * route both key on id).
 */
export function appendBatch(stored: Suggestion[], batch: Suggestion[]): Suggestion[] {
  const taken = new Set(stored.map((s) => s.id));
  const renamed = batch.map((s) => {
    let id = s.id;
    for (let n = 2; taken.has(id); n++) id = `${s.id}-r${n}`;
    taken.add(id);
    return { ...s, id, accepted: null };
  });
  return [...stored, ...renamed];
}

/**
 * The full set to apply for this round: everything accepted in earlier
 * rounds (unless the client re-submitted it, in which case the submitted
 * copy wins) followed by what the user just checked. Earlier rounds come
 * first so a later rewrite of the same bullet wins in applySuggestions().
 */
export function composeAccepted(stored: Suggestion[], submitted: Suggestion[]): Suggestion[] {
  const submittedIds = new Set(submitted.map((s) => s.id));
  const prior = stored.filter((s) => s.accepted === true && !submittedIds.has(s.id));
  return [...prior, ...submitted];
}
