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
          <circle cx="28" cy="28" r={r} fill="none" stroke="#e5e7eb" strokeWidth="3.5" />
          <circle
            cx="28" cy="28" r={r}
            fill="none"
            stroke={color}
            strokeWidth="3.5"
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900">
          {score}
        </span>
      </div>
      <span className="text-[10px] text-gray-400 mt-1">Match Score</span>
    </div>
  );
}

export default function ResumeCard({
  resume,
  editedAgo,
}: {
  resume: ResumeListItem;
  editedAgo: string;
}) {
  const date = new Date(resume.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow flex flex-col gap-3">
      {/* Top: title + menu */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">
            {resume.job_title ?? "Untitled"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {resume.company ?? "—"}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {date} &bull; Edited {editedAgo}
          </p>
        </div>
        <button className="text-gray-400 hover:text-gray-600 p-0.5 flex-shrink-0 mt-0.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      </div>

      {/* Bottom: score + actions */}
      <div className="flex items-end justify-between pt-2 border-t border-gray-100">
        {resume.critic_score != null ? (
          <ScoreCircle score={resume.critic_score} />
        ) : (
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full border-2 border-dashed border-gray-200 flex items-center justify-center">
              <span className="text-xs text-gray-400">—</span>
            </div>
            <span className="text-[10px] text-gray-400 mt-1">Match Score</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Link
            href={`/resume/${resume.id}?view=split`}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            View PDF
          </Link>
          <Link
            href={`/resume/${resume.id}`}
            className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 border border-violet-200 hover:border-violet-400 px-2.5 py-1.5 rounded-lg transition-colors"
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
