"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ResumeListItem } from "../lib/api";

function ScoreCircle({ score }: { score: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : "#ef4444";

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-14 h-14">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r={r} fill="none" stroke="#e4dcc4" strokeWidth="3.5" />
          <circle
            cx="28" cy="28" r={r}
            fill="none"
            stroke={color}
            strokeWidth="3.5"
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-paper-ink">
          {score}
        </span>
      </div>
      <span className="text-[10px] text-paper-muted mt-1">Match Score</span>
    </div>
  );
}

export default function ResumeCard({
  resume,
  editedAgo,
  onDelete,
}: {
  resume: ResumeListItem;
  editedAgo: string;
  onDelete: (id: string) => void;
}) {
  const date = new Date(resume.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

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
            aria-label="Resume actions"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-32 bg-paper border border-paper-border rounded-lg shadow-lg py-1 z-10">
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

      {/* Bottom: score + actions */}
      <div className="flex items-end justify-between pt-2 border-t border-paper-border">
        {resume.critic_score != null ? (
          <ScoreCircle score={resume.critic_score} />
        ) : (
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full border-2 border-dashed border-paper-border flex items-center justify-center">
              <span className="text-xs text-paper-muted">—</span>
            </div>
            <span className="text-[10px] text-paper-muted mt-1">Match Score</span>
          </div>
        )}

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
