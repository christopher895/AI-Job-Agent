import { api } from "../../../lib/api";
import MasterResumeForm from "../../../components/MasterResumeForm";

export default async function MasterResumePage() {
  let masterResume;
  try {
    masterResume = await api.getMasterResume();
  } catch {
    return (
      <div className="px-8 py-8">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          Could not load master resume — make sure the agent server is running.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <MasterResumeForm initial={masterResume} />
    </div>
  );
}
