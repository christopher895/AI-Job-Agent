"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApplicationAnswersState } from "../lib/api";
import ApplicationAnswers from "./ApplicationAnswers";

export default function TailorForm({
  initialJobUrl = "",
  initialTitle = "",
  initialCompany = "",
}: {
  initialJobUrl?: string;
  initialTitle?: string;
  initialCompany?: string;
}) {
  const [jobUrl, setJobUrl] = useState(initialJobUrl);
  const [jdText, setJdText] = useState("");
  const [title, setTitle] = useState(initialTitle);
  const [company, setCompany] = useState(initialCompany);
  const [location, setLocation] = useState("");
  const [fetchStatus, setFetchStatus] = useState<"idle" | "fetching" | "done" | "failed">("idle");
  const [questions, setQuestions] = useState("");
  const [answersResumeId, setAnswersResumeId] = useState<string | null>(null);
  const [answersState, setAnswersState] = useState<ApplicationAnswersState | null>(null);
  const [draftingAnswers, setDraftingAnswers] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logStatus, setLogStatus] = useState<"idle" | "done" | "duplicate">("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const isEmpty = !jobUrl && !jdText && !title && !company && !location && !questions;

  async function handleFetchJd() {
    const trimmed = jobUrl.trim();
    if (!trimmed) return;
    setFetchStatus("fetching");
    setError(null);
    try {
      const { text, title: fetchedTitle, company: fetchedCompany, location: fetchedLocation } =
        await api.fetchJd(trimmed);
      setJdText(text);
      setTitle((current) => fetchedTitle ?? current);
      setCompany((current) => fetchedCompany ?? current);
      setLocation((current) => fetchedLocation ?? current);
      setFetchStatus("done");
    } catch {
      setFetchStatus("failed");
      setError("Couldn't fetch this page — paste the job description below.");
    }
  }

  async function handleAddToLog() {
    if (!company.trim() || !title.trim()) {
      setError("Enter a job title and company before adding to the log.");
      return;
    }
    setLogging(true);
    setError(null);
    try {
      await api.postApplied({
        company: company.trim(),
        jobTitle: title.trim(),
        location: location.trim() || undefined,
        jobUrl: jobUrl.trim() || undefined,
        appliedAt: new Date().toISOString(),
      });
      setLogStatus("done");
      setTimeout(() => setLogStatus("idle"), 3000);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't add to the log. Try again.";
      setError(message);
      if (message === "This job is already in your applied log.") {
        setLogStatus("duplicate");
      }
    } finally {
      setLogging(false);
    }
  }

  function handleClear() {
    setJobUrl("");
    setJdText("");
    setTitle("");
    setCompany("");
    setLocation("");
    setQuestions("");
    setAnswersResumeId(null);
    setAnswersState(null);
    setDraftingAnswers(false);
    setFetchStatus("idle");
    setLogStatus("idle");
    setError(null);
  }

  async function handleGenerateAnswers() {
    const jd = jdText.trim();
    const url = jobUrl.trim();
    const text = questions.trim();
    if (!text) {
      setError("Paste the application questions below.");
      return;
    }
    if (!jd && !url) {
      setError("Paste a job description (or fetch one from a URL) so the answers can use it.");
      return;
    }
    setDraftingAnswers(true);
    setError(null);
    try {
      const result = await api.startAnswers({
        text,
        jdText: jd || undefined,
        jobUrl: url || undefined,
        jobTitle: title.trim() || undefined,
        company: company.trim() || undefined,
        location: location.trim() || undefined,
      });
      setAnswersResumeId(result.id);
      setAnswersState({
        status: "generating",
        prompt: text,
        items: [],
        error: null,
        generated_at: null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start answer drafts.");
    } finally {
      setDraftingAnswers(false);
    }
  }

  async function handleGenerate() {
    const jd = jdText.trim();
    const url = jobUrl.trim();
    if (!jd && !url) {
      setError("Enter a job URL or paste the job description.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      // Returns as soon as the job is queued — the tailoring pipeline keeps running
      // server-side and the resume page polls until it's ready. Waiting here would
      // hold the connection open past Railway's edge-proxy timeout.
      const result = await api.tailorResume({
        jdText: jd || undefined,
        jobUrl: url || undefined,
        jobTitle: title.trim() || undefined,
        company: company.trim() || undefined,
        location: location.trim() || undefined,
      });
      router.push(`/resume/${result.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed. Try again.");
      setGenerating(false);
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Tailor a New Resume</h1>
          <p className="text-sm text-gray-500 mt-1.5">
            Paste a job link or description to tailor your resume, or just draft application answers.
          </p>
        </div>
        <button
          onClick={handleClear}
          disabled={isEmpty || generating || draftingAnswers}
          title="Clear every field on this form"
          className="flex-shrink-0 mt-1 px-3 py-1.5 border border-paper-border rounded-lg text-sm font-medium text-paper-ink hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors bg-white"
        >
          Clear
        </button>
      </div>

      <div className="bg-paper border border-paper-border rounded-xl p-6 flex flex-col gap-5">
        {/* Job URL */}
        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Job URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={jobUrl}
              onChange={(e) => {
                setJobUrl(e.target.value);
                if (fetchStatus !== "idle") setFetchStatus("idle");
                if (logStatus === "duplicate") setLogStatus("idle");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleFetchJd()}
              placeholder="https://boards.greenhouse.io/vercel/jobs/1234567"
              className="flex-1 border border-paper-border rounded-lg px-3 py-2 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
            />
            <button
              onClick={handleFetchJd}
              disabled={fetchStatus === "fetching" || !jobUrl.trim()}
              className="flex-shrink-0 px-4 py-2 border border-paper-border rounded-lg text-sm font-medium text-paper-ink hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors bg-white"
            >
              {fetchStatus === "fetching" ? "Fetching…" : "Fetch JD"}
            </button>
          </div>
          {fetchStatus === "done" && (
            <p className="text-xs text-green-700 mt-1.5 flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Job description fetched successfully
            </p>
          )}
          {fetchStatus === "failed" && (
            <p className="text-xs text-red-700 mt-1.5">
              Could not fetch — paste the description below.
            </p>
          )}
        </div>

        {/* Job Title */}
        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Job Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (logStatus === "duplicate") setLogStatus("idle");
            }}
            placeholder="Frontend Engineer"
            className="w-full border border-paper-border rounded-lg px-3 py-2 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          />
        </div>

        {/* Company */}
        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Company</label>
          <input
            type="text"
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              if (logStatus === "duplicate") setLogStatus("idle");
            }}
            placeholder="Vercel"
            className="w-full border border-paper-border rounded-lg px-3 py-2 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          />
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Location</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="San Francisco, CA"
            className="w-full border border-paper-border rounded-lg px-3 py-2 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          />
        </div>

        {/* Job Description */}
        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Job Description</label>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the full job description here…"
            rows={10}
            className="w-full border border-paper-border rounded-lg px-3 py-2.5 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white resize-y"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-paper-ink mb-1.5">Application questions</label>
          <p className="text-xs text-paper-muted mb-1.5">
            Optional. Paste the form questions if you want drafts without tailoring a resume. Uses the
            job description above and your master resume.
          </p>
          <textarea
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            placeholder={"Tell us about a project you built on your own initiative…\n\nWhy are you interested in this role?"}
            rows={6}
            className="w-full border border-paper-border rounded-lg px-3 py-2.5 text-sm text-paper-ink placeholder:text-paper-muted focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white resize-y"
          />
        </div>

        {answersResumeId && (
          <div className="flex flex-col gap-2">
            <Link
              href={`/resume/${answersResumeId}`}
              className="text-xs text-violet-700 hover:text-violet-900 underline underline-offset-2 w-fit"
            >
              Open these drafts on the resume page
            </Link>
            <ApplicationAnswers
              key={answersResumeId}
              resumeId={answersResumeId}
              initial={answersState}
              hasJd={Boolean(jdText.trim() || jobUrl.trim())}
              company={company}
              variant="card"
              hideComposer
            />
          </div>
        )}

        {error && (
          <div className="bg-red-100 border border-red-300 text-red-800 rounded-lg px-3 py-2.5 text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          {/* Add to Log — logs the application to Google Sheets without generating a resume */}
          <button
            onClick={handleAddToLog}
            disabled={logging || logStatus === "done" || logStatus === "duplicate"}
            title="Log this application to Google Sheets without generating a resume"
            className="flex-1 border border-paper-border hover:bg-black/5 text-paper-ink font-medium py-3 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors bg-white"
          >
            {logging ? "Adding…" : logStatus === "done" ? "Added to log ✓" : logStatus === "duplicate" ? "Already in log" : "Add to Log"}
          </button>

          <button
            onClick={handleGenerateAnswers}
            disabled={draftingAnswers || generating || !questions.trim()}
            title="Draft answers from the job description without tailoring a resume"
            className="flex-1 border border-violet-300 hover:bg-violet-50 text-violet-800 font-medium py-3 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors bg-white"
          >
            {draftingAnswers ? "Starting…" : answersResumeId ? "Regenerate answers" : "Generate answers"}
          </button>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating || draftingAnswers}
            className="flex-[2] bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? (
              <>
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Starting…
              </>
            ) : (
              "Generate Tailored Resume ✨"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
