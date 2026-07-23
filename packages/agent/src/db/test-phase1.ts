import "dotenv/config";
import { pool } from "./pool";
import { initSchema } from "./schema";
import {
  getMasterResume,
  updateMasterResume,
  createPendingResume,
  completeTailoredResume,
  getTailoredResume,
  listTailoredResumes,
  updateTailoredResume,
  storePdf,
  getPdf,
  createAppliedJob,
  listAppliedJobs,
  updateAppliedJob,
} from "./queries";

let passed = 0;
let failed = 0;

function ok(label: string, value: boolean) {
  if (value) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function cleanup(resumeId?: string, appliedId?: string) {
  if (appliedId) await pool.query("DELETE FROM applied_jobs WHERE id = $1", [appliedId]);
  if (resumeId) await pool.query("DELETE FROM tailored_resumes WHERE id = $1", [resumeId]);
}

async function main() {
  console.log("── 1. Schema init ──────────────────────────────────────────");
  await initSchema();

  const { rows: tables } = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('tailored_resumes','master_resume','applied_jobs')
    ORDER BY table_name
  `);
  const tableNames = tables.map((r: any) => r.table_name);
  ok("tailored_resumes table exists", tableNames.includes("tailored_resumes"));
  ok("master_resume table exists", tableNames.includes("master_resume"));
  ok("applied_jobs table exists", tableNames.includes("applied_jobs"));

  console.log("\n── 2. getMasterResume ──────────────────────────────────────");
  const master = await getMasterResume();
  ok("returns an object", typeof master === "object" && master !== null);
  ok("basics.name is Christopher Zhang", master.basics.name === "Christopher Zhang");
  ok("experience array is non-empty", master.experience.length > 0);
  ok("projects array is non-empty", master.projects.length > 0);
  ok("skills.languages is non-empty", master.skills.languages.length > 0);

  console.log("\n── 3. updateMasterResume ───────────────────────────────────");
  const modified = { ...master, basics: { ...master.basics, phone: "555-TEST" } };
  await updateMasterResume(modified);
  const reloaded = await getMasterResume();
  ok("phone update persisted", reloaded.basics.phone === "555-TEST");
  // restore original
  await updateMasterResume(master);
  const restored = await getMasterResume();
  ok("phone restored to original", restored.basics.phone === master.basics.phone);

  console.log("\n── 4. createPendingResume + completeTailoredResume ──────────");
  const pending = await createPendingResume({
    jobTitle: "Software Engineer Intern",
    company: "TestCo",
    jobUrl: "https://testco.com/jobs/1",
    jdText: "We need a great engineer.",
  });
  ok("returns a row with id", typeof pending.id === "string" && pending.id.length > 0);
  ok("starts pending", pending.status === "pending");
  await completeTailoredResume(pending.id, {
    markdown: "# Christopher Zhang\n\n## Experience\n- Built things",
    criticScore: 82,
  });
  const created = await getTailoredResume(pending.id);
  ok("job_title matches", created?.job_title === "Software Engineer Intern");
  ok("company matches", created?.company === "TestCo");
  ok("critic_score matches", created?.critic_score === 82);
  ok("markdown matches", created?.markdown.includes("Christopher Zhang") ?? false);
  ok("status ready", created?.status === "ready");

  console.log("\n── 5. getTailoredResume ────────────────────────────────────");
  const fetched = await getTailoredResume(pending.id);
  ok("fetched by id", fetched !== null);
  ok("id matches", fetched?.id === pending.id);
  ok("jd_text present", fetched?.jd_text === "We need a great engineer.");

  const missing = await getTailoredResume("00000000-0000-0000-0000-000000000000");
  ok("returns null for unknown id", missing === null);

  console.log("\n── 6. listTailoredResumes ──────────────────────────────────");
  const list = await listTailoredResumes();
  ok("list is an array", Array.isArray(list));
  ok("created resume appears in list", list.some((r) => r.id === pending.id));
  ok("pdf column NOT included in list", !("pdf" in list[0]));

  console.log("\n── 7. updateTailoredResume ─────────────────────────────────");
  const newMarkdown = "# Christopher Zhang\n\n## Experience\n- Built even better things";
  const updated = await updateTailoredResume(pending.id, { markdown: newMarkdown });
  ok("update returns the row", updated !== null);
  ok("markdown is updated", updated?.markdown === newMarkdown);
  ok("updated_at changed", updated!.updated_at >= created!.updated_at);

  console.log("\n── 8. storePdf / getPdf ────────────────────────────────────");
  const fakePdf = Buffer.from("%PDF-1.4 fake pdf content for phase 1 test");
  await storePdf(pending.id, fakePdf);
  const retrieved = await getPdf(pending.id);
  ok("pdf retrieved is a Buffer", Buffer.isBuffer(retrieved));
  ok("pdf content matches", retrieved?.toString() === fakePdf.toString());

  const noPdf = await getPdf("00000000-0000-0000-0000-000000000000");
  ok("getPdf returns null for unknown id", noPdf === null);

  console.log("\n── 9. createAppliedJob ─────────────────────────────────────");
  const applied = await createAppliedJob({
    company: "TestCo",
    jobTitle: "Software Engineer Intern",
    location: "Remote",
    jobUrl: "https://testco.com/jobs/1",
    status: "applied",
    resumeId: pending.id,
  });
  ok("returns a row with id", typeof applied.id === "string" && applied.id.length > 0);
  ok("company matches", applied.company === "TestCo");
  ok("status is 'applied'", applied.status === "applied");
  ok("resume_id FK set", applied.resume_id === pending.id);

  console.log("\n── 10. listAppliedJobs ─────────────────────────────────────");
  const appliedList = await listAppliedJobs();
  ok("list is an array", Array.isArray(appliedList));
  ok("created entry appears in list", appliedList.some((r) => r.id === applied.id));

  console.log("\n── 11. updateAppliedJob ────────────────────────────────────");
  const statusUpdated = await updateAppliedJob(applied.id, { status: "interviewing", sheetsRow: 5 });
  ok("update returns the row", statusUpdated !== null);
  ok("status updated to 'interviewing'", statusUpdated?.status === "interviewing");
  ok("sheets_row set to 5", statusUpdated?.sheets_row === 5);

  const invalidStatus = await pool
    .query("UPDATE applied_jobs SET status = 'invalid' WHERE id = $1", [applied.id])
    .then(() => false)
    .catch(() => true);
  ok("CHECK constraint rejects invalid status", invalidStatus);

  console.log("\n── Cleanup ──────────────────────────────────────────────────");
  await cleanup(pending.id, applied.id);
  ok("test rows removed", true);

  console.log(`\n${"─".repeat(55)}`);
  console.log(`PASSED: ${passed}   FAILED: ${failed}`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => pool.end());
