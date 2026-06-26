import { notFound } from "next/navigation";
import { api } from "../../../lib/api";
import ResumeEditor from "../../../components/ResumeEditor";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ResumePage({ params }: Props) {
  const { id } = await params;

  let resume;
  try {
    resume = await api.getResume(id);
  } catch {
    notFound();
  }

  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100vh - 49px)" }}>
      <ResumeEditor resume={resume} />
    </div>
  );
}
