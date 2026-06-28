import { Router } from "express";
import { getPreferences, updatePreferences } from "../../db/queries";
import { Preferences } from "../../config";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const prefs = await getPreferences();
    res.json(prefs);
  } catch (err) {
    console.error("[preferences] GET failed:", err);
    res.status(500).json({ error: "Failed to load preferences" });
  }
});

router.put("/", async (req, res) => {
  try {
    const body = req.body as Preferences;
    if (
      !Array.isArray(body.titleKeywords) ||
      !Array.isArray(body.requiredKeywords) ||
      !Array.isArray(body.targetLocations) ||
      !Array.isArray(body.priorityCompanies) ||
      typeof body.maxPerEmail !== "number"
    ) {
      res.status(400).json({ error: "Invalid preferences shape" });
      return;
    }
    await updatePreferences(body);
    res.json({ updated: true });
  } catch (err) {
    console.error("[preferences] PUT failed:", err);
    res.status(500).json({ error: "Failed to save preferences" });
  }
});

export default router;
