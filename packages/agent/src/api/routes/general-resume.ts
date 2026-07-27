import { Router } from "express";
import {
  getGeneralResume,
  upsertPendingGeneralResume,
  completeTailoredResume,
  failTailoredResume,
  storePdf,
  setPdfError,
} from "../../db/queries";
import { generateGeneralResume } from "../../ai/general-resume";
import { LLM_PROVIDER } from "../../ai/llm";

const router = Router();

// GET /api/general-resume
router.get("/", async (_req, res) => {
  const row = await getGeneralResume();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

// POST /api/general-resume/generate — (re)generate the singleton general
// resume from the current saved Master Resume. Same async shape as
// POST /api/tailor: the generate->critique->revise loop plus the one-page
// fit pass routinely run past Railway's ~300s edge-proxy timeout.
router.post("/generate", async (_req, res) => {
  let row;
  try {
    row = await upsertPendingGeneralResume();
  } catch (err) {
    console.error("[general-resume] db error:", err);
    res.status(500).json({ error: "Failed to start generation — database error." });
    return;
  }

  res.status(202).json({ id: row.id, status: "pending" });

  runGeneralResumePipeline(row.id).catch((err) => {
    console.error("[general-resume] background pipeline crashed:", err);
  });
});

async function runGeneralResumePipeline(id: string) {
  let result;
  try {
    result = await generateGeneralResume();
  } catch (err) {
    console.error("[general-resume] pipeline error:", err);
    const credentialHint =
      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    await failTailoredResume(id, `Generation failed — ${credentialHint} and try again.`);
    return;
  }

  try {
    await completeTailoredResume(id, { markdown: result.markdown, criticScore: result.criticScore });
  } catch (err) {
    console.error("[general-resume] db error saving result:", err);
    await failTailoredResume(id, "Failed to save resume — database error.").catch(() => {});
    return;
  }

  try {
    await storePdf(id, result.pdf);
  } catch (err) {
    console.error("[general-resume] pdf store failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    await setPdfError(id, message).catch(() => {});
  }
}

export default router;
