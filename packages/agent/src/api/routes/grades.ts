import { RequestHandler, Router } from "express";
import multer from "multer";
import {
  cancelGrade,
  createGrade,
  deleteGrade,
  getGrade,
  getMasterResume,
  getTailoredResume,
  listGrades,
} from "../../db/queries";
import { abortRun } from "../../ai/cancellation";
import { isUuid, parseGradeRequest } from "../../ai/grade/request";
import { MAX_GRADE_TEXT_CHARS, extractPdfText, masterToText } from "../../ai/grade/resume-text";
import { runGradePipeline } from "../../ai/grade/pipeline";

const router = Router();

// Express 4 doesn't catch a rejected async handler, and on Node 22 an unhandled
// rejection exits the process — the report page polls GET /:id every 2s, so one
// DB hiccup there would otherwise take the whole agent down.
function safe(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      console.error(`[grades] ${req.method} ${req.originalUrl} failed:`, err);
      if (!res.headersSent) res.status(500).json({ error: "Grader request failed." });
    });
  };
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// POST /api/grades — JSON for master/tailored/pasted text, multipart for a PDF upload.
// multer only touches multipart requests, so JSON bodies pass through untouched.
router.post("/", upload.single("file"), safe(async (req, res) => {
  const parsed = parseGradeRequest({ ...(req.body ?? {}), hasFile: Boolean(req.file) });
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const input = parsed.value;

  let resumeText: string;
  let label: string;
  let jdText = input.jdText;
  try {
    if (input.source === "master") {
      resumeText = masterToText(await getMasterResume());
      label = "Master resume";
    } else if (input.source === "tailored") {
      const row = await getTailoredResume(input.resumeId!);
      if (!row) { res.status(404).json({ error: "That resume no longer exists." }); return; }
      resumeText = row.markdown ?? "";
      label = [row.company, row.job_title].filter(Boolean).join(" — ") || "Tailored resume";
      if (!jdText) jdText = row.jd_text?.trim() ?? "";
    } else if (req.file) {
      try {
        resumeText = await extractPdfText(req.file.buffer);
      } catch (err) {
        console.error("[grades] pdf text extraction failed:", err);
        res.status(400).json({ error: "Could not read text from the uploaded PDF." });
        return;
      }
      label = input.label ?? (req.file.originalname || "Uploaded resume");
    } else {
      resumeText = input.text ?? "";
      label = input.label ?? "Pasted resume";
    }
  } catch (err) {
    console.error("[grades] resolving resume failed:", err);
    res.status(500).json({ error: "Could not load the resume to grade." });
    return;
  }

  resumeText = resumeText.trim();
  if (!resumeText) {
    res.status(400).json({ error: "The resume is empty — there is nothing to grade." });
    return;
  }
  if (resumeText.length > MAX_GRADE_TEXT_CHARS) {
    res.status(400).json({ error: `The resume is too long to grade (max ${MAX_GRADE_TEXT_CHARS.toLocaleString()} characters).` });
    return;
  }

  let id: string;
  try {
    ({ id } = await createGrade({
      source: input.source,
      resumeId: input.resumeId,
      label,
      resumeText,
      targetRole: input.targetRole,
      level: input.level,
      jdText: jdText || null,
    }));
  } catch (err) {
    console.error("[grades] db error:", err);
    res.status(500).json({ error: "Failed to start grading — database error." });
    return;
  }

  // Five LLM calls can outlast Railway's ~300s edge timeout; run in the background.
  res.status(202).json({ id, status: "pending" });
  runGradePipeline(id).catch((err) => console.error("[grades] background pipeline crashed:", err));
}));

// GET /api/grades[?resumeId=]
router.get("/", safe(async (req, res) => {
  const resumeId = req.query.resumeId;
  if (resumeId !== undefined && !isUuid(resumeId)) {
    res.status(400).json({ error: "resumeId must be a resume id." });
    return;
  }
  res.json(await listGrades(resumeId as string | undefined));
}));

// GET /api/grades/:id
router.get("/:id", safe(async (req, res) => {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const row = await getGrade(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
}));

// POST /api/grades/:id/cancel
router.post("/:id/cancel", safe(async (req, res) => {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const row = await getGrade(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status !== "pending") {
    res.status(409).json({ error: `Grade is ${row.status}, not running.` });
    return;
  }
  abortRun(`grade:${req.params.id}`);
  // Written here, not by the pipeline, so the page flips without waiting for a poll.
  // Also how an orphaned pending grade (process restarted) gets unstuck.
  try {
    if (!(await cancelGrade(req.params.id))) {
      const fresh = await getGrade(req.params.id);
      res.status(409).json({ error: `Grade already finished (${fresh?.status ?? "gone"}).` });
      return;
    }
  } catch (err) {
    console.error("[grades] cancel status write failed:", err);
    res.status(500).json({ error: "Cancelled the run but failed to update its status." });
    return;
  }
  res.json({ id: req.params.id, status: "cancelled" });
}));

// DELETE /api/grades/:id
router.delete("/:id", safe(async (req, res) => {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  abortRun(`grade:${req.params.id}`);
  if (!(await deleteGrade(req.params.id))) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
}));

export default router;
