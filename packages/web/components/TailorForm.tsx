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
  const [fetchStatus, setFetchStatus] = useState<"idle" | "fetching" | "done" | "failed">("idle");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleUrlBlur() {
    const trimmed = jobUrl.trim();
    if (!trimmed || jdText) return;
    setFetchStatus("fetching");
    setError(null);
    try {
      const { text } = await api.fetchJd(trimmed);
      setJdText(text);
      setFetchStatus("done");
    } catch {
      setFetchStatus("failed");
      setError("Couldn't fetch this page — paste the job description below.");
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
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="text-xl font-semibold text-zinc-900 mb-8">Tailor Resume</h1>

      <div className="flex flex-col gap-5">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">Job URL</label>
          <input
            type="url"
            value={jobUrl}
            onChange={(e) => setJobUrl(e.target.value)}
            onBlur={handleUrlBlur}
            placeholder="https://jobs.example.com/..."
            className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white"
          />
          {fetchStatus === "fetching" && (
            <p className="text-xs text-zinc-400 mt-1">Fetching job description…</p>
          )}
          {fetchStatus === "done" && (
            <p className="text-xs text-green-600 mt-1">Job description fetched.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">
            Job description
            <span className="text-zinc-400 font-normal ml-1">(or paste manually)</span>
          </label>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the full job description here…"
            rows={12}
            className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white resize-y font-mono"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              Job title <span className="text-zinc-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Software Engineer Intern"
              className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              Company <span className="text-zinc-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Corp"
              className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white"
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="bg-zinc-900 text-white text-sm px-5 py-2.5 rounded-md hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-fit"
        >
          {generating ? "Generating… (this takes ~30s)" : "Generate tailored resume"}
        </button>
      </div>
    </div>
  );
}
