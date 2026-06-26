"use client";
import { useState, useRef, useCallback } from "react";
import { api, Resume } from "../lib/api";

type ApplyForm = { status: string; appliedAt: string };

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  async function handleDownload() {
    try {
      const res = await fetch(api.pdfUrl(resume.id));
      const blob = await res.blob();
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
      : lastSaved
      ? `Saved ${lastSaved.toLocaleTimeString()}`
      : "Saved";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 px-6 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium text-zinc-900 text-sm truncate">
            {resume.job_title ?? "Untitled"}{" "}
            {resume.company && (
              <span className="text-zinc-400 font-normal">— {resume.company}</span>
            )}
          </div>
          <div
            className={`text-xs mt-0.5 ${
              saveStatus === "error"
                ? "text-red-500"
                : saveStatus === "unsaved" || saveStatus === "saving"
                ? "text-zinc-400"
                : "text-green-600"
            }`}
          >
            {saveLabel}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleDownload}
            className="text-sm px-3 py-1.5 border border-zinc-300 rounded-md hover:bg-zinc-50 transition-colors text-zinc-700"
          >
            Download PDF
          </button>
          <button
            onClick={handleEmail}
            disabled={emailStatus === "sending"}
            className="text-sm px-3 py-1.5 border border-zinc-300 rounded-md hover:bg-zinc-50 transition-colors text-zinc-700 disabled:opacity-50"
          >
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
            className="text-sm px-3 py-1.5 bg-zinc-900 text-white rounded-md hover:bg-zinc-700 transition-colors"
          >
            {applyStatus === "done" ? "Applied ✓" : "Mark as applied"}
          </button>
        </div>
      </div>

      {/* Apply form */}
      {showApplyForm && (
        <div className="bg-zinc-50 border-b border-zinc-200 px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-600 font-medium">Status</label>
            <select
              value={applyForm.status}
              onChange={(e) => setApplyForm((f) => ({ ...f, status: e.target.value }))}
              className="border border-zinc-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              <option value="applied">Applied</option>
              <option value="interviewing">Interviewing</option>
              <option value="offer">Offer</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-600 font-medium">Date</label>
            <input
              type="date"
              value={applyForm.appliedAt}
              onChange={(e) => setApplyForm((f) => ({ ...f, appliedAt: e.target.value }))}
              className="border border-zinc-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <button
            onClick={handleApply}
            disabled={applyStatus === "saving"}
            className="text-xs px-3 py-1.5 bg-zinc-900 text-white rounded hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            {applyStatus === "saving" ? "Saving…" : applyStatus === "error" ? "Failed" : "Confirm"}
          </button>
          <button
            onClick={() => setShowApplyForm(false)}
            className="text-xs text-zinc-400 hover:text-zinc-600"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Editor */}
      <textarea
        value={markdown}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        className="flex-1 w-full resize-none font-mono text-sm leading-relaxed text-zinc-800 bg-white px-10 py-8 focus:outline-none min-h-[600px]"
        style={{ fontFamily: "var(--font-geist-mono), 'Courier New', monospace" }}
      />
    </div>
  );
}
