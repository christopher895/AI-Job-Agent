import { Router } from "express";
import { suggestKeywords } from "../../ai/suggest-keywords";
import { labelGroundedness } from "../../ai/apply-suggestions";
import { getMasterResume } from "../../db/queries";
import {
  createPendingResume,
  failTailoredResume,
  updateResumeStage,
  setSuggestions,
} from "../../db/queries";
import { fetchJd } from "../../scraper/fetch-jd";
import { LLM_PROVIDER } from "../../ai/llm";
import { Suggestion } from "../../ai/types";

const router = Router();

router.post("/", async (req, res) => {
  const { jdText, jobUrl, jobTitle, company, location } = req.body as {
    jdText?: string;
    jobUrl?: string;
    jobTitle?: string;
    company?: string;
    location?: string;
  };

  let jd = jdText?.trim() ?? "";
  let resolvedTitle = jobTitle;
  let resolvedCompany = company;
  let resolvedLocation = location;

  // JD fetching (Cheerio/Playwright, capped at 15s — see fetch-jd.ts TIMEOUT_MS) stays
  // synchronous: it's fast enough to never risk Railway's ~300s proxy timeout, and
  // keeping it here means a bad URL still surfaces inline on the /tailor form instead
  // of only after redirecting to the resume page and waiting for a poll tick.
  if (!jd && jobUrl) {
    try {
      const fetched = await fetchJd(jobUrl);
      jd = fetched.text;
      resolvedTitle = resolvedTitle || fetched.title;
      resolvedCompany = resolvedCompany || fetched.company;
      resolvedLocation = resolvedLocation || fetched.location;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid URL";
      res.status(400).json({ error: message });
      return;
    }
  }

  if (!jd) {
    res.status(400).json({ error: "No job description available — paste the JD text manually." });
    return;
  }

  let row;
  try {
    row = await createPendingResume({
      jobTitle: resolvedTitle,
      company: resolvedCompany,
      location: resolvedLocation,
      jobUrl,
      jdText: jd,
    });
  } catch (err) {
    console.error("[tailor] db error:", err);
    res.status(500).json({ error: "Failed to start tailoring — database error." });
    return;
  }

  // The suggestion pipeline (single LLM call to suggestKeywords) moves to the
  // background: even one call can run past Railway's ~300s edge-proxy timeout,
  // which kills a synchronous request outright and shows up in the browser as a
  // generic "Failed to fetch". The frontend polls GET /api/resume/:id and
  // switches out of the pending state once it flips.
  res.status(202).json({ id: row.id, status: "pending" });

  runSuggestPipeline(row.id, jd).catch((err) => {
    console.error("[tailor] background pipeline crashed:", err);
  });
});

async function runSuggestPipeline(id: string, jd: string) {
  try {
    await updateResumeStage(id, "Analyzing job description");
    const master = await getMasterResume();
    const raw = await suggestKeywords(jd, master);
    const suggestions: Suggestion[] = raw.map((s) => ({
      ...s,
      groundedness: labelGroundedness(master, s),
      accepted: null,
    }));
    await setSuggestions(id, suggestions);
  } catch (err) {
    console.error("[tailor] suggestion pipeline error:", err);
    const credentialHint =
      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    await failTailoredResume(id, `Generating suggestions failed — ${credentialHint} and try again.`);
  }
}

// POST /api/tailor/fetch-jd — just fetch the JD text without running the tailor pipeline
router.post("/fetch-jd", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ error: "url is required" }); return; }
  let result;
  try {
    result = await fetchJd(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid URL";
    res.status(400).json({ error: message, method: "failed" });
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

export default router;
