import { Router } from "express";
import { Resend } from "resend";
import {
  listTailoredResumes,
  getTailoredResume,
  updateTailoredResume,
  deleteTailoredResume,
  getPdf,
  storePdf,
  setPdfError,
  getMasterResume,
  beginApplyingSuggestions,
  completeTailoredResume,
  failTailoredResume,
  updateResumeStage,
  cancelResumeGeneration,
  revertToAwaitingReview,
  restartSuggestions,
} from "../../db/queries";
import { registerRun, clearRun, abortRun, isCancelledError, CancelledError } from "../../ai/cancellation";
import { runSuggestPipeline } from "./tailor";
import { renderPdf } from "../../ai/render-pdf";
import { renderMarkdown } from "../../ai/format";
import { fitToOnePage } from "../../ai/fit-page";
import { applySuggestions, labelGroundedness } from "../../ai/apply-suggestions";
import { Suggestion, SuggestionSchema } from "../../ai/types";
import { LLM_PROVIDER } from "../../ai/llm";
import { buildResumeFilename } from "../../utils/filename";
import { z } from "zod";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Rejects with 409 unless the resume finished tailoring; shared by /pdf and /email. */
function requireReady(row: { status: string }, res: import("express").Response): boolean {
  if (row.status !== "ready") {
    const reason =
      row.status === "pending" ? "generating" :
      row.status === "awaiting_review" ? "awaiting your review" :
      "in an error state";
    res.status(409).json({ error: `Resume is still ${reason} — no PDF yet.` });
    return false;
  }
  return true;
}

const router = Router();

// GET /api/resumes
router.get("/resumes", async (_req, res) => {
  const rows = await listTailoredResumes();
  res.json(rows);
});

// GET /api/resume/:id
router.get("/resume/:id", async (req, res) => {
  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// PATCH /api/resume/:id  — save editor content and/or rename (job title / company), re-render PDF on markdown changes
router.patch("/resume/:id", async (req, res) => {
  const { markdown, jobTitle, company } = req.body as {
    markdown?: string;
    jobTitle?: string;
    company?: string;
  };
  if (markdown !== undefined && typeof markdown !== "string") {
    res.status(400).json({ error: "markdown must be a string" });
    return;
  }
  if (jobTitle !== undefined && typeof jobTitle !== "string") {
    res.status(400).json({ error: "jobTitle must be a string" });
    return;
  }
  if (company !== undefined && typeof company !== "string") {
    res.status(400).json({ error: "company must be a string" });
    return;
  }
  if (markdown === undefined && jobTitle === undefined && company === undefined) {
    res.status(400).json({ error: "markdown, jobTitle, or company required" });
    return;
  }

  const existing = await getTailoredResume(req.params.id);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status === "pending") {
    // The background tailoring pipeline (see routes/tailor.ts) will overwrite markdown
    // unconditionally once it finishes, so an edit saved here would be silently lost.
    res.status(409).json({ error: "Resume is still generating — try again once it's ready." });
    return;
  }

  const updated = await updateTailoredResume(req.params.id, { markdown, jobTitle, company });
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Awaited (not fire-and-forget): the editor needs to know synchronously whether the
  // edit it just saved still renders, so a broken edit surfaces immediately instead of
  // leaving a stale PDF served silently by the on-demand routes below. Only markdown
  // changes affect the rendered PDF, so a rename alone skips re-rendering.
  let pdfError: string | null = null;
  if (markdown !== undefined) {
    try {
      const pdf = await renderPdf(markdown);
      await storePdf(req.params.id, pdf);
    } catch (err) {
      pdfError = errorMessage(err);
      await setPdfError(req.params.id, pdfError);
      console.error("[resume] pdf re-render failed:", err);
    }
  }

  res.json({
    updatedAt: updated.updated_at,
    pdfError,
    jobTitle: updated.job_title,
    company: updated.company,
  });
});

// POST /api/resume/:id/apply-suggestions — applies the accepted suggestions
// from the awaiting_review checklist and produces the final one-page resume.
// Same async shape as POST /api/tailor: responds immediately, runs in the
// background, and reuses the existing pending/polling UI.
router.post("/resume/:id/apply-suggestions", async (req, res) => {
  const parsed = z.array(SuggestionSchema).safeParse(req.body?.accepted);
  if (!parsed.success) {
    res.status(400).json({ error: "accepted must be an array of valid suggestions" });
    return;
  }
  const accepted = parsed.data;

  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status !== "awaiting_review") {
    res.status(409).json({ error: `Resume is ${row.status}, not awaiting review.` });
    return;
  }

  await beginApplyingSuggestions(req.params.id);
  res.status(202).json({ id: req.params.id, status: "pending" });

  runApplyPipeline(req.params.id, accepted, row.suggestions ?? []).catch((err) => {
    console.error("[resume] apply-suggestions pipeline crashed:", err);
  });
});

