"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api, Resume } from "../lib/api";
import { STAGE_SEGMENTS, segmentIndex, estimateStageProgress } from "../lib/resumeStage";
import { appliedAtTimestamp, todayDateInputValue } from "../lib/appliedAt";
import SuggestionChecklist from "./SuggestionChecklist";
import { FEEDBACK_STAGE, isFollowUpRound, undecided } from "../lib/suggestionRounds";
import ApplicationAnswers from "./ApplicationAnswers";

type ApplyForm = { status: string; appliedAt: string };
type ViewMode = "edit" | "split" | "preview";

function ToolbarDivider() {
  return <div className="w-px h-4 bg-paper-border mx-1 flex-shrink-0" />;
}

function ToolbarBtn({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="px-2 py-1 text-xs font-medium text-paper-muted hover:bg-black/5 rounded transition-colors leading-none"
    >
      {label}
    </button>
  );
}

function PdfPane({
  blobUrl,
  loading,
  error,
  onRefresh,
  className = "",
}: {
  blobUrl: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col border-l border-paper-border bg-black/[0.03] min-w-0 ${className}`}>
      {/* Pane header */}
      <div className="px-4 py-2 border-b border-paper-border bg-paper flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-paper-muted">PDF Preview</span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-paper-muted hover:text-paper-ink disabled:opacity-50 transition-colors"
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={loading ? "animate-spin" : ""}
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {error && (
          <div className="p-4 text-sm text-red-600 bg-red-50 border-b border-red-100">
            {error}
          </div>
        )}
        {blobUrl ? (
          <iframe
            src={blobUrl}
            className="w-full h-full border-0"
            title="Resume PDF preview"
          />
        ) : !loading && !error ? (
          <div className="h-full flex items-center justify-center text-sm text-paper-muted">
            Click Refresh to load the PDF preview.
          </div>
        ) : null}
        {loading && !blobUrl && (
          <div className="h-full flex items-center justify-center text-sm text-paper-muted">
            Rendering PDF…
          </div>
        )}
      </div>
    </div>
  );
}

/** Amber, dismissible notice for a message the row carries while not 'failed' (feedback rounds, apply-pass errors). */
function RowNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-800 flex items-center justify-between gap-4 flex-shrink-0">
      <span>{message}</span>
      <button onClick={onDismiss} className="text-amber-700 hover:text-amber-900 font-medium flex-shrink-0">
        Dismiss
      </button>
    </div>
  );
}

export default function ResumeEditor({
  resume,
  initialView = "edit",
}: {
  resume: Resume;
  initialView?: ViewMode;
}) {
  const [markdown, setMarkdown] = useState(resume.markdown);
  const [jobTitle, setJobTitle] = useState(resume.job_title ?? "");
  const [company, setCompany] = useState(resume.company ?? "");
  const [meta, setMeta] = useState({
    status: resume.status,
    error: resume.error,
    location: resume.location,
    job_url: resume.job_url,
    created_at: resume.created_at,
    stage: resume.stage,
    stage_started_at: resume.stage_started_at,
    suggestions: resume.suggestions,
    application_answers: resume.application_answers,
  });
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [applyForm, setApplyForm] = useState<ApplyForm>({
    status: "applied",
    appliedAt: todayDateInputValue(),
  });
  const [applyStatus, setApplyStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [cancelState, setCancelState] = useState<"idle" | "working" | "error">("idle");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfRenderError, setPdfRenderError] = useState<string | null>(resume.pdf_error);
  const pdfBlobUrlRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const companyInputRef = useRef<HTMLInputElement>(null);
  const hasAttemptedLoadRef = useRef(false);

  const autoSave = useCallback(
    async (value: string) => {
      setSaveStatus("saving");
      try {
        const { pdfError: renderError } = await api.patchResume(resume.id, { markdown: value });
        setSaveStatus("saved");
        setPdfRenderError(renderError);
      } catch {
        setSaveStatus("error");
      }
    },
    [resume.id]
  );

  function handleChange(value: string) {
    setMarkdown(value);
    setSaveStatus("unsaved");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => autoSave(value), 1000);
  }

  const autoSaveMeta = useCallback(
    async (fields: { jobTitle?: string; company?: string }) => {
      setSaveStatus("saving");
      try {
        await api.patchResume(resume.id, fields);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    },
    [resume.id]
  );

  function handleTitleChange(value: string) {
    setJobTitle(value);
    setSaveStatus("unsaved");
    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
    titleDebounceRef.current = setTimeout(() => autoSaveMeta({ jobTitle: value }), 800);
  }

  function handleCompanyChange(value: string) {
    setCompany(value);
    setSaveStatus("unsaved");
    if (companyDebounceRef.current) clearTimeout(companyDebounceRef.current);
    companyDebounceRef.current = setTimeout(() => autoSaveMeta({ company: value }), 800);
  }

  function insertMarkdown(before: string, after = "") {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = markdown.slice(start, end);
    const newValue = markdown.slice(0, start) + before + selected + after + markdown.slice(end);
    handleChange(newValue);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(
        start + before.length,
        start + before.length + selected.length
      );
    }, 0);
  }

  const loadPdf = useCallback(async () => {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const blob = await api.getPdfBlob(resume.id);
      const url = URL.createObjectURL(blob);
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        pdfBlobUrlRef.current = url;
        return url;
      });
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "Failed to load PDF preview.");
    } finally {
      setPdfLoading(false);
    }
  }, [resume.id]);

  // Load the PDF whenever the user switches into a mode that shows the preview.
  // `meta.status` is a dependency on purpose: 'ready' is the only status with a
  // PDF behind it (every other one 409s), so the fetch is skipped until the row
  // gets there — and the status change is what re-runs this effect once the
  // pipeline settles, loading the PDF on its own. The poll below clears
  // hasAttemptedLoadRef, but a ref mutation alone never re-ran this effect,
  // which is why a finished resume used to sit there until a manual Refresh.
  useEffect(() => {
    if (viewMode === "edit" || meta.status !== "ready") return;
    if (pdfBlobUrl || pdfLoading || hasAttemptedLoadRef.current) return;
    hasAttemptedLoadRef.current = true;
    loadPdf().catch(() => {
      // Error already handled in loadPdf
    });
  }, [viewMode, meta.status, pdfBlobUrl, pdfLoading, loadPdf]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrlRef.current) URL.revokeObjectURL(pdfBlobUrlRef.current);
    };
  }, []);

  // The tailoring pipeline runs in the background (see /api/tailor) so this page can
  // load instantly instead of holding a request open past Railway's proxy timeout.
  // Poll until it flips out of "pending".
  useEffect(() => {
    if (meta.status !== "pending") return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const fresh = await api.getResume(resume.id);
        if (cancelled) return;
        if (fresh.status === "pending") {
          // Still running — just surface the current stage, nothing else has
          // changed yet (markdown/PDF are only written once status flips).
          setMeta((m) =>
            m.stage === fresh.stage && m.application_answers?.status === fresh.application_answers?.status
              ? m
              : {
                  ...m,
                  stage: fresh.stage,
                  stage_started_at: fresh.stage_started_at,
                  application_answers: fresh.application_answers,
                }
          );
          return;
        }
        // Let the PDF pane's auto-load effect retry now that a PDF exists — it
        // latched hasAttemptedLoadRef after an earlier attempt 409'd while pending.
        // The status change below is what actually re-runs that effect.
        hasAttemptedLoadRef.current = false;
        setPdfError(null);
        setMeta({
          status: fresh.status,
          error: fresh.error,
          location: fresh.location,
          job_url: fresh.job_url,
          created_at: fresh.created_at,
          stage: fresh.stage,
          stage_started_at: fresh.stage_started_at,
          suggestions: fresh.suggestions,
          application_answers: fresh.application_answers,
        });
        setMarkdown(fresh.markdown);
        setJobTitle(fresh.job_title ?? "");
        setCompany(fresh.company ?? "");
        setPdfRenderError(fresh.pdf_error);
      } catch (err) {
        if (!cancelled && err instanceof Error && err.message === "Not found") {
          setMeta((m) => ({ ...m, status: "failed", error: "This resume was deleted." }));
        }
        // otherwise assume a transient network error — keep polling
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [meta.status, resume.id]);

  // Ticks once a second while a stage is in flight, purely to animate the
  // elapsed-time-vs-typical progress bar between polls — the 4s poll above
  // remains the sole source of truth for `stage` / `stage_started_at`.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (meta.status !== "pending") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [meta.status]);

  // The cancel endpoint writes the resulting status itself, so the screen can
  // switch on its response instead of waiting for the next 4s poll tick.
  async function handleCancelGeneration() {
    setCancelState("working");
    setCancelError(null);
    try {
      const { status } = await api.cancelResume(resume.id);
      setMeta((m) => ({ ...m, status, stage: null, stage_started_at: null, error: null }));
      setCancelState("idle");
    } catch (err) {
      // Usually a 409: the run finished between render and click. The poll
      // effect picks up the real terminal state a moment later either way.
      setCancelState("error");
      setCancelError(err instanceof Error ? err.message : "Could not cancel — it may have just finished.");
    }
  }

  // Clears the notice left by a failed/empty feedback round or a failed apply
  // pass. Optimistic: the banner goes away immediately, the server write follows.
  async function handleDismissError() {
    setMeta((m) => ({ ...m, error: null }));
    await api.clearResumeError(resume.id).catch(() => {});
  }

  // Kicks off a feedback round: the pasted notes become a new batch of
  // suggestions, reviewed in the same checklist as the JD pass. The row goes
  // through 'pending' again, so the existing poll effect carries it home.
  async function handleSubmitFeedback() {
    const feedback = feedbackText.trim();
    if (!feedback) return;
    setFeedbackStatus("submitting");
    setFeedbackError(null);
    try {
      await api.submitFeedback(resume.id, feedback);
      setFeedbackText("");
      setShowFeedbackForm(false);
      setFeedbackStatus("idle");
      setMeta((m) => ({
        ...m,
        status: "pending",
        stage: FEEDBACK_STAGE,
        stage_started_at: new Date().toISOString(),
        error: null,
      }));
    } catch (err) {
      setFeedbackStatus("error");
      setFeedbackError(err instanceof Error ? err.message : "Could not start the feedback round.");
    }
  }

  async function handleRetry() {
    setCancelState("working");
    setCancelError(null);
    try {
      await api.retryResume(resume.id);
      setMeta((m) => ({ ...m, status: "pending", stage: null, stage_started_at: null, error: null }));
      setCancelState("idle");
    } catch (err) {
      setCancelState("error");
      setCancelError(err instanceof Error ? err.message : "Could not restart generation.");
    }
  }

  async function handleDownload() {
    try {
      const { blob, filename } = await api.getPdfBlobWithFilename(resume.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? "resume.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("PDF download failed. Try again.");
    }
  }

  async function handleEmail() {
    setEmailStatus("sending");
    try {
      await api.emailResume(resume.id);
      setEmailStatus("sent");
      setTimeout(() => setEmailStatus("idle"), 3000);
    } catch {
      setEmailStatus("error");
      setTimeout(() => setEmailStatus("idle"), 3000);
    }
  }

  async function handleApply() {
    setApplyStatus("saving");
    setApplyError(null);
    try {
      await api.postApplied({
        company: company,
        jobTitle: jobTitle,
        location: meta.location ?? undefined,
        jobUrl: meta.job_url ?? undefined,
        status: applyForm.status,
        appliedAt: appliedAtTimestamp(applyForm.appliedAt),
        resumeId: resume.id,
      });
      setApplyStatus("done");
      setShowApplyForm(false);
    } catch (e) {
      setApplyStatus("error");
      setApplyError(e instanceof Error ? e.message : "Couldn't add to the log.");
    }
  }

  const saveLabel =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "error"
      ? "Save error"
      : saveStatus === "unsaved"
      ? "Unsaved"
      : "Auto-saved";

  const title = [jobTitle, company].filter(Boolean).join(" – ");
  const wordCount = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
  const charCount = markdown.length;

  if (meta.status === "pending") {
    const activeIndex = segmentIndex(meta.stage);
    const progress = estimateStageProgress(meta.stage, meta.stage_started_at, now);
    return (
      <div className="flex flex-col h-full bg-paper">
        <div className="border-b border-paper-border px-6 py-3 flex-shrink-0">
          <Link href="/" className="text-sm text-paper-muted hover:text-paper-ink flex items-center gap-1 w-fit transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div className="w-full max-w-sm">
            <p className="text-sm font-medium text-paper-ink">
              Generating your tailored resume{title ? ` for ${title}` : ""}…
            </p>
            {activeIndex === -1 || !progress ? (
              <>
                <svg className="animate-spin mx-auto text-violet-600 mt-4" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <p className="text-xs text-paper-muted mt-4">
                  This usually takes well under a minute. This page updates automatically.
                  {meta.application_answers?.status === "generating" && " Application answers are drafting in the background too."}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mt-6">
                  {STAGE_SEGMENTS.map((label, i) => (
                    <div key={label} className="flex-1 flex flex-col items-center">
                      <div className="flex items-center w-full">
                        {i > 0 && (
                          <div className={`h-0.5 flex-1 ${i <= activeIndex ? "bg-violet-600" : "bg-paper-border"}`} />
                        )}
                        <div
                          className={`w-3 h-3 rounded-full flex-shrink-0 ${
                            i < activeIndex
                              ? "bg-violet-600"
                              : i === activeIndex
                              ? "bg-violet-600 animate-pulse"
                              : "bg-paper-border"
                          } ${i === 0 ? "" : "ml-0"}`}
                        />
                        {i < STAGE_SEGMENTS.length - 1 && (
                          <div className={`h-0.5 flex-1 ${i < activeIndex ? "bg-violet-600" : "bg-paper-border"}`} />
                        )}
                      </div>
                      <span className={`text-[11px] mt-1.5 ${i === activeIndex ? "text-violet-700 font-medium" : "text-paper-muted"}`}>
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-paper-muted mt-6">{meta.stage}</p>
                <div className="mt-3">
                  <div className="h-1 w-full rounded-full bg-paper-border overflow-hidden">
                    <div
                      className="h-full bg-violet-600 transition-all duration-1000 ease-linear"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-paper-muted mt-1.5">
                    {progress.elapsedSeconds}s / ~{progress.expectedSeconds}s typical
                    {meta.application_answers?.status === "generating" && " · answers drafting too"}
                  </p>
                </div>
              </>
            )}

            {/* Outside the spinner/stepper branches above so it's reachable at
                every point of the run, including before the first stage lands. */}
            <button
              onClick={handleCancelGeneration}
              disabled={cancelState === "working"}
              className="mt-8 text-xs text-paper-muted hover:text-red-700 underline underline-offset-2 disabled:opacity-50 disabled:no-underline transition-colors"
            >
              {cancelState === "working" ? "Cancelling…" : "Cancel generation"}
            </button>
            {cancelError && <p className="text-[11px] text-red-600 mt-2">{cancelError}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (meta.status === "cancelled") {
    return (
      <div className="flex flex-col h-full bg-paper">
        <div className="border-b border-paper-border px-6 py-3 flex-shrink-0">
          <Link href="/" className="text-sm text-paper-muted hover:text-paper-ink flex items-center gap-1 w-fit transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div className="max-w-md">
            <p className="text-sm font-medium text-paper-ink">Generation cancelled</p>
            <p className="text-xs text-paper-muted mt-2">
              Nothing was generated{title ? ` for ${title}` : ""}. The job description is still saved,
              so you can pick this back up without pasting it again.
            </p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={handleRetry}
                disabled={cancelState === "working"}
                className="text-sm px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {cancelState === "working" ? "Starting…" : "Regenerate"}
              </button>
              <Link
                href="/"
                className="text-sm px-4 py-2 border border-paper-border hover:bg-black/5 text-paper-ink rounded-lg transition-colors"
              >
                Back to Dashboard
              </Link>
            </div>
            {cancelError && <p className="text-[11px] text-red-600 mt-3">{cancelError}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (meta.status === "awaiting_review") {
    return (
      <div className="flex flex-col h-full bg-paper">
        <div className="border-b border-paper-border px-6 py-3 flex-shrink-0">
          <Link href="/" className="text-sm text-paper-muted hover:text-paper-ink flex items-center gap-1 w-fit transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
        </div>
        <div className="px-6 pt-4 flex-shrink-0">
          <p className="text-sm font-medium text-paper-ink">
            Review suggestions{title ? ` for ${title}` : ""}
          </p>
        </div>
        {/* A failed apply pass comes back here, checklist intact, with its error. */}
        {meta.error && <RowNotice message={meta.error} onDismiss={handleDismissError} />}
        {(meta.application_answers || resume.application_answers) && (
          <ApplicationAnswers
            resumeId={resume.id}
            initial={meta.application_answers ?? resume.application_answers}
            hasJd={Boolean(resume.jd_text?.trim())}
            company={company}
          />
        )}
        <SuggestionChecklist
          resumeId={resume.id}
          suggestions={undecided(meta.suggestions ?? [])}
          followUp={isFollowUpRound(meta.suggestions ?? [])}
          onApplied={() => setMeta((m) => ({ ...m, status: "pending", stage: null }))}
        />
      </div>
    );
  }

  if (meta.status === "failed") {
    return (
      <div className="flex flex-col h-full bg-paper">
        <div className="border-b border-paper-border px-6 py-3 flex-shrink-0">
          <Link href="/" className="text-sm text-paper-muted hover:text-paper-ink flex items-center gap-1 w-fit transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div className="max-w-md">
            <p className="text-sm font-medium text-red-700">Tailoring failed</p>
            <p className="text-xs text-paper-muted mt-2">{meta.error ?? "Unknown error."}</p>
            <Link
              href="/tailor"
              className="inline-block mt-4 text-sm px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
            >
              Back to Tailor
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const showEdit = viewMode === "edit" || viewMode === "split";
  const showPreview = viewMode === "split" || viewMode === "preview";

  return (
    <div className="flex flex-col h-full bg-paper">
      {/* Breadcrumb */}
      <div className="border-b border-paper-border px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-1.5 text-sm text-paper-muted">
          <Link href="/" className="hover:text-paper-ink flex items-center gap-1 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
          <span className="text-paper-muted/60">&rsaquo;</span>
          <span>Resumes</span>
          <span className="text-paper-muted/60">/</span>
          <span className="text-paper-ink font-medium truncate max-w-xs">{title || "Untitled"}</span>
        </div>
        <span
          className={`text-xs font-medium ${
            saveStatus === "saved"
              ? "text-green-600"
              : saveStatus === "error"
              ? "text-red-500"
              : "text-paper-muted"
          }`}
        >
          {saveLabel}
        </span>
      </div>

      {pdfRenderError && (
        <div className="border-b border-red-100 bg-red-50 px-6 py-2 text-xs text-red-700 flex-shrink-0">
          <span className="font-medium">PDF didn&apos;t update:</span> {pdfRenderError}
          {" — "}the downloaded/emailed PDF reflects an older version until this is fixed.
        </div>
      )}

      {/* Title + score + actions */}
      <div className="border-b border-paper-border px-6 py-4 flex items-start justify-between gap-4 flex-shrink-0">
        <div className="min-w-0 flex-1">
          <input
            value={jobTitle}
            onChange={(e) => handleTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                companyInputRef.current?.focus();
              }
            }}
            placeholder="Untitled"
            aria-label="Job title"
            className="block w-full text-lg font-semibold text-paper-ink bg-transparent border border-transparent hover:border-paper-border focus:border-paper-border rounded px-1 -mx-1 outline-none focus:ring-1 focus:ring-violet-300 transition-colors"
          />
          <input
            ref={companyInputRef}
            value={company}
            onChange={(e) => handleCompanyChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder="Company"
            aria-label="Company"
            className="block w-full text-sm text-paper-muted bg-transparent border border-transparent hover:border-paper-border focus:border-paper-border rounded px-1 -mx-1 outline-none focus:ring-1 focus:ring-violet-300 transition-colors mt-0.5"
          />
          <p className="text-xs text-paper-muted mt-0.5">
            {new Date(meta.created_at).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {/* View mode toggle */}
          <div className="flex items-center border border-paper-border rounded-lg overflow-hidden">
            {(["edit", "split", "preview"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === mode
                    ? "bg-paper-ink text-paper"
                    : "text-paper-muted hover:bg-black/[0.03] hover:text-paper-ink"
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          {meta.job_url && (
            <a
              href={meta.job_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-paper-border rounded-lg hover:bg-black/[0.03] transition-colors text-paper-ink"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
              </svg>
              View JD
            </a>
          )}
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-paper-border rounded-lg hover:bg-black/[0.03] transition-colors text-paper-ink"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download PDF
          </button>
          <button
            onClick={handleEmail}
            disabled={emailStatus === "sending"}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-paper-border rounded-lg hover:bg-black/[0.03] disabled:opacity-50 transition-colors text-paper-ink"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            {emailStatus === "sending"
              ? "Sending…"
              : emailStatus === "sent"
              ? "Sent ✓"
              : emailStatus === "error"
              ? "Failed"
              : "Email to me"}
          </button>
          <button
            onClick={() => setShowFeedbackForm((v) => !v)}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded-lg transition-colors ${
              showFeedbackForm
                ? "border-violet-400 bg-violet-50 text-violet-800"
                : "border-paper-border hover:bg-black/[0.03] text-paper-ink"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Apply feedback
          </button>
          <button
            onClick={() => setShowApplyForm((v) => !v)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {applyStatus === "done" ? "Applied ✓" : "Mark as applied"}
          </button>
        </div>
      </div>

      {/* A failed or empty feedback round lands back here with its notice on the row. */}
      {meta.error && !showFeedbackForm && <RowNotice message={meta.error} onDismiss={handleDismissError} />}

      {/* Feedback form — paste reviewer notes, get a new batch of suggestions to review */}
      {showFeedbackForm && (
        <div className="bg-black/[0.03] border-b border-paper-border px-6 py-3 flex flex-col gap-2 flex-shrink-0">
          <p className="text-xs text-paper-muted">
            Paste feedback on this resume — a reviewer&apos;s notes, a recruiter&apos;s nitpicks, anything.
            Each point becomes a suggested edit you review before it&apos;s applied, shown as the exact
            change against the current wording. Your format and every earlier accepted edit stay as they are.
          </p>
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={"e.g. Your skills section is missing SQL and Git. The posting calls out testing — add Jest.\nThe Mandy bullets should mention the API you built."}
            rows={5}
            className="w-full text-sm px-3 py-2 border border-paper-border rounded-lg bg-paper focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
          />
          <p className="text-[11px] text-amber-700">
            Applying regenerates the resume from your master plus every accepted suggestion. Edits typed
            directly into the text editor are not carried over.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSubmitFeedback}
              disabled={feedbackStatus === "submitting" || !feedbackText.trim()}
              className="text-sm px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {feedbackStatus === "submitting" ? "Starting…" : "Suggest edits"}
            </button>
            <button
              onClick={() => setShowFeedbackForm(false)}
              className="text-sm px-3 py-1.5 text-paper-muted hover:text-paper-ink transition-colors"
            >
              Cancel
            </button>
            {feedbackError && <span className="text-xs text-red-600">{feedbackError}</span>}
          </div>
        </div>
      )}

      {/* Apply form */}
      {showApplyForm && (
        <div className="bg-black/[0.03] border-b border-paper-border px-6 py-3 flex flex-col gap-2 flex-shrink-0">
          {(!meta.location || !meta.job_url) && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Missing {[!meta.location && "location", !meta.job_url && "job URL"].filter(Boolean).join(" and ")} on
              this resume — the applied-jobs log and Google Sheet row will have blank cells for{" "}
              {meta.location || meta.job_url ? "it" : "them"}.
            </p>
          )}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-paper-muted font-medium">Status</label>
              <select
                value={applyForm.status}
                onChange={(e) => setApplyForm((f) => ({ ...f, status: e.target.value }))}
                className="border border-paper-border rounded-lg px-2 py-1 text-xs bg-paper focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="applied">Applied</option>
                <option value="interviewing">Interviewing</option>
                <option value="assessment">Assessment</option>
                <option value="no_response">No Response</option>
                <option value="offer">Offer</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-paper-muted font-medium">Date</label>
              <input
                type="date"
                value={applyForm.appliedAt}
                onChange={(e) => setApplyForm((f) => ({ ...f, appliedAt: e.target.value }))}
                className="border border-paper-border rounded-lg px-2 py-1 text-xs bg-paper focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <button
              onClick={handleApply}
              disabled={applyStatus === "saving" || applyStatus === "done"}
              className="text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {applyStatus === "saving" ? "Saving…" : applyStatus === "error" ? "Failed" : "Confirm"}
            </button>
            <button
              onClick={() => setShowApplyForm(false)}
              className="text-xs text-paper-muted hover:text-paper-muted transition-colors"
            >
              Cancel
            </button>
          </div>
          {applyError && <p className="text-xs text-red-700">{applyError}</p>}
        </div>
      )}

      <ApplicationAnswers
        resumeId={resume.id}
        initial={meta.application_answers ?? resume.application_answers}
        hasJd={Boolean(resume.jd_text?.trim())}
        company={company}
      />

      {/* Formatting toolbar (hidden in pure preview mode) */}
      {showEdit && (
        <div className="border-b border-paper-border px-4 py-1.5 flex items-center gap-0.5 flex-wrap bg-paper flex-shrink-0">
          <ToolbarBtn label="H1" title="Heading 1" onClick={() => insertMarkdown("# ")} />
          <ToolbarBtn label="H2" title="Heading 2" onClick={() => insertMarkdown("## ")} />
          <ToolbarBtn label="H3" title="Heading 3" onClick={() => insertMarkdown("### ")} />
          <ToolbarDivider />
          <ToolbarBtn label="B" title="Bold" onClick={() => insertMarkdown("**", "**")} />
          <ToolbarBtn label="I" title="Italic" onClick={() => insertMarkdown("_", "_")} />
          <ToolbarBtn label="S" title="Strikethrough" onClick={() => insertMarkdown("~~", "~~")} />
          <ToolbarDivider />
          <ToolbarBtn label="•" title="Bullet list" onClick={() => insertMarkdown("- ")} />
          <ToolbarBtn label="1." title="Numbered list" onClick={() => insertMarkdown("1. ")} />
          <ToolbarDivider />
          <ToolbarBtn label="`" title="Inline code" onClick={() => insertMarkdown("`", "`")} />
          <ToolbarBtn label="```" title="Code block" onClick={() => insertMarkdown("\n```\n", "\n```")} />
          <ToolbarBtn label="❝" title="Blockquote" onClick={() => insertMarkdown("> ")} />
          <ToolbarDivider />
          <ToolbarBtn label="—" title="Horizontal rule" onClick={() => insertMarkdown("\n---\n")} />
        </div>
      )}

      {/* Content: edit + preview panes */}
      {viewMode === "split" ? (
        <PanelGroup direction="horizontal" className="flex-1 min-h-0">
          <Panel defaultSize={50} minSize={20}>
            <textarea
              ref={textareaRef}
              value={markdown}
              onChange={(e) => handleChange(e.target.value)}
              spellCheck={false}
              className="w-full h-full resize-none font-mono text-sm leading-relaxed text-paper-ink bg-paper px-10 py-8 focus:outline-none"
              style={{ fontFamily: "var(--font-geist-mono), 'Courier New', monospace" }}
            />
          </Panel>
          <PanelResizeHandle className="w-1 bg-paper-border hover:bg-violet-400 active:bg-violet-500 transition-colors cursor-col-resize" />
          <Panel defaultSize={50} minSize={20}>
            <PdfPane
              blobUrl={pdfBlobUrl}
              loading={pdfLoading}
              error={pdfError}
              onRefresh={loadPdf}
              className="h-full"
            />
          </Panel>
        </PanelGroup>
      ) : (
        <div className="flex flex-1 min-h-0">
          {showEdit && (
            <textarea
              ref={textareaRef}
              value={markdown}
              onChange={(e) => handleChange(e.target.value)}
              spellCheck={false}
              className="flex-1 resize-none font-mono text-sm leading-relaxed text-paper-ink bg-paper px-10 py-8 focus:outline-none"
              style={{ fontFamily: "var(--font-geist-mono), 'Courier New', monospace" }}
            />
          )}

          {showPreview && (
            <PdfPane
              blobUrl={pdfBlobUrl}
              loading={pdfLoading}
              error={pdfError}
              onRefresh={loadPdf}
              className="flex-1"
            />
          )}
        </div>
      )}

      {/* Footer: word/char count (only shown when editor is visible) */}
      {showEdit && (
        <div className="border-t border-paper-border px-6 py-2 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-paper-muted">
            Words: {wordCount.toLocaleString()}&nbsp;&nbsp;Characters: {charCount.toLocaleString()}
          </span>
          <span className="text-xs bg-black/5 text-paper-muted font-medium px-2 py-0.5 rounded">
            Markdown
          </span>
        </div>
      )}
    </div>
  );
}
