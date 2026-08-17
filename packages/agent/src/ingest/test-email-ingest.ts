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

  // Terminal states must never be resurrected by a later email (defense-in-depth
  // alongside status-order.ts's canAdvance guard, which also blocks leaving rejected/no_response).
  const rejectedCompany = `Terminal Co ${run}`;
  const rejectedRole = `Terminal Role ${run}`;
  const rejectedApp = await createAppliedJob({ company: rejectedCompany, jobTitle: rejectedRole, status: "rejected" });
  const terminalEmailId = `e-terminal-${run}`;
  const terminalResult = await runEmailIngest({
    fetch: async () => ({
      messages: [mk({ id: terminalEmailId, subject: "OA", body: `assessment for ${rejectedCompany} ${rejectedRole}` })],
      newHistoryId: `cursor-terminal-${run}`,
    }),
    classify: async () => ({ isJobRelated: true, status: "assessment", company: rejectedCompany, role: rejectedRole, deadlineAt: null }),
    notify: async () => { notified++; },
  });
  const rejectedAfter = await getAppliedJob(rejectedApp.id);
  check("terminal application not resurrected: status still rejected", rejectedAfter?.status === "rejected");
  const terminalEvents = (await listStatusEventsByApplication())[rejectedApp.id] ?? [];
  check(
    "no email-source status_event advanced the terminal application",
    !terminalEvents.some((e) => e.source === "email" && e.status === "assessment")
  );
  check(
    "terminal-application email routed to review queue instead",
    (await listPendingReviews()).some((r) => r.email_message_id === terminalEmailId)
  );
  check("terminal-application email queued, not applied", terminalResult.applied === 0 && terminalResult.queued === 1);

  // A keyword-matching email from a random mailbox must not auto-reject a live application.
  const phishCompany = `Phish Co ${run}`;
  const phishRole = `Phish Role ${run}`;
  const phishApp = await createAppliedJob({ company: phishCompany, jobTitle: phishRole, status: "applied" });
  const phishId = `e-phish-${run}`;
  const phishResult = await runEmailIngest({
    fetch: async () => ({
      messages: [mk({
        id: phishId,
        from: "x <x@gmail.com>",
        fromDomain: "gmail.com",
        subject: "unfortunately",
        body: `unfortunately your application for ${phishRole} at ${phishCompany}`,
      })],
      newHistoryId: `cursor-phish-${run}`,
    }),
    classify: async () => ({ isJobRelated: true, status: "rejected", company: phishCompany, role: phishRole, deadlineAt: null }),
    notify: async () => { notified++; },
  });
  const phishAfter = await getAppliedJob(phishApp.id);
  check("spoofed rejection left status as applied", phishAfter?.status === "applied");
  check("spoofed rejection went to review, not applied", phishResult.applied === 0 && phishResult.queued === 1);
  check("spoofed rejection sent no notification", notified === 1);

  const atsCompany = `ATS Co ${run}`;
  const atsRole = `ATS Role ${run}`;
  const atsApp = await createAppliedJob({ company: atsCompany, jobTitle: atsRole, status: "applied" });
  const atsId = `e-ats-reject-${run}`;
  const atsResult = await runEmailIngest({
    fetch: async () => ({
      messages: [mk({
        id: atsId,
        fromDomain: "greenhouse.io",
        subject: "your candidacy",
        body: `unfortunately ${atsCompany} ${atsRole}`,
      })],
      newHistoryId: `cursor-ats-${run}`,
    }),
    classify: async () => ({ isJobRelated: true, status: "rejected", company: atsCompany, role: atsRole, deadlineAt: null }),
    notify: async () => { notified++; },
  });
  const atsAfter = await getAppliedJob(atsApp.id);
  check("allowlisted ATS rejection auto-applied", atsAfter?.status === "rejected");
  check("allowlisted ATS rejection counted as applied, not queued", atsResult.applied === 1 && atsResult.queued === 0);

  await pool.end();
  console.log(pass ? "\n✓ email-ingest test PASSED" : "\n✗ email-ingest test FAILED");
  process.exit(pass ? 0 : 1);
}
main();
