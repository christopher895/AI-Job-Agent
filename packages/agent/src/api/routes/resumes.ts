import { Router } from "express";
import { Resend } from "resend";
import {
  listTailoredResumes,
  getTailoredResume,
  updateTailoredResume,
  deleteTailoredResume,
  duplicateTailoredResume,
  getPdf,
  storePdf,
  setPdfError,
  getMasterResume,
  beginApplyingSuggestions,
  completeTailoredResume,
  updateResumeStage,
  cancelResumeGeneration,
  revertToAwaitingReview,
  revertToReady,
  beginFeedbackRound,
  restartSuggestions,
  beginGeneratingAnswers,
  updateApplicationAnswerItems,
  setSuggestions,
  clearResumeError,
} from "../../db/queries";
import { registerRun, clearRun, abortRun, isCancelledError, CancelledError } from "../../ai/cancellation";
import { runSuggestPipeline } from "./tailor";
import { renderPdf } from "../../ai/render-pdf";
import { renderMarkdown } from "../../ai/format";
import { fitToOnePage } from "../../ai/fit-page";
import { applySuggestions, labelGroundedness } from "../../ai/apply-suggestions";
import { suggestFromFeedback, currentMaster } from "../../ai/suggest-from-feedback";
import { FEEDBACK_STAGE, appendBatch, composeAccepted } from "../../ai/suggestion-rounds";
import { MAX_PASTE_CHARS } from "../../ai/generate-answers";
import { runAnswersPipeline } from "../../ai/answers-pipeline";
import { ApplicationAnswerSchema, Suggestion, SuggestionSchema } from "../../ai/types";
import { LLM_PROVIDER } from "../../ai/llm";
import { buildResumeFilename } from "../../utils/filename";
import { escapeHtml } from "../../notifications/email";
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

  // The apply pass regenerates from the master resume, so suggestions accepted
  // in an earlier round (a feedback round builds on the JD round) must be
  // re-applied alongside this round's picks or they would silently vanish.
  const stored = row.suggestions ?? [];
  runApplyPipeline(req.params.id, composeAccepted(stored, accepted), stored).catch((err) => {
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
    // model originally proposed. Items from earlier rounds are judged against
    // the raw master, as they were originally; this round's items against the
    // résumé those earlier rounds produced — the text the model actually saw.
    const priorAccepted = originalSuggestions.filter((s) => s.accepted === true);
    const priorIds = new Set(priorAccepted.map((s) => s.id));
    const priorMaster = priorAccepted.length ? currentMaster(master, priorAccepted) : master;
    const relabeledAccepted = accepted.map((s) => ({
      ...s,
      groundedness: labelGroundedness(priorIds.has(s.id) ? master : priorMaster, s),
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
    // writing anything else here would clobber it.
    if (isCancelledError(err) || signal.aborted) {
      console.log(`[resume] apply-suggestions pipeline cancelled for ${id}`);
      return;
    }
    console.error("[resume] apply-suggestions pipeline error:", err);
    const credentialHint =
      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    // Back to the checklist with the error, not to 'failed': the checklist is
    // the user's work, and 'failed' only offers a retry of the JD pass, which
    // replaces the whole suggestion set (and every earlier round's decisions).
    await revertToAwaitingReview(id, `Applying suggestions failed — ${credentialHint} and try again.`);
  } finally {
    clearRun(id);
  }
}

// POST /api/resume/:id/cancel — stops an in-flight generation.
//
// Kills the run (aborting the spawned `claude` subprocess, not just discarding
// its output) and writes the resulting status here rather than leaving it to
// the pipeline, so the editor flips immediately instead of waiting a poll tick.
// Where the row lands depends on which pipeline was running:
//   - stage = FEEDBACK_STAGE      → a feedback round; back to 'ready', where
//                                   the finished resume is untouched
//   - suggestions IS NULL         → the first (JD suggestion) pass; 'cancelled'
//   - suggestions NOT NULL        → the apply pass; back to 'awaiting_review'
//                                   with the user's checklist intact
// The stage check comes first because a feedback round also runs with
// suggestions set (from the rounds before it).
router.post("/resume/:id/cancel", async (req, res) => {
  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status !== "pending") {
    res.status(409).json({ error: `Resume is ${row.status}, not generating.` });
    return;
  }

  abortRun(req.params.id);

  const wasFeedbackRound = row.stage === FEEDBACK_STAGE;
  const wasApplying = !wasFeedbackRound && row.suggestions != null;
  try {
    const updated = wasFeedbackRound
      ? await revertToReady(req.params.id)
      : wasApplying
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

  res.json({
    id: req.params.id,
    status: wasFeedbackRound ? "ready" : wasApplying ? "awaiting_review" : "cancelled",
  });
});

// POST /api/resume/:id/feedback — starts a new suggestion round on a finished
// resume from pasted free-form feedback (a reviewer's notes, a recruiter's
// nitpicks). Same async shape as POST /api/tailor: 202 now, background LLM
// call, and the row lands at awaiting_review with the new batch appended as
// undecided items — the editor's existing polling and checklist take it from
// there. Only allowed from 'ready'.
router.post("/resume/:id/feedback", async (req, res) => {
  const feedback = typeof req.body?.feedback === "string" ? req.body.feedback.trim() : "";
  if (!feedback) { res.status(400).json({ error: "feedback must be a non-empty string" }); return; }
  if (feedback.length > MAX_PASTE_CHARS) {
    res.status(400).json({ error: `feedback is too long (max ${MAX_PASTE_CHARS} characters)` });
    return;
  }

  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status !== "ready") {
    res.status(409).json({ error: `Resume is ${row.status} — feedback can only be applied to a finished resume.` });
    return;
  }

  let started: boolean;
  try {
    started = await beginFeedbackRound(req.params.id, FEEDBACK_STAGE);
  } catch (err) {
    console.error("[resume] feedback status write failed:", err);
    res.status(500).json({ error: `Could not start the feedback round: ${errorMessage(err)}` });
    return;
  }
  if (!started) { res.status(409).json({ error: "Resume is no longer ready — another run may have started." }); return; }

  res.status(202).json({ id: req.params.id, status: "pending" });

  runFeedbackPipeline(req.params.id, feedback, row.jd_text, row.suggestions ?? []).catch((err) => {
    console.error("[resume] feedback pipeline crashed:", err);
  });
});

// POST /api/resume/:id/clear-error — dismisses the notice a failed or empty
// feedback round (or a failed apply pass) left on the row.
router.post("/resume/:id/clear-error", async (req, res) => {
  const cleared = await clearResumeError(req.params.id);
  if (!cleared) { res.status(409).json({ error: "Nothing to clear on this resume." }); return; }
  res.json({ id: req.params.id, error: null });
});

async function runFeedbackPipeline(id: string, feedback: string, jd: string | null, stored: Suggestion[]) {
  const signal = registerRun(id);
  try {
    const master = await getMasterResume();
    const priorAccepted = stored.filter((s) => s.accepted === true);
    const raw = await suggestFromFeedback(feedback, jd, master, priorAccepted, undefined, signal);
    // Labelled against the résumé the model saw (earlier rounds applied), so a
    // term an earlier round added counts as grounded here.
    const current = currentMaster(master, priorAccepted);
    const batch: Suggestion[] = raw.map((s) => ({
      ...s,
      groundedness: labelGroundedness(current, s),
      accepted: null,
      source: "feedback",
    }));
    if (signal.aborted) throw new CancelledError();
    if (batch.length === 0) {
      // Nothing to review — stay 'ready' rather than routing through an empty
      // checklist whose only exit regenerates the resume (and would discard any
      // hand edits in the Markdown editor for no gain).
      await revertToReady(
        id,
        "That feedback didn't turn into any edits your resume supports — it may already cover those points, or they'd need experience it doesn't list."
      );
      return;
    }
    await setSuggestions(id, appendBatch(stored, batch));
  } catch (err) {
    // POST /api/resume/:id/cancel already put the row back to 'ready'.
    if (isCancelledError(err) || signal.aborted) {
      console.log(`[resume] feedback pipeline cancelled for ${id}`);
      return;
    }
    console.error("[resume] feedback pipeline error:", err);
    const credentialHint =
      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    // Back to 'ready', not 'failed': the resume itself is fine, only this
    // round didn't happen. 'failed' would offer a retry of the JD pass, which
    // overwrites the whole suggestion set.
    await revertToReady(id, `Applying feedback failed — ${credentialHint} and try again.`);
  } finally {
    clearRun(id);
  }
}

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

// POST /api/resume/:id/generate-answers — drafts answers to pasted application
// questions using this row's JD + the master résumé. Async like /tailor so a
// slow Claude call cannot die on Railway's edge-proxy timeout. Does NOT touch
// resume `status` (a generating-answers run must not flip the editor into the
// pending screen or collide with an in-flight tailor via registerRun(id)).
router.post("/resume/:id/generate-answers", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "text is required — paste the application questions." });
    return;
  }
  if (text.length > MAX_PASTE_CHARS) {
    res.status(400).json({ error: `Pasted text is too long (max ${MAX_PASTE_CHARS} characters).` });
    return;
  }

  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!row.jd_text?.trim()) {
    res.status(409).json({ error: "This resume has no stored job description — generate it from /tailor first." });
    return;
  }
  if (row.status === "pending") {
    res.status(409).json({ error: "Resume is still generating — wait until it finishes, then draft answers." });
    return;
  }

  await beginGeneratingAnswers(req.params.id, text);
  res.status(202).json({ id: req.params.id, status: "generating" });

  runAnswersPipeline(req.params.id, text, row).catch((err) => {
    console.error("[resume] generate-answers pipeline crashed:", err);
  });
});

