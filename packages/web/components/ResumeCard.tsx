"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ResumeListItem } from "../lib/api";

export default function ResumeCard({
  resume,
  editedAgo,
  onDelete,
  onDuplicate,
}: {
  resume: ResumeListItem;
  editedAgo: string;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => Promise<void>;
}) {
  const date = new Date(resume.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (duplicating) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen, duplicating]);

  // Only a settled resume can be copied — the route 409s on one mid-generation.
  const canDuplicate = resume.status === "ready" || resume.status === "awaiting_review";

  async function handleDuplicate() {
    if (duplicating) return;
    setDuplicating(true);
    try {
      await onDuplicate(resume.id);
      setMenuOpen(false);
    } finally {
      // The menu stays open while the POST is in flight so the button can show
      // progress and refuse a second click — two clicks would make two copies.
      setDuplicating(false);
    }
  }

  function handleDelete() {
    setMenuOpen(false);
    const label = [resume.job_title, resume.company].filter(Boolean).join(" @ ") || "this resume";
    if (window.confirm(`Delete ${label}? This can't be undone.`)) {
      onDelete(resume.id);
    }
  }

  return (
    <div className="bg-paper border border-paper-border rounded-xl p-4 hover:shadow-lg hover:shadow-black/20 transition-shadow flex flex-col gap-3">
      {/* Top: title + menu */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-paper-ink text-sm truncate">
            {resume.job_title?.trim() || "Untitled"}
          </p>
          <p className="text-xs text-paper-muted mt-0.5 truncate">
            {resume.company?.trim() || "—"}
          </p>
          <p className="text-xs text-paper-muted/80 mt-1 flex items-center gap-1.5">
            {date} &bull; Edited {editedAgo}
            {resume.status === "pending" && (
              <span className="text-amber-700 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5 text-[10px] font-medium">
                Generating…
              </span>
            )}
            {resume.status === "awaiting_review" && (
              <span className="text-violet-700 bg-violet-100 border border-violet-300 rounded px-1.5 py-0.5 text-[10px] font-medium">
                Needs review
              </span>
            )}
            {resume.status === "failed" && (
              <span className="text-red-700 bg-red-100 border border-red-300 rounded px-1.5 py-0.5 text-[10px] font-medium">
                Failed
              </span>
            )}
            {resume.status === "cancelled" && (
              <span className="text-paper-muted bg-black/5 border border-paper-border rounded px-1.5 py-0.5 text-[10px] font-medium">
                Cancelled
              </span>
            )}
          </p>
        </div>
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="text-paper-muted hover:text-paper-ink p-0.5 mt-0.5"
            aria-label={duplicating ? "Duplicating resume" : "Resume actions"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-paper border border-paper-border rounded-lg shadow-lg py-1 z-10">
              <button
                onClick={handleDuplicate}
                disabled={!canDuplicate || duplicating}
                title={canDuplicate ? undefined : "Available once this resume finishes generating"}
                className="w-full text-left px-3 py-1.5 text-xs text-paper-ink hover:bg-black/[0.04] disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {duplicating ? "Duplicating…" : "Duplicate"}
              </button>
              <button
                onClick={handleDelete}
                className="w-full text-left px-3 py-1.5 text-xs text-red-700 hover:bg-red-100"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: actions */}
      <div className="flex items-end justify-end pt-2 border-t border-paper-border">
        <div className="flex items-center gap-2">
          <Link
            href={`/resume/${resume.id}?view=split`}
            className="flex items-center gap-1.5 text-xs text-paper-muted hover:text-paper-ink border border-paper-border hover:border-paper-ink/30 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            View PDF
          </Link>
          <Link
            href={`/resume/${resume.id}`}
            className="flex items-center gap-1.5 text-xs text-violet-700 hover:text-violet-900 border border-violet-300 hover:border-violet-500 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </Link>
        </div>
      </div>
    </div>
  );
}
