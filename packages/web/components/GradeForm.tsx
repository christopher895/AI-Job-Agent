"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Level, ResumeListItem, TargetRole } from "../lib/api";
import { LEVEL_OPTIONS, ROLE_OPTIONS } from "../lib/grade";

type Mode = "master" | "tailored" | "paste" | "pdf";
const LAST_KEY = "grader:last";

function Chips<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
            value === o.value
              ? "border-violet-400 bg-violet-50 text-violet-800"
              : "border-paper-border hover:bg-black/[0.03] text-paper-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function GradeForm({ resumes, initialResumeId }: { resumes: ResumeListItem[]; initialResumeId?: string }) {
  const router = useRouter();
  // Only finished resumes have final Markdown worth grading.
  const gradeable = resumes.filter((r) => r.status === "ready");
  const initialTailored = gradeable.some((r) => r.id === initialResumeId) ? initialResumeId! : "";

  const [mode, setMode] = useState<Mode>(initialTailored ? "tailored" : "master");
  const [resumeId, setResumeId] = useState(initialTailored || gradeable[0]?.id || "");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [role, setRole] = useState<TargetRole>("swe");
  const [level, setLevel] = useState<Level>("intern");
  const [showJd, setShowJd] = useState(false);
  const [jd, setJd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read after mount, not in a lazy initializer: the server render has no
  // localStorage, so initializing from it would mismatch on hydration.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
        if (saved?.role && ROLE_OPTIONS.some((o) => o.value === saved.role)) setRole(saved.role);
        if (saved?.level && LEVEL_OPTIONS.some((o) => o.value === saved.level)) setLevel(saved.level);
      } catch { /* storage unavailable — keep defaults */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ role, level })); } catch { /* ignore */ }
    const jdText = showJd && jd.trim() ? jd.trim() : undefined;
    try {
      const { id } =
        mode === "pdf"
          ? await api.createGradeFromPdf(file!, { targetRole: role, level, jdText })
          : await api.createGrade(
              mode === "master"
                ? { source: "master", targetRole: role, level, jdText }
                : mode === "tailored"
                ? { source: "tailored", resumeId, targetRole: role, level, jdText }
                : { source: "upload", text, targetRole: role, level, jdText }
            );
      router.push(`/grader/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start grading.");
      setSubmitting(false);
    }
  }

  const ready =
    mode === "master" ||
    (mode === "tailored" && resumeId) ||
    (mode === "paste" && text.trim()) ||
    (mode === "pdf" && file);

  return (
    <div className="border border-paper-border rounded-xl bg-white p-6 space-y-5">
      <div>
        <p className="text-sm font-medium text-paper-ink mb-2">Resume</p>
        <Chips
          options={[
            { value: "master" as Mode, label: "Master resume" },
            ...(gradeable.length ? [{ value: "tailored" as Mode, label: "A tailored resume" }] : []),
            { value: "paste" as Mode, label: "Paste text" },
            { value: "pdf" as Mode, label: "Upload PDF" },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === "tailored" && (
          <select
            value={resumeId}
            onChange={(e) => setResumeId(e.target.value)}
            className="mt-3 w-full text-sm border border-paper-border rounded-lg px-3 py-2 bg-white text-paper-ink"
          >
            {gradeable.map((r) => (
              <option key={r.id} value={r.id}>
                {[r.company, r.job_title].filter(Boolean).join(" — ") || "Untitled resume"}
              </option>
            ))}
          </select>
        )}
        {mode === "paste" && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder="Paste the resume text"
            className="mt-3 w-full text-sm border border-paper-border rounded-lg px-3 py-2 bg-white text-paper-ink"
          />
        )}
        {mode === "pdf" && (
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-3 block text-sm text-paper-ink"
          />
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-paper-ink mb-2">Target role</p>
        <Chips options={ROLE_OPTIONS} value={role} onChange={setRole} />
      </div>

      <div>
        <p className="text-sm font-medium text-paper-ink mb-2">Experience level</p>
        <Chips options={LEVEL_OPTIONS} value={level} onChange={setLevel} />
      </div>

      <div>
        <button type="button" onClick={() => setShowJd((v) => !v)} className="text-sm text-violet-700 hover:underline">
          {showJd ? "− Remove job description" : "+ Add a job description (optional)"}
        </button>
        {mode === "tailored" && !showJd && (
          <p className="text-xs text-gray-500 mt-1">Leave empty to use the job description this resume was tailored for.</p>
        )}
        {showJd && (
          <textarea
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            rows={6}
            placeholder="Paste the job description"
            className="mt-2 w-full text-sm border border-paper-border rounded-lg px-3 py-2 bg-white text-paper-ink"
          />
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!ready || submitting}
        className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        {submitting ? "Starting…" : "Grade resume"}
      </button>
    </div>
  );
}
