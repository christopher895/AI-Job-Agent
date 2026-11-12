import { api, type ResumeProfile } from "../../../lib/api";
import { DEFAULT_PROFILE_ID } from "../../../lib/resumeProfiles";
import MasterResumeForm from "../../../components/MasterResumeForm";

type Props = { searchParams: Promise<{ profile?: string }> };

export default async function MasterResumePage({ searchParams }: Props) {
  const { profile } = await searchParams;
  const requested = profile && /^\d+$/.test(profile) ? Number(profile) : DEFAULT_PROFILE_ID;

  let profiles: ResumeProfile[];
  let masterResume;
  let profileId = requested;
  try {
    profiles = await api.listResumeProfiles();
    // A stale ?profile= (deleted since, or typed by hand) opens the main resume.
    if (!profiles.some((p) => p.id === profileId)) profileId = DEFAULT_PROFILE_ID;
    masterResume = await api.getMasterResume(profileId);
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
      {/* Keyed by profile so switching profiles resets every piece of form state. */}
      <MasterResumeForm key={profileId} initial={masterResume} profiles={profiles} profileId={profileId} />
    </div>
  );
}
