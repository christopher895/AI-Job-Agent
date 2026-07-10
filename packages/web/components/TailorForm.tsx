"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";

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
  const [generating, setGenerating] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logStatus, setLogStatus] = useState<"idle" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleFetchJd() {
    const trimmed = jobUrl.trim();
    if (!trimmed) return;
    setFetchStatus("fetching");
    setError(null);
    try {
      const { text, title: fetchedTitle, company: fetchedCompany, location: fetchedLocation } =
        await api.fetchJd(trimmed);
      setJdText(text);
      setTitle((current) => (current.trim() ? current : fetchedTitle ?? current));
      setCompany((current) => (current.trim() ? current : fetchedCompany ?? current));
      setLocation((current) => (current.trim() ? current : fetchedLocation ?? current));
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
        appliedAt: new Date().toISOString().split("T")[0],
      });
      setLogStatus("done");
      setTimeout(() => setLogStatus("idle"), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add to the log. Try again.");
    } finally {
      setLogging(false);
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
      const result = await api.tailorResume({
        jdText: jd || undefined,
        jobUrl: !jd && url ? url : undefined,
        jobTitle: title.trim() || undefined,
        company: company.trim() || undefined,
      });
      if (result.fetchMethod === "failed") {
        setError("Couldn't fetch the job page — paste the job description below.");
        setGenerating(false);
        return;
      }
      router.push(`/resume/${result.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed. Try again.");
      setGenerating(false);
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Tailor a New Resume</h1>
        <p className="text-sm text-gray-500 mt-1">
          Paste a job link or description and we&apos;ll tailor your resume.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {/* Job URL */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Job URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={jobUrl}
              onChange={(e) => {
                setJobUrl(e.target.value);
                if (fetchStatus !== "idle") setFetchStatus("idle");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleFetchJd()}
              placeholder="https://boards.greenhouse.io/vercel/jobs/1234567"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
            />
            <button
              onClick={handleFetchJd}
              disabled={fetchStatus === "fetching" || !jobUrl.trim()}
              className="flex-shrink-0 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors bg-white"
            >
              {fetchStatus === "fetching" ? "Fetching…" : "Fetch JD"}
            </button>
          </div>
          {fetchStatus === "done" && (
            <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Job description fetched successfully
            </p>
          )}
          {fetchStatus === "failed" && (
            <p className="text-xs text-red-600 mt-1.5">
              Could not fetch — paste the description below.
            </p>
          )}
        </div>

        {/* Job Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Job Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Frontend Engineer"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          />
        </div>

        {/* Company */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Company</label>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Vercel"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          />
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Location</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="San Francisco, CA"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          />
        </div>

        {/* Job Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Job Description</label>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the full job description here…"
            rows={10}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white resize-y"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          {/* Add to Log — logs the application to Google Sheets without generating a resume */}
          <button
            onClick={handleAddToLog}
            disabled={logging || logStatus === "done"}
            title="Log this application to Google Sheets without generating a resume"
            className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-3 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors bg-white"
          >
            {logging ? "Adding…" : logStatus === "done" ? "Added to log ✓" : "Add to Log"}
          </button>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex-[2] bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? (
              <>
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Generating… (this takes ~30s)
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
