import { pool } from "./pool";
import { initSchema } from "./schema";
import {
  createPendingResume,
  updateResumeStage,
  getTailoredResume,
  upsertPendingGeneralResume,
  getGeneralResume,
} from "./queries";

async function main() {
  await initSchema();

  // Clean slate for repeat runs of this script.
  await pool.query("DELETE FROM tailored_resumes WHERE job_title = $1", ["__test_stage__"]);

  const row = await createPendingResume({ jobTitle: "__test_stage__", company: "Acme" });
  const startsNull = row.stage === null;

  await updateResumeStage(row.id, "Drafting resume (pass 1)");
  const afterFirstWrite = await getTailoredResume(row.id);
  const firstWriteOk = afterFirstWrite?.stage === "Drafting resume (pass 1)";

  await updateResumeStage(row.id, "Critiquing draft");
  const afterSecondWrite = await getTailoredResume(row.id);
  const secondWriteOk = afterSecondWrite?.stage === "Critiquing draft";

  // General-resume regeneration must clear a stale stage from a previous run.
  const firstGeneral = await upsertPendingGeneralResume();
  await updateResumeStage(firstGeneral.id, "Finalizing formatting");
  const secondGeneral = await upsertPendingGeneralResume();
  const sameRow = secondGeneral.id === firstGeneral.id;
  const staleStageCleared = secondGeneral.stage === null;
  const freshGeneral = await getGeneralResume();
  const freshGeneralClear = freshGeneral?.stage === null;

  // Clean up this run's rows.
  await pool.query("DELETE FROM tailored_resumes WHERE id = ANY($1)", [[row.id, firstGeneral.id]]);

  const pass =
    startsNull && firstWriteOk && secondWriteOk && sameRow && staleStageCleared && freshGeneralClear;

  console.log(
    `startsNull:${startsNull} firstWriteOk:${firstWriteOk} secondWriteOk:${secondWriteOk} ` +
    `sameRow:${sameRow} staleStageCleared:${staleStageCleared} freshGeneralClear:${freshGeneralClear}`
  );
  console.log(pass ? "\n✓ stage-tracking DB test PASSED" : "\n✗ stage-tracking DB test FAILED");

  await pool.end();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
