import { pool } from "./pool";
import { initSchema } from "./schema";
import {
  listTailoredResumes,
  getGeneralResume,
  upsertPendingGeneralResume,
  createPendingResume,
  completeTailoredResume,
} from "./queries";

async function main() {
  await initSchema();

  // Clean slate for repeat runs of this script.
  await pool.query(
    "DELETE FROM tailored_resumes WHERE job_title IN ($1, $2)",
    ["General Software Engineer", "__test_tailored__"]
  );

  const beforeAny = await getGeneralResume();
  const noneYet = beforeAny === null;

  const first = await upsertPendingGeneralResume();
  const firstOk = first.status === "pending" && first.job_title === "General Software Engineer";

  const second = await upsertPendingGeneralResume();
  const singleton = second.id === first.id;

  await completeTailoredResume(first.id, { markdown: "# Test General Resume", criticScore: 90 });
  const afterComplete = await getGeneralResume();
  const completedOk =
    afterComplete !== null &&
    afterComplete.status === "ready" &&
    afterComplete.markdown === "# Test General Resume";

  const tailored = await createPendingResume({ jobTitle: "__test_tailored__", company: "Acme" });
  const list = await listTailoredResumes();
  const listExcludesGeneral = !list.some((r) => r.id === first.id);
  const listIncludesTailored = list.some((r) => r.id === tailored.id);

  // Clean up this run's rows.
  await pool.query("DELETE FROM tailored_resumes WHERE id = ANY($1)", [[first.id, tailored.id]]);

  const pass =
    noneYet && firstOk && singleton && completedOk && listExcludesGeneral && listIncludesTailored;

  console.log(
    `noneYet:${noneYet} firstOk:${firstOk} singleton:${singleton} completedOk:${completedOk} ` +
    `listExcludesGeneral:${listExcludesGeneral} listIncludesTailored:${listIncludesTailored}`
  );
  console.log(pass ? "\n✓ general-resume DB test PASSED" : "\n✗ general-resume DB test FAILED");

  await pool.end();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
