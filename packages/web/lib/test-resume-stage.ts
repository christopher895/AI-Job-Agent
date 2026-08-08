import { segmentIndex, STAGE_SEGMENTS, estimateStageProgress, STAGE_EXPECTED_MS } from "./resumeStage";

function main() {
  const results: Record<string, boolean> = {
    threeSegments: STAGE_SEGMENTS.length === 3,
    nullIsUnknown: segmentIndex(null) === -1,
    unrecognizedIsUnknown: segmentIndex("") === -1,
    analyzingJobDescription: segmentIndex("Analyzing job description") === 0,
    applyingYourSelections: segmentIndex("Applying your selections") === 1,
    finalizingFormatting: segmentIndex("Finalizing formatting") === 2,

    progressNullStage: estimateStageProgress(null, "2026-08-07T00:00:00.000Z", Date.now()) === null,
    progressNullStartedAt: estimateStageProgress("Analyzing job description", null, Date.now()) === null,
    progressUnrecognizedStage: estimateStageProgress("Whatever", "2026-08-07T00:00:00.000Z", Date.now()) === null,

    progressProportionalUnderExpected: (() => {
      const startedAt = new Date(0).toISOString();
      const now = 40_000; // 40s elapsed; Analyzing expects 80s → 50%
      const result = estimateStageProgress("Analyzing job description", startedAt, now);
      return (
        result !== null &&
        Math.abs(result.percent - 50) < 0.01 &&
        result.elapsedSeconds === 40 &&
        result.expectedSeconds === 80
      );
    })(),

    progressCappedOverExpected: (() => {
      const startedAt = new Date(0).toISOString();
      const now = 200_000; // way past the 80s expected duration
      const result = estimateStageProgress("Analyzing job description", startedAt, now);
      return result !== null && result.percent === 92 && result.elapsedSeconds === 200;
    })(),

    progressUsesRightExpectedPerSegment: (() => {
      const startedAt = new Date(0).toISOString();
      const analyzing = estimateStageProgress("Analyzing job description", startedAt, 0);
      const applying = estimateStageProgress("Applying your selections", startedAt, 0);
      const finalizing = estimateStageProgress("Finalizing formatting", startedAt, 0);
      return (
        analyzing?.expectedSeconds === Math.round(STAGE_EXPECTED_MS[0] / 1000) &&
        applying?.expectedSeconds === Math.round(STAGE_EXPECTED_MS[1] / 1000) &&
        finalizing?.expectedSeconds === Math.round(STAGE_EXPECTED_MS[2] / 1000)
      );
    })(),
  };

  const pass = Object.values(results).every(Boolean);
  console.log(Object.entries(results).map(([k, v]) => `${k}:${v}`).join(" "));
  console.log(pass ? "\n✓ resume-stage segment test PASSED" : "\n✗ resume-stage segment test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
