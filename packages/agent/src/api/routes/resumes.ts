import { Router } from "express";
import { Resend } from "resend";
import {
  listTailoredResumes,
  getTailoredResume,
  updateTailoredResume,
  getPdf,
  storePdf,
} from "../../db/queries";
import { renderPdf } from "../../ai/render-pdf";

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

// PATCH /api/resume/:id  — save editor content, re-render PDF in background
router.patch("/resume/:id", async (req, res) => {
  const { markdown } = req.body as { markdown?: string };
  if (typeof markdown !== "string") {
    res.status(400).json({ error: "markdown string required" });
    return;
  }
  const updated = await updateTailoredResume(req.params.id, markdown);
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  renderPdf(markdown)
    .then((pdf) => storePdf(req.params.id, pdf))
    .catch((err) => console.error("[resume] pdf re-render failed:", err));

  res.json({ updatedAt: updated.updated_at });
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
      console.error("[resume] on-demand pdf failed:", err);
      res.status(500).json({ error: "PDF generation failed" });
      return;
    }
  }

  const slug = [row.company, row.job_title]
    .filter(Boolean)
    .join("-")
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase() || "resume";

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}.pdf"`);
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
      console.error("[resume] email pdf failed:", err);
      res.status(500).json({ error: "PDF generation failed" });
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

  const from = process.env.EMAIL_FROM ?? "Job Agent <onboarding@resend.dev>";
  await resend.emails.send({
    from,
    to: toEmail,
    subject,
    html: `<p>Tailored resume for <strong>${row.job_title ?? "this role"}</strong> at <strong>${row.company ?? "this company"}</strong>.</p>`,
    attachments: [{ filename: `${subject}.pdf`, content: pdf }],
  });

  res.json({ sent: true });
});

export default router;
