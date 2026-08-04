import { draftStageLabel } from "./chain";

function main() {
  const pass1 = draftStageLabel(1) === "Drafting resume (pass 1)";
  const pass2 = draftStageLabel(2) === "Revising resume (pass 2)";
  const pass3 = draftStageLabel(3) === "Revising resume (pass 3)";

  const pass = pass1 && pass2 && pass3;
  console.log(`pass1:${pass1} pass2:${pass2} pass3:${pass3}`);
  console.log(pass ? "\n✓ chain progress label test PASSED" : "\n✗ chain progress label test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
