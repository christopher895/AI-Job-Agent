import { notFound } from "next/navigation";
import { api } from "../../../lib/api";
import ResumeEditor from "../../../components/ResumeEditor";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
};

const VALID_VIEWS = ["edit", "split", "preview"] as const;

export default async function ResumePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { view } = await searchParams;

  let resume;
  try {
    resume = await api.getResume(id);
  } catch {
    notFound();
  }

  // Named only when it isn't the main resume — that's the case worth noticing.
  let baseProfileName: string | null = null;
  if (resume.base_resume_id && resume.base_resume_id !== 1) {
    const profiles = await api.listResumeProfiles().catch(() => []);
    baseProfileName = profiles.find((p) => p.id === resume.base_resume_id)?.name ?? null;
  }

  const initialView = VALID_VIEWS.includes(view as (typeof VALID_VIEWS)[number])
    ? (view as (typeof VALID_VIEWS)[number])
    : "split";

  return (
    <div className="h-full flex flex-col">
      <ResumeEditor resume={resume} initialView={initialView} baseProfileName={baseProfileName} />
    </div>
  );
}
