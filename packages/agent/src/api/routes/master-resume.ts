import { Router } from "express";
import multer from "multer";
import { getMasterResume, updateMasterResume } from "../../db/queries";
import { MasterResumeSchema } from "../../ai/types";
import { renderMasterResumePdf } from "../../ai/render-pdf";
import { countPdfPages } from "../../ai/fit-page";
import { importMasterResume } from "../../ai/import-master-resume";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/master-resume
router.get("/", async (_req, res) => {
  const master = await getMasterResume();
  res.json(master);
});

// PUT /api/master-resume
router.put("/", async (req, res) => {
  const parsed = MasterResumeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid resume schema", details: parsed.error.flatten() });
    return;
  }
  await updateMasterResume(parsed.data);
  res.json({ updated: true });
});

// POST /api/master-resume/preview-pdf  — compile current form state (may be unsaved)
router.post("/preview-pdf", async (req, res) => {
  const parsed = MasterResumeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid resume schema" });
    return;
  }
  try {
    const pdf = await renderMasterResumePdf(parsed.data);
    const pages = await countPdfPages(pdf);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="master-resume.pdf"');
    res.setHeader("X-Page-Count", String(pages));
    res.send(pdf);
  } catch (err) {
    console.error("[master-resume] preview pdf failed:", err);
    res.status(500).json({ error: "PDF generation failed" });
  }
});

// POST /api/master-resume/import — parses pasted text or an uploaded PDF into a
// MasterResume. Never writes to the DB; the frontend holds the result as unsaved
// form state, same as any other in-form edit, until PUT /api/master-resume is called.
router.post("/import", upload.single("file"), async (req, res) => {
  let rawText: string;

  if (req.file) {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: req.file.buffer });
      const parsed = await parser.getText({ pageJoiner: "" });
      await parser.destroy();
      rawText = parsed.text;
    } catch (err) {
      console.error("[master-resume] pdf text extraction failed:", err);
      res.status(400).json({ error: "Could not read text from the uploaded PDF." });
      return;
    }
  } else if (typeof req.body?.text === "string" && req.body.text.trim()) {
    rawText = req.body.text;
  } else {
    res.status(400).json({ error: "Provide resume text or upload a PDF file." });
    return;
  }

  if (!rawText.trim()) {
    res.status(400).json({ error: "No text could be extracted — try pasting plain text instead." });
    return;
  }

  const MAX_IMPORT_TEXT_CHARS = 60_000;
  if (rawText.length > MAX_IMPORT_TEXT_CHARS) {
    console.warn(`[master-resume] import text truncated from ${rawText.length} to ${MAX_IMPORT_TEXT_CHARS} chars`);
    rawText = rawText.slice(0, MAX_IMPORT_TEXT_CHARS);
  }

  try {
    const master = await importMasterResume(rawText);
    res.json(master);
  } catch (err) {
    console.error("[master-resume] import failed:", err);
    res.status(500).json({ error: "Could not parse the resume — try pasting plain text instead." });
  }
});

export default router;
