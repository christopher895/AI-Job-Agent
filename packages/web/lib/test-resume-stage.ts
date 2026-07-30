import { segmentIndex, STAGE_SEGMENTS } from "./resumeStage";

function main() {
  const results: Record<string, boolean> = {
    fourSegments: STAGE_SEGMENTS.length === 4,
    nullIsUnknown: segmentIndex(null) === -1,
    unrecognizedIsUnknown: segmentIndex("") === -1,
    draftingPass1: segmentIndex("Drafting resume (pass 1)") === 0,
    critiquingDraft: segmentIndex("Critiquing draft") === 1,
    revisingPass2: segmentIndex("Revising resume (pass 2)") === 2,
    revisingPass3: segmentIndex("Revising resume (pass 3)") === 2,
    finalizingFormatting: segmentIndex("Finalizing formatting") === 3,
    // segmentIndex is a pure/stateless mapping, so calling it with
    // "Critiquing draft" again after "Revising..." must land back on index 1
    // (not get "stuck" on 2) — this is what lets the stepper move its
    // highlight backward on a second critique pass.
    revisitingCritiquingAfterRevising:
      segmentIndex("Revising resume (pass 2)") === 2 && segmentIndex("Critiquing draft") === 1,
  };

  const pass = Object.values(results).every(Boolean);
  console.log(Object.entries(results).map(([k, v]) => `${k}:${v}`).join(" "));
  console.log(pass ? "\n✓ resume-stage segment test PASSED" : "\n✗ resume-stage segment test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
