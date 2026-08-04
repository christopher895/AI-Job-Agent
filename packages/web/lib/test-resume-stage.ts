import { segmentIndex, STAGE_SEGMENTS } from "./resumeStage";

function main() {
  const results: Record<string, boolean> = {
    threeSegments: STAGE_SEGMENTS.length === 3,
    nullIsUnknown: segmentIndex(null) === -1,
    unrecognizedIsUnknown: segmentIndex("") === -1,
    analyzingJobDescription: segmentIndex("Analyzing job description") === 0,
    applyingYourSelections: segmentIndex("Applying your selections") === 1,
    finalizingFormatting: segmentIndex("Finalizing formatting") === 2,
  };

  const pass = Object.values(results).every(Boolean);
  console.log(Object.entries(results).map(([k, v]) => `${k}:${v}`).join(" "));
  console.log(pass ? "\n✓ resume-stage segment test PASSED" : "\n✗ resume-stage segment test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
