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

/**
 * Expected wall-clock duration per segment (ms), used only to animate an
 * honest progress *estimate* (see estimateStageProgress) — the backend has
 * no way to report literal completion percentage mid-call. Grounded in real
 * measured latency where it exists:
 *  - Analyzing: a single non-streaming `claude -p` call; ~80s on a clean run
 *    per the DEFAULT_TIMEOUT_MS comment in packages/agent/src/ai/claude-cli.ts.
 *  - Applying: deterministic in-process work (applySuggestions + renderMarkdown),
 *    no LLM call — a few seconds including the DB round trip.
 *  - Finalizing: PDF render via Tectonic; the suggestion-based flow skips the
 *    widow-fix pass and usually needs no trim pass either. Trim passes (0-2,
 *    each an LLM call) only run on page overflow and are the main source of
 *    outliers past this estimate — covered by the 92% cap and elapsed counter
 *    in estimateStageProgress, not by a bigger constant here.
 */
export const STAGE_EXPECTED_MS = [80_000, 3_000, 15_000] as const;

export type StageProgress = { percent: number; elapsedSeconds: number; expectedSeconds: number };

/**
 * Estimates how far into the current stage we are, as elapsed-time-vs-typical
 * — not a literal completion percentage. Capped at 92% so it never visually
 * finishes before the real stage transition (driven by polling, not by this
 * estimate). Returns null when there isn't enough information yet (caller
 * falls back to a generic spinner): stage/stageStartedAt missing, or an
 * unrecognized stage string.
 */
export function estimateStageProgress(
  stage: string | null,
  stageStartedAt: string | null,
  now: number
): StageProgress | null {
  if (!stage || !stageStartedAt) return null;
  const index = segmentIndex(stage);
  if (index === -1) return null;

  const startedMs = Date.parse(stageStartedAt);
  if (Number.isNaN(startedMs)) return null;

  const expectedMs = STAGE_EXPECTED_MS[index];
  const elapsedMs = Math.max(0, now - startedMs);
  const percent = Math.min(92, (elapsedMs / expectedMs) * 100);

  return {
    percent,
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    expectedSeconds: Math.round(expectedMs / 1000),
  };
}
