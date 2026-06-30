import { Router } from "express";
import { createAppliedJob, listAppliedJobs, updateAppliedJob } from "../../db/queries";
import { appendRow, syncStatusToSheet } from "../../integrations/sheets";

const router = Router();

// POST /api/applied
router.post("/", async (req, res) => {
  const { company, jobTitle, location, jobUrl, status, appliedAt, resumeId } = req.body as {
    company?: string;
    jobTitle?: string;
    location?: string;
    jobUrl?: string;
    status?: string;
    appliedAt?: string;
    resumeId?: string;
  };

  if (!company || !jobTitle) {
    res.status(400).json({ error: "company and jobTitle are required" });
    return;
  }

  const row = await createAppliedJob({
    company,
    jobTitle,
    location,
    jobUrl,
    status,
    appliedAt: appliedAt ? new Date(appliedAt) : undefined,
    resumeId,
  });

  res.status(201).json(row);

  // Sync to Google Sheets in the background — don't block the response
  const appUrl = process.env.WEB_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  appendRow({
    appliedAt: row.applied_at,
    company: row.company,
    jobTitle: row.job_title,
    location: row.location,
    jobUrl: row.job_url,
    status: row.status,
    resumeLink: row.resume_id ? `${appUrl}/resume/${row.resume_id}` : "",
  })
    .then((sheetsRow) => {
      if (sheetsRow) return updateAppliedJob(row.id, { sheetsRow });
    })
    .catch((err) => console.error("[sheets] appendRow failed:", err));
});

// GET /api/applied
router.get("/", async (_req, res) => {
  const rows = await listAppliedJobs();
  res.json(rows);
});

// PATCH /api/applied/:id
router.patch("/:id", async (req, res) => {
  const { status, sheetsRow } = req.body as { status?: string; sheetsRow?: number };
  const row = await updateAppliedJob(req.params.id, { status, sheetsRow });
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);

  // Sync status change to Sheets in the background
  if (status && row.sheets_row) {
    syncStatusToSheet(row.sheets_row, status)
      .catch((err) => console.error("[sheets] syncStatus failed:", err));
  }
});

export default router;
