import { Router } from "express";
import { generateBestResume } from "../../ai/chain";
import { createTailoredResume, storePdf } from "../../db/queries";
import { fetchJd } from "../../scraper/fetch-jd";
import { renderPdf } from "../../ai/render-pdf";

const router = Router();

router.post("/", async (req, res) => {
  const { jdText, jobUrl, jobTitle, company } = req.body as {
    jdText?: string;
    jobUrl?: string;
    jobTitle?: string;
    company?: string;
  };

  let jd = jdText?.trim() ?? "";
  let fetchMethod: string | undefined;

  if (!jd && jobUrl) {
    try {
      const fetched = await fetchJd(jobUrl);
      jd = fetched.text;
      fetchMethod = fetched.method;
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
    result = await generateBestResume(jd, { jobTitle, company });
  } catch (err) {
    console.error("[tailor] pipeline error:", err);
    res.status(500).json({ error: "Tailoring failed — check OPENAI_API_KEY and try again." });
    return;
  }

  let row;
  try {
    row = await createTailoredResume({
      jobTitle,
      company,
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
    .catch((err) => console.error("[tailor] pdf render failed:", err));

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
  res.json({ text: result.text, method: result.method });
});

export default router;
