import { api } from "../../../lib/api";
import MasterResumeForm from "../../../components/MasterResumeForm";

export default async function MasterResumePage() {
  let masterResume;
  try {
    masterResume = await api.getMasterResume();
  } catch {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm">
          Could not load master resume — make sure the agent server is running.
        </div>
      </div>
    );
  }

  return <MasterResumeForm initial={masterResume} />;
}
