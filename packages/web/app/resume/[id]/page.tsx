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

  const initialView = VALID_VIEWS.includes(view as (typeof VALID_VIEWS)[number])
    ? (view as (typeof VALID_VIEWS)[number])
    : "edit";

  return (
    <div className="h-full flex flex-col">
      <ResumeEditor resume={resume} initialView={initialView} />
    </div>
  );
}
