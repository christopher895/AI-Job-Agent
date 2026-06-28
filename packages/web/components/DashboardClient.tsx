"use client";
import { useState } from "react";
import Link from "next/link";
import { ResumeListItem } from "../lib/api";
import ResumeCard from "./ResumeCard";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardClient({
  resumes,
  error,
}: {
  resumes: ResumeListItem[];
  error: string | null;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");

  const filtered = resumes
    .filter((r) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        r.job_title?.toLowerCase().includes(q) ||
        r.company?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sort === "newest" ? tb - ta : ta - tb;
    });

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {getGreeting()}, Christopher 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Here&apos;s your resume activity overview.
          </p>
        </div>
        <Link
          href="/tailor"
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" /><path d="M12 5v14" />
          </svg>
          Tailor New Resume
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-6">
          {error}
        </div>
      )}

      {/* Resume History */}
      <div>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-gray-900">Resume History</h2>
          <p className="text-sm text-gray-500 mt-0.5">All your tailored resumes in one place.</p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-xs">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search resumes..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white text-gray-700"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>

        {filtered.length === 0 && !error ? (
          <div className="text-center py-24 text-gray-400">
            <p className="text-base mb-1">
              {search ? "No resumes match your search." : "No resumes yet"}
            </p>
            {!search && (
              <p className="text-sm">
                <Link href="/tailor" className="text-violet-600 hover:text-violet-800">
                  Tailor your first resume
                </Link>{" "}
                to get started.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((r) => (
              <ResumeCard key={r.id} resume={r} editedAgo={timeAgo(r.updated_at)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
