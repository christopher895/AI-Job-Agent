import { Router } from "express";
import { generateBestResume } from "../../ai/chain";
import { createTailoredResume, storePdf, setPdfError } from "../../db/queries";
import { fetchJd } from "../../scraper/fetch-jd";
import { renderPdf } from "../../ai/render-pdf";
import { LLM_PROVIDER } from "../../ai/llm";

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
  let fetchMethod: string | undefined;
  let resolvedTitle = jobTitle;
  let resolvedCompany = company;
  let resolvedLocation = location;

  if (!jd && jobUrl) {
    try {
      const fetched = await fetchJd(jobUrl);
      jd = fetched.text;
      fetchMethod = fetched.method;
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
    res.status(400).json({
      error: "No job description available — paste the JD text manually.",
      fetchMethod,
    });
    return;
  }

  let result;
  try {
    result = await generateBestResume(jd, { jobTitle: resolvedTitle, company: resolvedCompany });
  } catch (err) {
    console.error("[tailor] pipeline error:", err);
    const credentialHint =
      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    res.status(500).json({ error: `Tailoring failed — ${credentialHint} and try again.` });
    return;
  }

  let row;
  try {
    row = await createTailoredResume({
      jobTitle: resolvedTitle,
      company: resolvedCompany,
      location: resolvedLocation,
      jobUrl,
      jdText: jd,
      markdown: result.markdown,
      criticScore: result.critic.finalScore,
    });
  } catch (err) {
    console.error("[tailor] db error:", err);
    res.status(500).json({ error: "Failed to save resume — database error." });
    return;
  }

  // Render PDF in the background — /pdf endpoint generates on-demand if not ready yet
  renderPdf(result.markdown)
    .then((pdf) => storePdf(row.id, pdf))
    .catch((err) => {
      console.error("[tailor] pdf render failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      setPdfError(row.id, message).catch(() => {});
    });

  res.json({ id: row.id, markdown: result.markdown, criticScore: result.critic.finalScore, fetchMethod });
});

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
  res.json({ text: result.text, method: result.method, title: result.title, company: result.company });
});

export default router;
