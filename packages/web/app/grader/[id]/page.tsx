import { notFound } from "next/navigation";
import { api } from "../../../lib/api";
import GradeView from "../../../components/GradeView";

type Props = { params: Promise<{ id: string }> };

export default async function GradePage({ params }: Props) {
  const { id } = await params;
  let grade;
  try {
    grade = await api.getGrade(id);
  } catch {
    notFound();
  }
  return <GradeView initial={grade} />;
}
