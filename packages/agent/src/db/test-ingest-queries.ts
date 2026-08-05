import { pool } from "./pool";
import { initSchema } from "./schema";
import {
  getGmailSyncState, setGmailSyncState,
  isMessageProcessed, markMessageProcessed,
  createStatusEvent, listStatusEventsByApplication,
  enqueueReview, listPendingReviews, getReview, resolveReview,
  createAppliedJob, getAppliedJob,
} from "./queries";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

// Per-run unique suffix so reruns against a persistent local Postgres never collide
// with rows left behind by an earlier run (matches the repo's integration-test cleanup convention).
const RUN = Date.now().toString(36);
const M1 = `m-1-${RUN}`;
const M2 = `m-2-${RUN}`;
const M3 = `m-3-${RUN}`;

async function main() {
  await initSchema();

  // sync state — the singleton (id=1) persists across runs, so clear it first to keep the
  // "starts null" assertion meaningful and idempotent.
  await pool.query("DELETE FROM gmail_sync_state WHERE id = 1");
  const empty = await getGmailSyncState();
  check("sync state starts null", empty.history_id === null);
  await setGmailSyncState("hist-123");
  check("sync state persists", (await getGmailSyncState()).history_id === "hist-123");
  await setGmailSyncState("hist-456");
  check("sync state upserts", (await getGmailSyncState()).history_id === "hist-456");

  // processed messages
  check("unseen message not processed", (await isMessageProcessed(M1)) === false);
  await markMessageProcessed(M1);
  check("seen message processed", (await isMessageProcessed(M1)) === true);
  await markMessageProcessed(M1); // idempotent, no throw

  // status events tied to a real application
  const app = await createAppliedJob({ company: "TestCo", jobTitle: "SWE Intern" });
  const ev = await createStatusEvent({
    applicationId: app.id, status: "assessment", source: "email",
    deadlineAt: new Date("2026-08-08T00:00:00Z"), emailMessageId: M2,
    emailSubject: "OA", emailSnippet: "complete by", emailLink: "https://mail.google.com/x",
  });
  check("status event created", ev.status === "assessment" && ev.source === "email");
  const grouped = await listStatusEventsByApplication();
  check("events grouped by application", (grouped[app.id]?.length ?? 0) >= 1);

  // review queue
  const r = await enqueueReview({ emailMessageId: M3, emailFrom: "recruiter@x.com", detectedStatus: "interviewing", matchScore: 0.4 });
  check("review enqueued", r.email_message_id === M3);
  check("pending review listed", (await listPendingReviews()).some((x) => x.id === r.id));
  check("getReview works", (await getReview(r.id))?.id === r.id);
  await resolveReview(r.id);
  check("resolved review not pending", !(await listPendingReviews()).some((x) => x.id === r.id));

  check("getAppliedJob works", (await getAppliedJob(app.id))?.id === app.id);

  await pool.end();
  console.log(pass ? "\n✓ ingest-queries test PASSED" : "\n✗ ingest-queries test FAILED");
  process.exit(pass ? 0 : 1);
}
main();
