import { Suggestion } from "./api";

/**
 * Client-side mirror of packages/agent/src/ai/suggestion-rounds.ts. One
 * resume's `suggestions` holds every round: null = under review now,
 * true/false = decided in an earlier round (the JD pass, or a previous
 * feedback round). Only the undecided items are shown in the checklist.
 */

/** Must match FEEDBACK_STAGE on the agent — starts with "Analyzing" so the stepper maps it to segment 0. */
export const FEEDBACK_STAGE = "Analyzing feedback";

export function undecided(stored: Suggestion[]): Suggestion[] {
  return stored.filter((s) => s.accepted === null);
}

/** True when the batch under review came from pasted feedback rather than the JD pass. */
export function isFollowUpRound(stored: Suggestion[]): boolean {
  return undecided(stored).some((s) => s.source === "feedback");
}
