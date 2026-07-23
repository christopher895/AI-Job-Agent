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

/** Rejects with 409 unless the resume finished tailoring; shared by /pdf and /email. */
function requireReady(row: { status: string }, res: import("express").Response): boolean {
  if (row.status !== "ready") {
    res.status(409).json({ error: `Resume is still ${row.status === "pending" ? "generating" : "in an error state"} — no PDF yet.` });
    return false;
  }
  return true;
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

// PATCH /api/resume/:id  — save editor content and/or rename (job title / company), re-render PDF on markdown changes
router.patch("/resume/:id", async (req, res) => {
  const { markdown, jobTitle, company } = req.body as {
    markdown?: string;
    jobTitle?: string;
    company?: string;
  };
  if (markdown !== undefined && typeof markdown !== "string") {
    res.status(400).json({ error: "markdown must be a string" });
    return;
  }
  if (jobTitle !== undefined && typeof jobTitle !== "string") {
    res.status(400).json({ error: "jobTitle must be a string" });
    return;
  }
  if (company !== undefined && typeof company !== "string") {
    res.status(400).json({ error: "company must be a string" });
    return;
  }
  if (markdown === undefined && jobTitle === undefined && company === undefined) {
    res.status(400).json({ error: "markdown, jobTitle, or company required" });
    return;
  }

  const existing = await getTailoredResume(req.params.id);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status === "pending") {
    // The background tailoring pipeline (see routes/tailor.ts) will overwrite markdown
    // unconditionally once it finishes, so an edit saved here would be silently lost.
    res.status(409).json({ error: "Resume is still generating — try again once it's ready." });
    return;
  }

  const updated = await updateTailoredResume(req.params.id, { markdown, jobTitle, company });
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Awaited (not fire-and-forget): the editor needs to know synchronously whether the
  // edit it just saved still renders, so a broken edit surfaces immediately instead of
  // leaving a stale PDF served silently by the on-demand routes below. Only markdown
  // changes affect the rendered PDF, so a rename alone skips re-rendering.
  let pdfError: string | null = null;
  if (markdown !== undefined) {
    try {
      const pdf = await renderPdf(markdown);
      await storePdf(req.params.id, pdf);
    } catch (err) {
      pdfError = errorMessage(err);
      await setPdfError(req.params.id, pdfError);
      console.error("[resume] pdf re-render failed:", err);
    }
  }

  res.json({
    updatedAt: updated.updated_at,
    pdfError,
    jobTitle: updated.job_title,
    company: updated.company,
  });
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
  if (!requireReady(row, res)) return;

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
  if (!requireReady(row, res)) return;

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
