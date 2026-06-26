import Link from "next/link";
import { api, ResumeListItem } from "../lib/api";
import ResumeCard from "../components/ResumeCard";

export default async function DashboardPage() {
  let resumes: ResumeListItem[] = [];
  let error: string | null = null;

  try {
    resumes = await api.listResumes();
  } catch {
    error = "Could not connect to the API — make sure the agent server is running.";
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-semibold text-zinc-900">Resumes</h1>
        <Link
          href="/tailor"
          className="bg-zinc-900 text-white text-sm px-4 py-2 rounded-md hover:bg-zinc-700 transition-colors"
        >
          + Tailor new
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm mb-6">
          {error}
        </div>
      )}

      {resumes.length === 0 && !error && (
        <div className="text-center py-24 text-zinc-400">
          <p className="text-base mb-1">No resumes yet</p>
          <p className="text-sm">
            <Link href="/tailor" className="text-zinc-600 underline underline-offset-2">
              Tailor your first resume
            </Link>{" "}
            to get started.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {resumes.map((r) => (
          <ResumeCard key={r.id} resume={r} />
        ))}
      </div>
    </div>
  );
}
