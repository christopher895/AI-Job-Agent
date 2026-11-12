import { Router } from "express";
import multer from "multer";
import {
  createResumeProfile,
  deleteResumeProfile,
  getMasterResume,
  listResumeProfiles,
  updateMasterResume,
  updateResumeProfileMeta,
} from "../../db/queries";
import {
  DEFAULT_PROFILE_ID,
  MAX_PROFILE_NAME,
  normalizeKeywords,
  parseProfileId,
} from "../../ai/resume-profiles";
import { MasterResumeSchema } from "../../ai/types";
import { renderMasterResumePdf } from "../../ai/render-pdf";
import { countPdfPages } from "../../ai/fit-page";
import { importMasterResume } from "../../ai/import-master-resume";
import { extractPdfText } from "../../ai/grade/resume-text";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/** `?profile=<id>`; absent means the default profile, malformed is a 400. */
function profileFromQuery(q: unknown): number | null {
  if (q === undefined || q === "") return DEFAULT_PROFILE_ID;
  return parseProfileId(q);
}

// GET /api/master-resume[?profile=<id>]
router.get("/", async (req, res) => {
  const profileId = profileFromQuery(req.query.profile);
  if (profileId === null) { res.status(400).json({ error: "profile must be a profile id" }); return; }
  if (profileId !== DEFAULT_PROFILE_ID) {
    const profiles = await listResumeProfiles();
    if (!profiles.some((p) => p.id === profileId)) { res.status(404).json({ error: "Profile not found" }); return; }
  }
  const master = await getMasterResume(profileId);
  res.json(master);
});

// PUT /api/master-resume[?profile=<id>]
router.put("/", async (req, res) => {
  const profileId = profileFromQuery(req.query.profile);
  if (profileId === null) { res.status(400).json({ error: "profile must be a profile id" }); return; }
  const parsed = MasterResumeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid resume schema", details: parsed.error.flatten() });
    return;
  }
  const updated = await updateMasterResume(parsed.data, profileId);
  if (!updated) { res.status(404).json({ error: "Profile not found" }); return; }
  res.json({ updated: true });
});

// ── Resume profiles ─────────────────────────────────────────────────────────

function parseName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.trim();
  return name && name.length <= MAX_PROFILE_NAME ? name : null;
}

// GET /api/master-resume/profiles
router.get("/profiles", async (_req, res) => {
  res.json(await listResumeProfiles());
});

// POST /api/master-resume/profiles { name, keywords?, copyFrom? } — a new profile
// starting as a copy of `copyFrom` (default profile when omitted).
router.post("/profiles", async (req, res) => {
  const name = parseName(req.body?.name);
  if (!name) { res.status(400).json({ error: `name is required (max ${MAX_PROFILE_NAME} characters)` }); return; }
  const copyFrom = req.body?.copyFrom === undefined ? DEFAULT_PROFILE_ID : parseProfileId(req.body.copyFrom);
  if (copyFrom === null) { res.status(400).json({ error: "copyFrom must be a profile id" }); return; }
  const created = await createResumeProfile({ name, keywords: normalizeKeywords(req.body?.keywords), copyFrom });
  if (!created) { res.status(404).json({ error: "The profile to copy from no longer exists" }); return; }
  res.status(201).json(created);
});

// PATCH /api/master-resume/profiles/:id { name?, keywords? }
router.patch("/profiles/:id", async (req, res) => {
  const id = parseProfileId(req.params.id);
  if (id === null) { res.status(404).json({ error: "Profile not found" }); return; }
  let name: string | undefined;
  if (req.body?.name !== undefined) {
    const parsed = parseName(req.body.name);
    if (!parsed) { res.status(400).json({ error: `name must be 1–${MAX_PROFILE_NAME} characters` }); return; }
    name = parsed;
  }
  const keywords = req.body?.keywords === undefined ? undefined : normalizeKeywords(req.body.keywords);
  const updated = await updateResumeProfileMeta(id, { name, keywords });
  if (!updated) { res.status(404).json({ error: "Profile not found" }); return; }
  res.json(updated);
});

// DELETE /api/master-resume/profiles/:id — the default profile can't be deleted.
router.delete("/profiles/:id", async (req, res) => {
  const id = parseProfileId(req.params.id);
  if (id === null) { res.status(404).json({ error: "Profile not found" }); return; }
  if (id === DEFAULT_PROFILE_ID) { res.status(409).json({ error: "The main resume can't be deleted" }); return; }
  const deleted = await deleteResumeProfile(id);
  if (!deleted) { res.status(404).json({ error: "Profile not found" }); return; }
  res.status(204).end();
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
      rawText = await extractPdfText(req.file.buffer);
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
