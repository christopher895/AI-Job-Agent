"use client";
import { useState } from "react";
import Link from "next/link";
import { AppliedJob, api } from "../lib/api";

const STATUSES = ["applied", "interviewing", "offer", "rejected"] as const;
type Status = (typeof STATUSES)[number];

const statusColors: Record<Status, string> = {
  applied: "bg-blue-50 text-blue-700",
  interviewing: "bg-yellow-50 text-yellow-700",
  offer: "bg-green-50 text-green-700",
  rejected: "bg-zinc-100 text-zinc-500",
};

export default function AppliedTable({ initial }: { initial: AppliedJob[] }) {
  const [jobs, setJobs] = useState<AppliedJob[]>(initial);
  const [updating, setUpdating] = useState<string | null>(null);

  async function handleStatusChange(id: string, status: string) {
    setUpdating(id);
    try {
      const updated = await api.patchApplied(id, status);
      setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
    } catch {
      // keep old value on error
    } finally {
      setUpdating(null);
    }
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-24 text-zinc-400">
        <p className="text-base mb-1">No applications logged yet</p>
        <p className="text-sm">
          Use <span className="text-zinc-600">&ldquo;Mark as applied&rdquo;</span> in the resume editor to add one.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-200">
            <th className="py-3 pr-4 font-medium">Date</th>
            <th className="py-3 pr-4 font-medium">Company</th>
            <th className="py-3 pr-4 font-medium">Role</th>
            <th className="py-3 pr-4 font-medium">Location</th>
            <th className="py-3 pr-4 font-medium">Link</th>
            <th className="py-3 pr-4 font-medium">Status</th>
            <th className="py-3 font-medium">Resume</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const date = new Date(job.applied_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const status = job.status as Status;
            const colorClass = statusColors[status] ?? "bg-zinc-100 text-zinc-500";

            return (
              <tr key={job.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                <td className="py-3 pr-4 text-zinc-500 whitespace-nowrap">{date}</td>
                <td className="py-3 pr-4 font-medium text-zinc-900">{job.company}</td>
                <td className="py-3 pr-4 text-zinc-700">{job.job_title}</td>
                <td className="py-3 pr-4 text-zinc-500">{job.location ?? "—"}</td>
                <td className="py-3 pr-4">
                  {job.job_url ? (
                    <a
                      href={job.job_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 underline underline-offset-2"
                    >
                      View
                    </a>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </td>
                <td className="py-3 pr-4">
                  <select
                    value={job.status}
                    onChange={(e) => handleStatusChange(job.id, e.target.value)}
                    disabled={updating === job.id}
                    className={`text-xs font-medium px-2 py-1 rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-zinc-400 cursor-pointer disabled:opacity-50 ${colorClass}`}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-3">
                  {job.resume_id ? (
                    <Link
                      href={`/resume/${job.resume_id}`}
                      className="text-blue-600 hover:text-blue-800 underline underline-offset-2"
                    >
                      View
                    </Link>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
