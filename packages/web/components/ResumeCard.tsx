import Link from "next/link";
import { ResumeListItem, api } from "../lib/api";

export default function ResumeCard({ resume }: { resume: ResumeListItem }) {
  const date = new Date(resume.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const score = resume.critic_score;
  const scoreBadge =
    score == null
      ? null
      : score >= 80
      ? "bg-green-50 text-green-700 border-green-200"
      : score >= 60
      ? "bg-yellow-50 text-yellow-700 border-yellow-200"
      : "bg-red-50 text-red-700 border-red-200";

  return (
    <div className="bg-white border border-zinc-200 rounded-lg px-5 py-4 flex items-center justify-between gap-4 hover:border-zinc-300 transition-colors">
      <div className="min-w-0">
        <div className="font-medium text-zinc-900 truncate">
          {resume.job_title ?? "Untitled"}{" "}
          {resume.company ? (
            <span className="text-zinc-500 font-normal">— {resume.company}</span>
          ) : null}
        </div>
        <div className="text-xs text-zinc-400 mt-0.5">{date}</div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {score != null && scoreBadge && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${scoreBadge}`}>
            {score}/100
          </span>
        )}
        <a
          href={api.pdfUrl(resume.id)}
          className="text-sm text-zinc-400 hover:text-zinc-700 transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          PDF
        </a>
        <Link
          href={`/resume/${resume.id}`}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          Edit →
        </Link>
      </div>
    </div>
  );
}
