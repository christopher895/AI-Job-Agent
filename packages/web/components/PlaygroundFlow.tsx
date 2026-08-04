"use client";
import { useState } from "react";
import { playgroundApi, PlaygroundSuggestion } from "../lib/playground-api";
import { MasterResume } from "../lib/api";

type Step = "input" | "review" | "result";

export default function PlaygroundFlow() {
  const [step, setStep] = useState<Step>("input");
  const [resumeText, setResumeText] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [fetchStatus, setFetchStatus] = useState<"idle" | "fetching" | "done" | "failed">("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [masterResume, setMasterResume] = useState<MasterResume | null>(null);
  const [suggestions, setSuggestions] = useState<PlaygroundSuggestion[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);

  async function handleFetchJd() {
    const trimmed = jobUrl.trim();
    if (!trimmed) return;
    setFetchStatus("fetching");
    setError(null);
    try {
      const { text } = await playgroundApi.fetchJd(trimmed);
      setJdText(text);
      setFetchStatus("done");
    } catch {
      setFetchStatus("failed");
      setError("Couldn't fetch this page — paste the job description below.");
    }
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if ((!resumeText.trim() && !resumeFile) || !apiKey.trim() || !jdText.trim()) {
      setError("Provide your resume (paste or upload), an API key, and a job description first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const parsed = resumeFile
        ? await playgroundApi.parseResumeFile(resumeFile, apiKey)
        : await playgroundApi.parseResumeText(resumeText, apiKey);
      setMasterResume(parsed);
      const { suggestions: raw } = await playgroundApi.suggest(parsed, jdText, apiKey);
      setSuggestions(raw);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function toggleSuggestion(id: string) {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, accepted: !s.accepted } : s))
    );
  }

  function editSuggestionText(id: string, text: string) {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, suggestedText: text } : s))
    );
  }

  async function handleApply() {
    if (!masterResume) return;
    setLoading(true);
    setError(null);
    try {
      const accepted = suggestions.filter((s) => s.accepted);
      const { markdown: finalMarkdown, pdfBase64: finalPdf } = await playgroundApi.apply(
        masterResume,
        accepted,
        apiKey
      );
      setMarkdown(finalMarkdown);
      setPdfBase64(finalPdf);
      setStep("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleStartOver() {
    setStep("input");
    setResumeText("");
    setResumeFile(null);
    setJobUrl("");
    setJdText("");
    setFetchStatus("idle");
    setMasterResume(null);
    setSuggestions([]);
    setMarkdown("");
    setPdfBase64(null);
    setError(null);
  }

  if (step === "input") {
    return (
      <form onSubmit={handleStart} className="bg-paper border border-paper-border rounded-xl p-6 flex flex-col gap-5">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-paper-ink">Your resume</label>
            <label className="text-xs text-violet-700 hover:text-violet-900 cursor-pointer underline underline-offset-2">
              {resumeFile ? `Uploaded: ${resumeFile.name} (change)` : "Upload a PDF instead"}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setResumeFile(file ?? null);
                  if (file) setResumeText("");
                }}
              />
            </label>
          </div>
          {!resumeFile && (
            <textarea
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              placeholder="Paste your resume text here…"
              rows={8}
              className="w-full border border-paper-border rounded-lg px-3 py-2.5 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white resize-y"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Anthropic API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            className="w-full border border-paper-border rounded-lg px-3 py-2 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          />
          <p className="text-xs text-paper-muted mt-1.5">Never stored — used only for this request.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Job URL (optional)</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={jobUrl}
              onChange={(e) => {
                setJobUrl(e.target.value);
                if (fetchStatus !== "idle") setFetchStatus("idle");
              }}
              placeholder="https://boards.greenhouse.io/company/jobs/1234567"
              className="flex-1 border border-paper-border rounded-lg px-3 py-2 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
            />
            <button
              type="button"
              onClick={handleFetchJd}
              disabled={fetchStatus === "fetching" || !jobUrl.trim()}
              className="flex-shrink-0 px-4 py-2 border border-paper-border rounded-lg text-sm font-medium text-paper-ink hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors bg-white"
            >
              {fetchStatus === "fetching" ? "Fetching…" : "Fetch JD"}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Job description</label>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the job description here…"
            rows={8}
            className="w-full border border-paper-border rounded-lg px-3 py-2.5 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white resize-y"
          />
        </div>

        {error && (
          <div className="bg-red-100 border border-red-300 text-red-800 rounded-lg px-3 py-2.5 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Generating suggestions…" : "Generate suggestions"}
        </button>
      </form>
    );
  }

  if (step === "review") {
    const acceptedCount = suggestions.filter((s) => s.accepted).length;
    return (
      <div className="bg-paper border border-paper-border rounded-xl p-6 flex flex-col gap-4">
        <p className="text-sm text-paper-muted">
          Review each suggested change before it&apos;s applied. Uncheck anything you
          don&apos;t want, or edit the wording directly.
        </p>

        {suggestions.length === 0 ? (
          <p className="text-sm text-paper-muted">
            No keyword suggestions found for this job description — your resume already covers it well.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {suggestions.map((s) => (
              <label
                key={s.id}
                className="flex gap-3 border border-paper-border rounded-xl p-3 bg-white hover:border-violet-300 transition-colors cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!!s.accepted}
                  onChange={() => toggleSuggestion(s.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-paper-ink">{s.keyword}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        s.groundedness === "grounded"
                          ? "bg-green-100 text-green-800 border border-green-300"
                          : "bg-amber-100 text-amber-800 border border-amber-300"
                      }`}
                    >
                      {s.groundedness}
                    </span>
                  </div>
                  {s.kind === "bullet-rewrite" ? (
                    <textarea
                      value={s.suggestedText}
                      onChange={(e) => editSuggestionText(s.id, e.target.value)}
                      rows={2}
                      onClick={(e) => e.preventDefault()}
                      className="w-full text-sm font-mono border border-paper-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none bg-white text-paper-ink"
                    />
                  ) : (
                    <p className="text-sm font-medium text-paper-ink">
                      Add &quot;{s.suggestedText}&quot; to {s.targetId}
                    </p>
                  )}
                  <p className="text-xs text-paper-muted mt-1">{s.rationale}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-100 border border-red-300 text-red-800 rounded-lg px-3 py-2.5 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleApply}
          disabled={loading}
          className="bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading
            ? "Finalizing…"
            : suggestions.length === 0
            ? "Continue with resume as-is"
            : `Apply ${acceptedCount} selected`}
        </button>
      </div>
    );
  }

  const pdfDataUrl = pdfBase64 ? `data:application/pdf;base64,${pdfBase64}` : null;

  return (
    <div className="bg-paper border border-paper-border rounded-xl p-6 flex flex-col gap-4">
      <p className="text-sm text-paper-muted">Your tailored resume is ready.</p>

      {pdfDataUrl ? (
        <div className="border border-paper-border rounded-lg overflow-hidden" style={{ height: "70vh" }}>
          <iframe src={pdfDataUrl} className="w-full h-full border-0" title="Tailored resume PDF" />
        </div>
      ) : (
        <div className="border border-paper-border rounded-lg p-4 bg-white">
          <pre className="text-xs font-mono whitespace-pre-wrap text-paper-ink">{markdown}</pre>
        </div>
      )}

      <div className="flex gap-3">
        {pdfDataUrl && (
          <a
            href={pdfDataUrl}
            download="tailored-resume.pdf"
            className="flex-1 text-center bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-lg text-sm transition-colors"
          >
            Download PDF
          </a>
        )}
        <button
          onClick={handleStartOver}
          className="flex-1 border border-paper-border hover:bg-black/5 text-paper-ink font-medium py-3 rounded-lg text-sm transition-colors bg-white"
        >
          Start over
        </button>
      </div>
    </div>
  );
}
