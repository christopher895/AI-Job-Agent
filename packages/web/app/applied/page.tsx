import { api, AppliedJob } from "../../lib/api";
import AppliedTable from "../../components/AppliedTable";

export default async function AppliedPage() {
  let jobs: AppliedJob[] = [];
  let error: string | null = null;

  try {
    jobs = await api.listApplied();
  } catch {
    error = "Could not load applications — make sure the agent server is running.";
  }

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Applied Jobs</h1>
          <p className="text-sm text-gray-500 mt-1">Track all your job applications in one place.</p>
        </div>
        <button className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" /><path d="M12 5v14" />
          </svg>
          Add Application
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-6">
          {error}
        </div>
      )}

      <AppliedTable initial={jobs} />
    </div>
  );
}
