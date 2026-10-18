"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Grade, GradeFinding, GradeReport as Report } from "../lib/api";
import { defaultCheckedIds, findingsToFeedback } from "../lib/grade";

const SEVERITY_STYLE: Record<GradeFinding["severity"], string> = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-gray-50 text-gray-600 border-gray-200",
};

function scoreTone(score: number, max: number) {
  const r = score / max;
  return r >= 0.8 ? "bg-green-500" : r >= 0.6 ? "bg-amber-500" : "bg-red-500";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      className="text-xs px-2 py-1 border border-paper-border rounded-md hover:bg-black/[0.03] text-paper-ink"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

export default function GradeReport({ grade, report }: { grade: Grade; report: Report }) {
  const router = useRouter();
  const canFix = grade.source === "tailored" && grade.resume_id !== null;
  const [checked, setChecked] = useState(() => defaultCheckedIds(report.findings));
  const [resumeStatus, setResumeStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelFor = useMemo(() => new Map(report.categories.map((c) => [c.key, c.label])), [report]);

  useEffect(() => {
    if (!canFix) return;
    api.getResume(grade.resume_id!).then((r) => setResumeStatus(r.status)).catch(() => setResumeStatus("missing"));
  }, [canFix, grade.resume_id]);

  const selected = report.findings.filter((f) => checked.has(f.id));
  const feedback = findingsToFeedback(selected);

  async function fix() {
    setSending(true);
    setError(null);
    try {
      await api.submitFeedback(grade.resume_id!, feedback.text);
      router.push(`/resume/${grade.resume_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the feedback round.");
      setSending(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row gap-8">
        <div className="border border-paper-border rounded-xl bg-white p-6 flex flex-col items-center justify-center min-w-[180px]">
          <span className="font-serif text-6xl text-foreground">{report.score}</span>
          <span className="text-sm text-gray-500">out of 100</span>
        </div>
        <div className="flex-1 border border-paper-border rounded-xl bg-white p-6 space-y-4">
          {report.categories.map((c) => (
            <div key={c.key}>
              <div className="flex justify-between text-sm">
                <span className="font-medium text-paper-ink">{c.label}</span>
                <span className="text-gray-500">{c.score}/{c.max}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full mt-1 overflow-hidden">
                <div className={`h-full ${scoreTone(c.score, c.max)}`} style={{ width: `${(c.score / c.max) * 100}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">{c.summary}</p>
            </div>
          ))}
        </div>
      </div>

      {canFix && (
        <div className="border border-paper-border rounded-xl bg-white p-4 flex flex-wrap items-center gap-3">
          <button
            onClick={fix}
            disabled={sending || resumeStatus !== "ready" || selected.length === 0}
            className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {sending ? "Sending…" : `Fix ${feedback.included} in the resume`}
          </button>
          <span className="text-sm text-gray-500">
            {resumeStatus === "missing" ? "That resume was deleted."
              : resumeStatus && resumeStatus !== "ready" ? "Finish the resume's current round first — feedback only applies to a finished resume."
              : feedback.included < selected.length ? `Only the first ${feedback.included} of ${selected.length} checked findings fit in one feedback round.`
              : "Checked findings become a feedback round you review on the resume page."}
          </span>
          {error && <span className="text-sm text-red-700">{error}</span>}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-serif text-xl text-foreground">{report.findings.length} findings</h2>
        {report.findings.map((f) => (
          <div key={f.id} className="border border-paper-border rounded-xl bg-white p-5">
            <div className="flex items-start gap-3">
              {canFix && (
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked.has(f.id)}
                  onChange={(e) => {
                    const next = new Set(checked);
                    if (e.target.checked) next.add(f.id); else next.delete(f.id);
                    setChecked(next);
                  }}
                />
              )}
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-md border ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
                  <span className="text-xs text-gray-500">{labelFor.get(f.category)}</span>
                </div>
                <p className="font-medium text-paper-ink">{f.title}</p>
                {f.quote && <blockquote className="text-sm text-gray-600 border-l-2 border-gray-200 pl-3">{f.quote}</blockquote>}
                <p className="text-sm text-paper-ink">{f.problem}</p>
                {f.rewrite && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-md border ${
                        f.groundedness === "grounded"
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-amber-50 text-amber-800 border-amber-200"
                      }`}>
                        {f.groundedness === "grounded" ? "Uses your facts" : "Needs your input"}
                      </span>
                      <CopyButton text={f.rewrite} />
                    </div>
                    <p className="text-sm text-paper-ink">{f.rewrite}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
