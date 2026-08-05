import { Router } from "express";
import {
  listPendingReviews, getReview, resolveReview, getAppliedJob, createStatusEvent, updateAppliedJob,
} from "../../db/queries";
import { canAdvance } from "../../ingest/status-order";
import { NOTIFY_STATUSES } from "../../ingest/email-ingest";
import { sendStatusChangeEmail } from "../../notifications/email";
import { syncStatusToSheet } from "../../integrations/sheets";

const router = Router();

// GET /api/review — unresolved items
router.get("/", async (_req, res) => {
  res.json(await listPendingReviews());
});

// POST /api/review/:id/confirm { applicationId }
router.post("/:id/confirm", async (req, res) => {
  const { applicationId } = req.body as { applicationId?: string };
  if (!applicationId) { res.status(400).json({ error: "applicationId is required" }); return; }

  const review = await getReview(req.params.id);
  if (!review || review.resolved_at) { res.status(404).json({ error: "Review not found or already resolved" }); return; }
  const app = await getAppliedJob(applicationId);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }

  const status = review.detected_status ?? "applied";
  const event = await createStatusEvent({
    applicationId: app.id, status, source: "email",
    deadlineAt: review.detected_deadline_at,
    emailMessageId: review.email_message_id, emailSubject: review.email_subject,
    emailSnippet: review.email_snippet, emailLink: review.email_link,
  });

  if (canAdvance(app.status, status)) {
    await updateAppliedJob(app.id, { status });
    if (app.sheets_row) await syncStatusToSheet(app.sheets_row, status).catch((e) => console.error("[review] sheets:", e));
    if (NOTIFY_STATUSES.has(status)) {
      await sendStatusChangeEmail(
        { company: app.company, job_title: app.job_title, id: app.id },
        { status, deadline_at: event.deadline_at, email_link: event.email_link, email_snippet: event.email_snippet }
      ).catch((e) => console.error("[review] notify:", e));
    }
  }
  await resolveReview(review.id);
  res.json({ ok: true });
});

// POST /api/review/:id/dismiss
router.post("/:id/dismiss", async (req, res) => {
  const review = await getReview(req.params.id);
  if (!review) { res.status(404).json({ error: "Review not found" }); return; }
  await resolveReview(review.id);
  res.json({ ok: true });
});

export default router;
