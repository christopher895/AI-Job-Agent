import { api, ResumeListItem } from "../lib/api";
import DashboardClient from "../components/DashboardClient";

export default async function DashboardPage() {
  let resumes: ResumeListItem[] = [];
  let error: string | null = null;

  try {
    resumes = await api.listResumes();
  } catch {
    error = "Could not connect to the API — make sure the agent server is running.";
  }

  return <DashboardClient resumes={resumes} error={error} />;
}
