/** The 4 fixed stepper segments shown on the resume-pending screen, in order. */
export const STAGE_SEGMENTS = ["Drafting", "Critiquing", "Revising", "Finalizing"] as const;

/**
 * Maps a raw backend stage string (e.g. "Drafting resume (pass 1)") to one of
 * the 4 fixed segment indices above, matched by prefix rather than exact
 * string — this lets repeated passes (e.g. "Revising resume (pass 2)" and
 * "Revising resume (pass 3)") both light up the same segment, and lets a
 * later "Critiquing draft" after a revision move the highlight BACK to
 * "Critiquing" instead of erroring on an out-of-order transition.
 * Returns -1 when the stage is null or unrecognized (caller falls back to a
 * generic spinner in that case).
 */
export function segmentIndex(stage: string | null): number {
  if (!stage) return -1;
  if (stage.startsWith("Drafting")) return 0;
  if (stage.startsWith("Critiquing")) return 1;
  if (stage.startsWith("Revising")) return 2;
  if (stage.startsWith("Finalizing")) return 3;
  return -1;
}
