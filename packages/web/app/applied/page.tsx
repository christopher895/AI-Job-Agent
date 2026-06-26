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
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="text-xl font-semibold text-zinc-900 mb-8">Applied</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm mb-6">
          {error}
        </div>
      )}

      <AppliedTable initial={jobs} />
    </div>
  );
}
