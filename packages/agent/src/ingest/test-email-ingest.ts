import { pool } from "../db/pool";
import { initSchema } from "../db/schema";
import {
  createAppliedJob, getAppliedJob, listStatusEventsByApplication,
  listPendingReviews, isMessageProcessed, getGmailSyncState, setGmailSyncState,
} from "../db/queries";
import { runEmailIngest } from "./email-ingest";
import { EmailMessage, ClassifiedEmail } from "./types";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}
function mk(over: Partial<EmailMessage>): EmailMessage {
  return { id: "e1", from: "r <r@greenhouse.io>", fromDomain: "greenhouse.io", subject: "", snippet: "", body: "", receivedAt: new Date(), ...over };
}

async function main() {
  await initSchema();
  // matchApplication scans every applied_jobs row in this (persistent) DB, so reusing
  // plain "Bank of America" / "Software Engineer Intern" across separate process runs
  // creates two near-identical candidates on the second run — the ambiguity-margin
  // check then treats them as tied and refuses to match either. Suffix company/role
  // with a per-run token so each invocation's fixture is unambiguous against leftovers.
  const run = Date.now().toString(36);
  const company = `Bank of America ${run}`;
  const role = `Software Engineer Intern ${run}`;
  const app = await createAppliedJob({ company, jobTitle: role, status: "applied" });

  const emails: EmailMessage[] = [
    mk({ id: `e-match-${run}`, subject: "OA", body: `assessment for ${company} ${role}` }),
    mk({ id: `e-newsletter-${run}`, fromDomain: "substack.com", subject: "news", body: "top stories" }),
    mk({ id: `e-nomatch-${run}`, subject: "Interview", body: "interview for Netflix Data Scientist role" }),
  ];
  const classifyMap: Record<string, ClassifiedEmail> = {
    [`e-match-${run}`]: { isJobRelated: true, status: "assessment", company, role, deadlineAt: "2026-08-08" },
    [`e-newsletter-${run}`]: { isJobRelated: false, status: "none", company: "", role: "", deadlineAt: null },
    [`e-nomatch-${run}`]: { isJobRelated: true, status: "interviewing", company: "Netflix", role: "Data Scientist", deadlineAt: null },
  };
  let notified = 0;

  const result = await runEmailIngest({
    fetch: async () => ({ messages: emails, newHistoryId: "h-1" }),
    classify: async (e) => classifyMap[e.id],
    notify: async () => { notified++; },
  });

  check("all messages processed", result.processed === 3);
  check("one applied", result.applied === 1);
  check("one queued for review", result.queued === 1);

  const app2 = await getAppliedJob(app.id);
  check("matched app advanced to assessment", app2?.status === "assessment");
  const events = await listStatusEventsByApplication();
  check("status event recorded", (events[app.id] ?? []).some((e) => e.status === "assessment" && e.source === "email"));
  check("assessment triggered a notification", notified === 1);
  check("unmatched interview went to review", (await listPendingReviews()).some((r) => r.email_message_id === `e-nomatch-${run}`));
  check("newsletter marked processed, not queued", (await isMessageProcessed(`e-newsletter-${run}`)) === true &&
    !(await listPendingReviews()).some((r) => r.email_message_id === `e-newsletter-${run}`));

  // idempotency: re-running the same batch changes nothing
  const rerun = await runEmailIngest({
    fetch: async () => ({ messages: emails, newHistoryId: "h-1" }),
    classify: async (e) => classifyMap[e.id],
    notify: async () => { notified++; },
  });
  check("rerun applies nothing (idempotent)", rerun.applied === 0 && rerun.queued === 0);
  check("rerun sends no new notifications", notified === 1);

  // A failing message must NOT be marked processed and must NOT let the history cursor
  // advance past it — otherwise the all-or-nothing Gmail cursor would silently lose it.
  await setGmailSyncState(`cursor-before-${run}`);
  const before = (await getGmailSyncState()).history_id;
  const failId = `e-fail-${run}`;
  const failBatch: EmailMessage[] = [mk({ id: failId, subject: "OA", body: "assessment for anything" })];
  const failResult = await runEmailIngest({
    fetch: async () => ({ messages: failBatch, newHistoryId: `cursor-after-${run}` }),
    classify: async () => { throw new Error("simulated classify failure"); },
    notify: async () => { notified++; },
  });
  const after = (await getGmailSyncState()).history_id;
  check("failing message not applied or queued", failResult.applied === 0 && failResult.queued === 0);
  check("failing message left unprocessed for retry", (await isMessageProcessed(failId)) === false);
  check("history cursor did NOT advance past the failed batch", after === before && after === `cursor-before-${run}`);
  check("failing message sent no notification", notified === 1);

  await pool.end();
  console.log(pass ? "\n✓ email-ingest test PASSED" : "\n✗ email-ingest test FAILED");
  process.exit(pass ? 0 : 1);
}
main();
