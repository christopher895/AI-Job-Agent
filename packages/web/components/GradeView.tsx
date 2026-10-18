"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Grade } from "../lib/api";
import { levelLabel, rerunBody, roleLabel } from "../lib/grade";
import GradeProgress from "./GradeProgress";
import GradeReport from "./GradeReport";

export default function GradeView({ initial }: { initial: Grade }) {
  const router = useRouter();
  const [grade, setGrade] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (grade.status !== "pending") return;
    const t = setInterval(() => {
      api.getGrade(grade.id).then(setGrade).catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [grade.id, grade.status]);

  async function rerun() {
    setBusy(true);
    setError(null);
    try {
      // Re-running a stuck pending grade replaces it — cancel the old one so it
      // doesn't sit in history as "pending" forever (409 = already settled).
      if (grade.status === "pending") await api.cancelGrade(grade.id).catch(() => {});
      const { id } = await api.createGrade(rerunBody(grade));
      router.push(`/grader/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-run.");
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await api.cancelGrade(grade.id);
    } catch { /* already finished — the refetch shows the real state */ }
    setGrade(await api.getGrade(grade.id));
    setBusy(false);
  }

  async function remove() {
    await api.deleteGrade(grade.id);
    router.push("/grader");
    router.refresh();
  }

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/grader" className="text-sm text-gray-500 hover:underline">← Grader</Link>
          <h1 className="font-serif text-3xl text-foreground mt-1">{grade.label}</h1>
          <p className="text-sm text-gray-500 mt-1.5">
            {roleLabel(grade.target_role)} · {levelLabel(grade.level)}
            {grade.jd_text ? " · with job description" : ""} · {new Date(grade.created_at).toLocaleString()}
          </p>
        </div>
        {grade.status !== "pending" && (
          <div className="flex gap-2">
            <button onClick={rerun} disabled={busy}
              className="text-sm px-3 py-1.5 border border-paper-border rounded-lg hover:bg-black/[0.03] disabled:opacity-50 text-paper-ink">
              Re-run
            </button>
            {confirmDelete ? (
              <button onClick={remove} className="text-sm px-3 py-1.5 border border-red-200 bg-red-50 text-red-700 rounded-lg">
                Confirm delete
              </button>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="text-sm px-3 py-1.5 border border-paper-border rounded-lg hover:bg-black/[0.03] text-paper-ink">
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {grade.status === "pending" && <GradeProgress grade={grade} onCancel={cancel} onRerun={rerun} busy={busy} />}
      {grade.status === "ready" && grade.report && <GradeReport grade={grade} report={grade.report} />}
      {(grade.status === "failed" || grade.status === "cancelled") && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm max-w-xl">
          {grade.status === "cancelled" ? "This grade was cancelled. Use Re-run to try again." : grade.error ?? "Grading failed. Use Re-run to try again."}
        </div>
      )}
    </div>
  );
}
