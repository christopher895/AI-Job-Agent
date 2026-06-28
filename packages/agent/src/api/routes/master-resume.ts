import { Router } from "express";
import { getMasterResume, updateMasterResume } from "../../db/queries";
import { MasterResumeSchema } from "../../ai/types";
import { renderMasterResumePdf } from "../../ai/render-pdf";

const router = Router();

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
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="master-resume.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error("[master-resume] preview pdf failed:", err);
    res.status(500).json({ error: "PDF generation failed" });
  }
});

export default router;
