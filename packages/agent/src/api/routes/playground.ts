import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { importMasterResume } from "../../ai/import-master-resume";
import { suggestKeywords } from "../../ai/suggest-keywords";
import { applySuggestions, labelGroundedness } from "../../ai/apply-suggestions";
import { renderMarkdown } from "../../ai/format";
import { fitToOnePage } from "../../ai/fit-page";
import { MasterResumeSchema, SuggestionSchema } from "../../ai/types";
import { fetchJd } from "../../scraper/fetch-jd";
import { hashIp, logPlaygroundUsage, countRecentPlaygroundUsage } from "../../db/queries";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const RATE_LIMIT_PER_HOUR = 10;

function clientIp(req: import("express").Request): string {
  // Railway terminates TLS at the edge and forwards the real client IP via
  // X-Forwarded-For; the web playground proxy copies that header through.
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip ?? "unknown";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Returns false after sending 429. Does not record a hit — call recordPlaygroundHit after the request is valid. */
async function checkPlaygroundRateLimit(
  req: import("express").Request,
  res: import("express").Response
): Promise<boolean> {
  const recentCount = await countRecentPlaygroundUsage(hashIp(clientIp(req)));
  if (recentCount >= RATE_LIMIT_PER_HOUR) {
    res.status(429).json({ error: "Playground rate limit reached — try again in a bit." });
    return false;
  }
  return true;
}

async function recordPlaygroundHit(req: import("express").Request): Promise<void> {
  await logPlaygroundUsage(hashIp(clientIp(req)));
}

function requireApiKey(req: import("express").Request, res: import("express").Response): string | null {
  const apiKey = (req.body as { apiKey?: string })?.apiKey;
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    res.status(400).json({ error: "An Anthropic API key is required." });
    return null;
  }
  return apiKey.trim();
}

// POST /api/playground/parse-resume — multipart (file) or JSON (text). Rate-limited entry point.
router.post("/parse-resume", upload.single("file"), async (req, res) => {
  if (!(await checkPlaygroundRateLimit(req, res))) return;

  const apiKey = requireApiKey(req, res);
  if (!apiKey) return;

  let rawText: string;
  if (req.file) {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: req.file.buffer });
      const parsed = await parser.getText({ pageJoiner: "" });
      await parser.destroy();
      rawText = parsed.text;
    } catch (err) {
      console.error("[playground] pdf text extraction failed:", err);
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
    rawText = rawText.slice(0, MAX_IMPORT_TEXT_CHARS);
  }

  await recordPlaygroundHit(req);

  try {
    const master = await importMasterResume(rawText, apiKey);
    res.json(master);
  } catch (err) {
    console.error("[playground] parse-resume failed:", err);
    res.status(502).json({ error: `Could not parse your resume: ${errorMessage(err)}` });
  }
});

// POST /api/playground/fetch-jd — no key needed, no LLM call, reuses the existing scraper.
router.post("/fetch-jd", async (req, res) => {
  if (!(await checkPlaygroundRateLimit(req, res))) return;
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }
  await recordPlaygroundHit(req);
  let result;
  try {
    result = await fetchJd(url);
  } catch (err) {
    res.status(400).json({ error: errorMessage(err), method: "failed" });
    return;
  }
  if (result.method === "failed") {
    res.status(400).json({ error: "Could not fetch job description from this URL", method: "failed" });
    return;
  }
  res.json({
    text: result.text,
    method: result.method,
    title: result.title,
    company: result.company,
    location: result.location,
  });
});

const SuggestBodySchema = z.object({
  masterResume: MasterResumeSchema,
  jd: z.string().min(1),
  apiKey: z.string().min(1),
});

// POST /api/playground/suggest
router.post("/suggest", async (req, res) => {
  if (!(await checkPlaygroundRateLimit(req, res))) return;
  const parsed = SuggestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { masterResume, jd, apiKey } = parsed.data;
  await recordPlaygroundHit(req);

  try {
    const raw = await suggestKeywords(jd, masterResume, apiKey);
    const suggestions = raw.map((s) => ({
      ...s,
      groundedness: labelGroundedness(masterResume, s),
      accepted: null as boolean | null,
    }));
    res.json({ suggestions });
  } catch (err) {
    console.error("[playground] suggest failed:", err);
    res.status(502).json({ error: `Could not generate suggestions: ${errorMessage(err)}` });
  }
});

const ApplyBodySchema = z.object({
  masterResume: MasterResumeSchema,
  accepted: z.array(SuggestionSchema),
  apiKey: z.string().min(1),
});

// POST /api/playground/apply
router.post("/apply", async (req, res) => {
  if (!(await checkPlaygroundRateLimit(req, res))) return;
  const parsed = ApplyBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const { masterResume, accepted, apiKey } = parsed.data;
  await recordPlaygroundHit(req);

  try {
    const relabeledAccepted = accepted.map((s) => ({
      ...s,
      groundedness: labelGroundedness(masterResume, s),
    }));
    const { master: adjustedMaster, tailored } = applySuggestions(masterResume, relabeledAccepted);
    let markdown = renderMarkdown(adjustedMaster, tailored);

    let pdfBase64: string | null = null;
    try {
      const fitted = await fitToOnePage(markdown, { skipWidowFix: true, apiKey });
      markdown = fitted.markdown;
      pdfBase64 = fitted.pdf.toString("base64");
    } catch (err) {
      console.error("[playground] fitToOnePage failed, returning markdown without PDF:", err);
    }

    res.json({ markdown, pdfBase64 });
  } catch (err) {
    console.error("[playground] apply failed:", err);
    res.status(502).json({ error: `Could not finalize your resume: ${errorMessage(err)}` });
  }
});

export default router;