async function runApplyPipeline(id: string, accepted: Suggestion[], originalSuggestions: Suggestion[]) {
  const signal = registerRun(id);
  try {
    await updateResumeStage(id, "Applying your selections");
    const master = await getMasterResume();

    // Re-label groundedness against the FINAL text — a user's hand-edit can
    // turn a "grounded" suggestion into an "extrapolated" one (or vice versa);
    // the stored label must reflect what was actually applied, not what the
    // model originally proposed.
    const relabeledAccepted = accepted.map((s) => ({
      ...s,
      groundedness: labelGroundedness(master, s),
    }));

    const { master: adjustedMaster, tailored } = applySuggestions(master, relabeledAccepted);
    let markdown = renderMarkdown(adjustedMaster, tailored);

    if (signal.aborted) throw new CancelledError();
    await updateResumeStage(id, "Finalizing formatting");
    let pdf: Buffer | null = null;
    try {
      const fitted = await fitToOnePage(markdown, { skipWidowFix: true, signal });
      markdown = fitted.markdown;
      pdf = fitted.pdf;
    } catch (err) {
      // A cancel must abort the run, not silently degrade to un-fitted output.
      if (isCancelledError(err) || signal.aborted) throw err;
      console.error("[resume] fitToOnePage failed, continuing with un-fitted markdown:", err);
    }

    // Preserve the full suggestion set for audit: accepted ones with their
    // final (possibly edited, re-labeled) state; everything the model
    // proposed but the user did NOT check gets accepted: false, not dropped.
    const finalSuggestions = originalSuggestions.map((orig) => {
      const applied = relabeledAccepted.find((s) => s.id === orig.id);
      return applied ? { ...applied, accepted: true } : { ...orig, accepted: false };
    });

    // Last checkpoint before the run becomes irreversible: past this write the
    // row is 'ready' and a cancel would have nothing left to undo.
    if (signal.aborted) throw new CancelledError();
    await completeTailoredResume(id, { markdown, suggestions: finalSuggestions });

    if (pdf) {
      await storePdf(id, pdf).catch((err) => {
        console.error("[resume] pdf store failed:", err);
        setPdfError(id, errorMessage(err)).catch(() => {});
      });
    } else {
      try {
        const rendered = await renderPdf(markdown);
        await storePdf(id, rendered);
      } catch (err) {
        console.error("[resume] pdf render failed:", err);
        await setPdfError(id, errorMessage(err));
      }
    }
  } catch (err) {
    // POST /api/resume/:id/cancel already put the row back to 'awaiting_review';
    // writing 'failed' here would clobber it and lose the review checklist.
    if (isCancelledError(err) || signal.aborted) {
      console.log(`[resume] apply-suggestions pipeline cancelled for ${id}`);
      return;
    }
    console.error("[resume] apply-suggestions pipeline error:", err);
    const credentialHint =
      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    await failTailoredResume(id, `Applying suggestions failed — ${credentialHint} and try again.`);
  } finally {
    clearRun(id);
  }
}

// POST /api/resume/:id/cancel — stops an in-flight generation.
//
// Kills the run (aborting the spawned `claude` subprocess, not just discarding
// its output) and writes the resulting status here rather than leaving it to
// the pipeline, so the editor flips immediately instead of waiting a poll tick.
// Where the row lands depends on which pipeline was running, which
// `suggestions` identifies: setSuggestions() is the only thing that populates
// it, so a null means the first (suggestion) pass and a non-null means the
// apply pass — the latter goes back to awaiting_review with the user's
// checklist intact.
router.post("/resume/:id/cancel", async (req, res) => {
  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status !== "pending") {
    res.status(409).json({ error: `Resume is ${row.status}, not generating.` });
    return;
  }

  abortRun(req.params.id);

  const wasApplying = row.suggestions != null;
  try {
    const updated = wasApplying
      ? await revertToAwaitingReview(req.params.id)
      : await cancelResumeGeneration(req.params.id);

    if (!updated) {
      // The run finished in the gap between the read above and this write — its
      // real result stands rather than being overwritten with a cancel.
      const fresh = await getTailoredResume(req.params.id);
      res.status(409).json({ error: `Generation already finished (${fresh?.status ?? "gone"}).` });
      return;
    }
  } catch (err) {
    // The run is already aborted at this point, so a failed status write leaves
    // the row stuck at 'pending'. Report it instead of letting the rejection go
    // unhandled and take the whole API process down.
    console.error("[resume] cancel status write failed:", err);
    res.status(500).json({ error: `Cancelled the run but failed to update its status: ${errorMessage(err)}` });
    return;
  }

  res.json({ id: req.params.id, status: wasApplying ? "awaiting_review" : "cancelled" });
});

