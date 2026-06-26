import { Router } from "express";
import { getMasterResume, updateMasterResume } from "../../db/queries";
import { MasterResumeSchema } from "../../ai/types";

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

export default router;
