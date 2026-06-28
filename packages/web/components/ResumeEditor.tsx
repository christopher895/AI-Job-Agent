"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { api, Resume } from "../lib/api";

type ApplyForm = { status: string; appliedAt: string };
type ViewMode = "edit" | "split" | "preview";

function ToolbarDivider() {
  return <div className="w-px h-4 bg-gray-200 mx-1 flex-shrink-0" />;
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
      className="px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors leading-none"
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
}: {
  blobUrl: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col border-l border-gray-200 bg-gray-50 flex-1 min-w-0">
      {/* Pane header */}
      <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-gray-600">PDF Preview</span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50 transition-colors"
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
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            Click Refresh to load the PDF preview.
          </div>
        ) : null}
        {loading && !blobUrl && (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            Rendering PDF…
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResumeEditor({ resume }: { resume: Resume }) {
  const [markdown, setMarkdown] = useState(resume.markdown);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [applyForm, setApplyForm] = useState<ApplyForm>({
    status: "applied",
    appliedAt: new Date().toISOString().split("T")[0],
  });
  const [applyStatus, setApplyStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoSave = useCallback(
    async (value: string) => {
      setSaveStatus("saving");
      try {
        const { updatedAt } = await api.patchResume(resume.id, value);
        setLastSaved(new Date(updatedAt));
        setSaveStatus("saved");
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

  async function loadPdf() {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const blob = await api.getPdfBlob(resume.id);
      const url = URL.createObjectURL(blob);
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "Failed to load PDF preview.");
    } finally {
      setPdfLoading(false);
    }
  }

  // Load PDF whenever the user switches into a mode that shows the preview
  useEffect(() => {
    if (viewMode !== "edit" && !pdfBlobUrl && !pdfLoading) {
      loadPdf();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDownload() {
    try {
      const blob = await api.getPdfBlob(resume.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${resume.company ?? "resume"}-${resume.job_title ?? "resume"}.pdf`;
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
    try {
      await api.postApplied({
        company: resume.company ?? "",
        jobTitle: resume.job_title ?? "",
        jobUrl: resume.job_url ?? undefined,
        status: applyForm.status,
        appliedAt: applyForm.appliedAt,
        resumeId: resume.id,
      });
      setApplyStatus("done");
      setShowApplyForm(false);
    } catch {
      setApplyStatus("error");
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

  const title = [resume.job_title, resume.company].filter(Boolean).join(" – ");
  const wordCount = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
  const charCount = markdown.length;

  const showEdit = viewMode === "edit" || viewMode === "split";
  const showPreview = viewMode === "split" || viewMode === "preview";

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Breadcrumb */}
      <div className="border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <Link href="/" className="hover:text-gray-800 flex items-center gap-1 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
          <span className="text-gray-300">&rsaquo;</span>
          <span>Resumes</span>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium truncate max-w-xs">{title || "Untitled"}</span>
        </div>
        <span
          className={`text-xs font-medium ${
            saveStatus === "saved"
              ? "text-green-600"
              : saveStatus === "error"
              ? "text-red-500"
              : "text-gray-400"
          }`}
        >
          {saveLabel}
        </span>
      </div>

      {/* Title + score + actions */}
      <div className="border-b border-gray-200 px-6 py-4 flex items-start justify-between gap-4 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{title || "Untitled"}</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {new Date(resume.created_at).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            {resume.critic_score != null ? ` • Match Score: ${resume.critic_score}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {resume.critic_score != null && (
            <div className="w-10 h-10 rounded-full border-2 border-green-400 flex items-center justify-center mr-1">
              <span className="text-sm font-bold text-gray-900">{resume.critic_score}</span>
            </div>
          )}

          {/* View mode toggle */}
          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
            {(["edit", "split", "preview"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === mode
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
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
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors text-gray-700"
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

      {/* Apply form */}
      {showApplyForm && (
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center gap-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium">Status</label>
            <select
              value={applyForm.status}
              onChange={(e) => setApplyForm((f) => ({ ...f, status: e.target.value }))}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              <option value="applied">Applied</option>
              <option value="interviewing">Interviewing</option>
              <option value="assessment">Assessment</option>
              <option value="offer">Offer</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium">Date</label>
            <input
              type="date"
              value={applyForm.appliedAt}
              onChange={(e) => setApplyForm((f) => ({ ...f, appliedAt: e.target.value }))}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <button
            onClick={handleApply}
            disabled={applyStatus === "saving"}
            className="text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {applyStatus === "saving" ? "Saving…" : applyStatus === "error" ? "Failed" : "Confirm"}
          </button>
          <button
            onClick={() => setShowApplyForm(false)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Formatting toolbar (hidden in pure preview mode) */}
      {showEdit && (
        <div className="border-b border-gray-200 px-4 py-1.5 flex items-center gap-0.5 flex-wrap bg-white flex-shrink-0">
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
      <div className="flex flex-1 min-h-0">
        {showEdit && (
          <textarea
            ref={textareaRef}
            value={markdown}
            onChange={(e) => handleChange(e.target.value)}
            spellCheck={false}
            className={`resize-none font-mono text-sm leading-relaxed text-gray-800 bg-white px-10 py-8 focus:outline-none ${
              viewMode === "edit" ? "flex-1" : "w-1/2"
            }`}
            style={{ fontFamily: "var(--font-geist-mono), 'Courier New', monospace" }}
          />
        )}

        {showPreview && (
          <PdfPane
            blobUrl={pdfBlobUrl}
            loading={pdfLoading}
            error={pdfError}
            onRefresh={loadPdf}
          />
        )}
      </div>

      {/* Footer: word/char count (only shown when editor is visible) */}
      {showEdit && (
        <div className="border-t border-gray-200 px-6 py-2 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-gray-400">
            Words: {wordCount.toLocaleString()}&nbsp;&nbsp;Characters: {charCount.toLocaleString()}
          </span>
          <span className="text-xs bg-gray-100 text-gray-500 font-medium px-2 py-0.5 rounded">
            Markdown
          </span>
        </div>
      )}
    </div>
  );
}