// PATCH /api/resume/:id/application-answers — persist hand-edits to drafts.
router.patch("/resume/:id/application-answers", async (req, res) => {
  const parsed = z.array(ApplicationAnswerSchema).safeParse(req.body?.items);
  if (!parsed.success) {
    res.status(400).json({ error: "items must be an array of { id, question, answer }." });
    return;
  }

  const row = await getTailoredResume(req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.application_answers?.status === "generating") {
    res.status(409).json({ error: "Answers are still generating — wait, then edit." });
    return;
  }

  const updated = await updateApplicationAnswerItems(req.params.id, parsed.data);
  if (!updated) {
    res.status(409).json({ error: "No saved answers to edit yet — generate drafts first." });
    return;
  }
  res.json(updated);
});

// DELETE /api/resume/:id
// POST /api/resume/:id/duplicate — copies a settled resume (content, suggestion
// history and rendered PDF) into a new row, so a variant can be edited without
// re-running the pipeline or re-pasting the JD.
router.post("/resume/:id/duplicate", async (req, res) => {
  const existing = await getTailoredResume(req.params.id);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status !== "ready" && existing.status !== "awaiting_review") {
    res.status(409).json({ error: `Resume is ${existing.status} — only a finished resume can be duplicated.` });
    return;
  }

  const copy = await duplicateTailoredResume(req.params.id);
  // Null here means the status changed between the read and the insert.
  if (!copy) { res.status(409).json({ error: "Resume is no longer in a state that can be duplicated." }); return; }
  res.status(201).json(copy);
});

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
    html: `<p>Tailored resume for <strong>${escapeHtml(row.job_title ?? "this role")}</strong> at <strong>${escapeHtml(row.company ?? "this company")}</strong>.</p>`,
    attachments: [{ filename, content: pdf }],
  });

  res.json({ sent: true });
});

export default router;
