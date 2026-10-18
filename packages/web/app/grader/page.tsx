import Link from "next/link";
import { api, GradeListItem, ResumeListItem } from "../../lib/api";
import GradeForm from "../../components/GradeForm";
import { levelLabel, roleLabel } from "../../lib/grade";

type Props = { searchParams: Promise<{ resumeId?: string }> };

export default async function GraderPage({ searchParams }: Props) {
  const { resumeId } = await searchParams;
  let resumes: ResumeListItem[] = [];
  let grades: GradeListItem[] = [];
  let error: string | null = null;
  try {
    [resumes, grades] = await Promise.all([api.listResumes(), api.listGrades()]);
  } catch {
    error = "Could not load the grader — make sure the agent server is running.";
  }

  return (
    <div className="px-8 py-8 space-y-8 max-w-4xl">
      <div>
        <h1 className="font-serif text-3xl text-foreground">Resume Grader</h1>
        <p className="text-sm text-gray-500 mt-1.5">
          Five reviewers score your resume out of 100 and list every fix, with rewrites you can paste.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      <GradeForm resumes={resumes} initialResumeId={resumeId} />

      {grades.length > 0 && (
        <div>
          <h2 className="font-serif text-xl text-foreground mb-3">History</h2>
          <ul className="border border-paper-border rounded-xl bg-white divide-y divide-paper-border">
            {grades.map((g) => (
              <li key={g.id}>
                <Link href={`/grader/${g.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.02]">
                  <div>
                    <p className="text-sm font-medium text-paper-ink">{g.label}</p>
                    <p className="text-xs text-gray-500">
                      {roleLabel(g.target_role)} · {levelLabel(g.level)} · {new Date(g.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-sm text-paper-ink">
                    {g.status === "ready" ? `${g.score}/100` : g.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
