/** The 3 fixed stepper segments shown on the resume-pending screen, in order. */
export const STAGE_SEGMENTS = ["Analyzing", "Applying", "Finalizing"] as const;

/**
 * Maps a raw backend stage string to one of the 3 fixed segment indices
 * above, matched by prefix (mirrors the tailoring pipeline's two phases:
 * "Analyzing job description" while suggestions are generated, then
 * "Applying your selections" / "Finalizing formatting" once accepted
 * suggestions are submitted). Returns -1 when the stage is null or
 * unrecognized (caller falls back to a generic spinner in that case).
 */
export function segmentIndex(stage: string | null): number {
  if (!stage) return -1;
  if (stage.startsWith("Analyzing")) return 0;
  if (stage.startsWith("Applying")) return 1;
  if (stage.startsWith("Finalizing")) return 2;
  return -1;
}
