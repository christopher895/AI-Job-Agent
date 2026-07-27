"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { api, Resume } from "../lib/api";
import ResumeEditor from "./ResumeEditor";

export default function GeneralResumeTab() {
  const [resume, setResume] = useState<Resume | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const hasAttemptedLoadRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const row = await api.getGeneralResume();
      setResume(row);
    } catch (e) {
      if (e instanceof Error && e.message === "Not found") {
        setNotFound(true);
      } else {
        setLoadError(e instanceof Error ? e.message : "Failed to load the general resume.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasAttemptedLoadRef.current) {
      hasAttemptedLoadRef.current = true;
      load();
    }
  }, [load]);

  async function handleGenerate(isResync: boolean) {
    if (
      isResync &&
      !window.confirm("Regenerating will overwrite your manual edits to the general resume. Continue?")
    ) {
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      await api.generateGeneralResume();
      await load();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Failed to start generation.");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading…</div>
    );
  }

  if (loadError) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-red-600 px-6 text-center">
        {loadError}
      </div>
    );
  }

  if (notFound || !resume) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-gray-500 max-w-sm">
          No general resume yet. Generate a one-page, JD-less resume from your Master Resume — good
          for career fairs, cold outreach, or anywhere you don&apos;t have a specific job description.
        </p>
        <button
          onClick={() => handleGenerate(false)}
          disabled={generating}
          className="text-sm px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {generating ? "Generating…" : "Generate General Resume"}
        </button>
        {genError && <p className="text-xs text-red-600">{genError}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200 px-4 py-2 flex items-center justify-between flex-shrink-0 bg-white">
        <span className="text-xs font-medium text-gray-600">General Resume — synced from Master</span>
        <div className="flex items-center gap-2">
          {genError && <span className="text-xs text-red-600">{genError}</span>}
          <button
            onClick={() => handleGenerate(true)}
            disabled={generating}
            className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {generating ? "Syncing…" : "Sync from Master ⟳"}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResumeEditor resume={resume} key={resume.updated_at} />
      </div>
    </div>
  );
}