// POST /api/resume/:id/retry — re-runs the suggestion pass on a cancelled or
// failed row, reusing the jd_text already stored on it so the JD never has to
// be re-fetched or re-pasted.
router.post("/resume/:id/retry", async (req, res) => {
  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status !== "cancelled" && row.status !== "failed") {
    res.status(409).json({ error: `Resume is ${row.status} — nothing to retry.` });
    return;
  }
  if (!row.jd_text) {
    res.status(409).json({ error: "This resume has no stored job description — start a new one from /tailor." });
    return;
  }

  let restarted: boolean;
  try {
    restarted = await restartSuggestions(req.params.id);
  } catch (err) {
    console.error("[resume] retry status write failed:", err);
    res.status(500).json({ error: `Could not restart generation: ${errorMessage(err)}` });
    return;
  }
  if (!restarted) { res.status(409).json({ error: "Resume is no longer retryable." }); return; }

  res.status(202).json({ id: req.params.id, status: "pending" });

  runSuggestPipeline(req.params.id, row.jd_text).catch((err) => {
    console.error("[resume] retry pipeline crashed:", err);
  });
});

// DELETE /api/resume/:id
router.delete("/resume/:id", async (req, res) => {
  const deleted = await deleteTailoredResume(req.params.id);
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

// GET /api/resume/:id/pdf  — stream PDF, generate on-demand if not yet stored
router.get("/resume/:id/pdf", async (req, res) => {
  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!requireReady(row, res)) return;

  let pdf = await getPdf(req.params.id);
  if (!pdf) {
    try {
      pdf = await renderPdf(row.markdown);
      await storePdf(req.params.id, pdf);
    } catch (err) {
      const message = errorMessage(err);
      await setPdfError(req.params.id, message);
      console.error("[resume] on-demand pdf failed:", err);
      res.status(500).json({ error: `PDF generation failed: ${message}` });
      return;
    }
  }

  const master = await getMasterResume();
  const filename = buildResumeFilename(master.basics.name, row.company, row.job_title);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(pdf);
});

// POST /api/resume/:id/email  — email the PDF to YOUR_EMAIL
router.post("/resume/:id/email", async (req, res) => {
  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!requireReady(row, res)) return;

  let pdf = await getPdf(req.params.id);
  if (!pdf) {
    try {
      pdf = await renderPdf(row.markdown);
      await storePdf(req.params.id, pdf);
    } catch (err) {
      const message = errorMessage(err);
      await setPdfError(req.params.id, message);
      console.error("[resume] email pdf failed:", err);
      res.status(500).json({ error: `PDF generation failed: ${message}` });
      return;
    }
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) { res.status(500).json({ error: "RESEND_API_KEY is not configured" }); return; }
  const toEmail = process.env.YOUR_EMAIL;
  if (!toEmail) { res.status(500).json({ error: "YOUR_EMAIL is not configured" }); return; }

  const resend = new Resend(resendKey);
  const subject =
    row.job_title && row.company
      ? `${row.company} — ${row.job_title} resume`
      : "Your tailored resume";

  const master = await getMasterResume();
  const filename = buildResumeFilename(master.basics.name, row.company, row.job_title);

  const from = process.env.EMAIL_FROM ?? "Job Agent <onboarding@resend.dev>";
  await resend.emails.send({
    from,
    to: toEmail,
    subject,
    html: `<p>Tailored resume for <strong>${row.job_title ?? "this role"}</strong> at <strong>${row.company ?? "this company"}</strong>.</p>`,
    attachments: [{ filename, content: pdf }],
  });

  res.json({ sent: true });
});

export default router;
