"use client";
import { useState } from "react";
import Link from "next/link";
import { AppliedJob, api } from "../lib/api";

const STATUSES = ["applied", "interviewing", "assessment", "no_response", "offer", "rejected"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  applied: { label: "Applied", className: "bg-green-100 text-green-700" },
  interviewing: { label: "Interview", className: "bg-cyan-100 text-cyan-700" },
  assessment: { label: "Assessment", className: "bg-orange-100 text-orange-700" },
  no_response: { label: "No Response", className: "bg-gray-100 text-gray-500" },
  offer: { label: "Offer", className: "bg-violet-100 text-violet-700" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-600" },
};

const COMPANY_COLORS = [
  "bg-slate-700",
  "bg-blue-600",
  "bg-green-600",
  "bg-orange-500",
  "bg-violet-600",
  "bg-pink-600",
  "bg-teal-600",
  "bg-red-600",
];

function CompanyAvatar({ name }: { name: string }) {
  const color = COMPANY_COLORS[name.charCodeAt(0) % COMPANY_COLORS.length];
  return (
    <div
      className={`w-8 h-8 rounded-full ${color} flex items-center justify-center text-white text-xs font-semibold flex-shrink-0`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function StatusBadge({
  status,
  id,
  updating,
  onChange,
}: {
  status: string;
  id: string;
  updating: boolean;
  onChange: (status: string) => void;
}) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: "bg-gray-100 text-gray-500" };
  return (
    <div className="relative inline-block">
      <select
        value={status}
        onChange={(e) => onChange(e.target.value)}
        disabled={updating}
        className={`appearance-none cursor-pointer text-xs font-medium px-2.5 py-1 rounded-full pr-6 border-0 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 ${config.className}`}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_CONFIG[s]?.label ?? s}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 opacity-60"
        width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}

export default function AppliedTable({ initial }: { initial: AppliedJob[] }) {
  const [jobs, setJobs] = useState<AppliedJob[]>(initial);
  const [updating, setUpdating] = useState<string | null>(null);

  async function handleStatusChange(id: string, status: string) {
    setUpdating(id);
    try {
      const updated = await api.patchApplied(id, status);
      setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
    } catch {
      // keep old value
    } finally {
      setUpdating(null);
    }
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-24 text-gray-400">
        <p className="text-base mb-1">No applications logged yet</p>
        <p className="text-sm">
          Use{" "}
          <span className="text-gray-600">&ldquo;Mark as applied&rdquo;</span> in the resume editor
          to add one.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
            <th className="py-3 px-4 font-medium">Company</th>
            <th className="py-3 px-4 font-medium">Role</th>
            <th className="py-3 px-4 font-medium">Date Applied</th>
            <th className="py-3 px-4 font-medium">Status</th>
            <th className="py-3 px-4 font-medium">Source</th>
            <th className="py-3 px-4 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const date = new Date(job.applied_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });

            return (
              <tr key={job.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <CompanyAvatar name={job.company} />
                    <span className="font-medium text-gray-900">{job.company}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-gray-600">{job.job_title}</td>
                <td className="py-3 px-4 text-gray-500 whitespace-nowrap">{date}</td>
                <td className="py-3 px-4">
                  <StatusBadge
                    status={job.status}
                    id={job.id}
                    updating={updating === job.id}
                    onChange={(s) => handleStatusChange(job.id, s)}
                  />
                </td>
                <td className="py-3 px-4 text-gray-400 text-xs">
                  {job.job_url ? (
                    <a
                      href={job.job_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-600 hover:text-violet-800 underline underline-offset-2"
                    >
                      View posting
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    {job.resume_id ? (
                      <Link
                        href={`/resume/${job.resume_id}`}
                        className="text-xs text-violet-600 hover:text-violet-800 transition-colors"
                      >
                        Resume
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                    {job.resume_id && (
                      <a
                        href={api.pdfUrl(job.resume_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        PDF
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
        Showing 1 to {jobs.length} of {jobs.length} result{jobs.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
