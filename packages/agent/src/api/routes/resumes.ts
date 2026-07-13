import { Router } from "express";
import { Resend } from "resend";
import {
  listTailoredResumes,
  getTailoredResume,
  updateTailoredResume,
  deleteTailoredResume,
  getPdf,
  storePdf,
  setPdfError,
  getMasterResume,
} from "../../db/queries";
import { renderPdf } from "../../ai/render-pdf";
import { buildResumeFilename } from "../../utils/filename";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const router = Router();

// GET /api/resumes
router.get("/resumes", async (_req, res) => {
  const rows = await listTailoredResumes();
  res.json(rows);
});

// GET /api/resume/:id
router.get("/resume/:id", async (req, res) => {
  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// PATCH /api/resume/:id  — save editor content, re-render PDF, report render failures
router.patch("/resume/:id", async (req, res) => {
  const { markdown } = req.body as { markdown?: string };
  if (typeof markdown !== "string") {
    res.status(400).json({ error: "markdown string required" });
    return;
  }
  const updated = await updateTailoredResume(req.params.id, markdown);
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Awaited (not fire-and-forget): the editor needs to know synchronously whether the
  // edit it just saved still renders, so a broken edit surfaces immediately instead of
  // leaving a stale PDF served silently by the on-demand routes below.
  let pdfError: string | null = null;
  try {
    const pdf = await renderPdf(markdown);
    await storePdf(req.params.id, pdf);
  } catch (err) {
    pdfError = errorMessage(err);
    await setPdfError(req.params.id, pdfError);
    console.error("[resume] pdf re-render failed:", err);
  }

  res.json({ updatedAt: updated.updated_at, pdfError });
});

// DELETE /api/resume/:id
router.delete("/resume/:id", async (req, res) => {
  const deleted = await deleteTailoredResume(req.params.id);
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

// GET /api/resume/:id/pdf  — stream PDF, generate on-demand if not yet stored
router.get("/resume/:id/pdf", async (req, res) => {
  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  let pdf = await getPdf(req.params.id);
  if (!pdf) {
    try {
      pdf = await renderPdf(row.markdown);
      await storePdf(req.params.id, pdf);
    } catch (err) {
      const message = errorMessage(err);
      await setPdfError(req.params.id, message);
      console.error("[resume] on-demand pdf failed:", err);
      res.status(500).json({ error: `PDF generation failed: ${message}` });
      return;
    }
  }

  const master = await getMasterResume();
  const filename = buildResumeFilename(master.basics.name, row.company, row.job_title);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(pdf);
});

// POST /api/resume/:id/email  — email the PDF to YOUR_EMAIL
router.post("/resume/:id/email", async (req, res) => {
  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  let pdf = await getPdf(req.params.id);
  if (!pdf) {
    try {
      pdf = await renderPdf(row.markdown);
      await storePdf(req.params.id, pdf);
    } catch (err) {
      const message = errorMessage(err);
      await setPdfError(req.params.id, message);
      console.error("[resume] email pdf failed:", err);
      res.status(500).json({ error: `PDF generation failed: ${message}` });
      return;
    }
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) { res.status(500).json({ error: "RESEND_API_KEY is not configured" }); return; }
  const toEmail = process.env.YOUR_EMAIL;
  if (!toEmail) { res.status(500).json({ error: "YOUR_EMAIL is not configured" }); return; }

  const resend = new Resend(resendKey);
  const subject =
    row.job_title && row.company
      ? `${row.company} — ${row.job_title} resume`
      : "Your tailored resume";

  const master = await getMasterResume();
  const filename = buildResumeFilename(master.basics.name, row.company, row.job_title);

  const from = process.env.EMAIL_FROM ?? "Job Agent <onboarding@resend.dev>";
  await resend.emails.send({
    from,
    to: toEmail,
    subject,
    html: `<p>Tailored resume for <strong>${row.job_title ?? "this role"}</strong> at <strong>${row.company ?? "this company"}</strong>.</p>`,
    attachments: [{ filename, content: pdf }],
  });

  res.json({ sent: true });
});

export default router;
