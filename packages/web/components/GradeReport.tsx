"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Grade, GradeFinding, GradeReport as Report } from "../lib/api";
import { defaultCheckedIds, findingsToFeedback } from "../lib/grade";
import {
  FindingFix,
  MasterFix,
  classifyFindings,
  findInText,
  fixStatus,
  fixedResumeText,
  sameBulletConflicts,
  splice,
  writeHandoff,
} from "../lib/gradeFixes";

const SEVERITY_STYLE: Record<GradeFinding["severity"], string> = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-gray-50 text-gray-600 border-gray-200",
};

function scoreTone(score: number, max: number) {
  const r = score / max;
  return r >= 0.8 ? "bg-green-500" : r >= 0.6 ? "bg-amber-500" : "bg-red-500";
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      className="text-xs px-2 py-1 border border-paper-border rounded-md hover:bg-black/[0.03] text-paper-ink"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

const Badge = ({ ok, okText, warnText }: { ok: boolean; okText: string; warnText: string }) => (
  <span className={`text-xs px-2 py-0.5 rounded-md border ${
    ok ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-800 border-amber-200"
  }`}>
    {ok ? okText : warnText}
  </span>
);

type FixView = { kind: "applicable"; owner: string | null } | { kind: "todo"; unmatched: boolean };


export default function GradeReport({ grade, report }: { grade: Grade; report: Report }) {
  const router = useRouter();
  const findings = report.findings;
  const labelFor = useMemo(() => new Map(report.categories.map((c) => [c.key, c.label])), [report]);

  // ── Tailored: hand checked findings to the existing feedback round ─────────
  const canFeedback = grade.source === "tailored" && grade.resume_id !== null;
  const [checked, setChecked] = useState(() => defaultCheckedIds(findings));
  const [resumeStatus, setResumeStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canFeedback) return;
    api.getResume(grade.resume_id!).then((r) => setResumeStatus(r.status)).catch(() => setResumeStatus("missing"));
  }, [canFeedback, grade.resume_id]);

  const selected = findings.filter((f) => checked.has(f.id));
  const feedback = findingsToFeedback(selected);

  async function sendFeedback() {
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

  // ── Master / upload: apply edited rewrites directly ────────────────────────
  const fixMode = grade.source === "master" || grade.source === "upload" ? grade.source : null;
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(findings.map((f) => [f.id, f.rewrite ?? ""]))
  );
  const [masterClasses, setMasterClasses] = useState<Map<string, FindingFix> | null>(null);
  const [masterError, setMasterError] = useState(false);
  const uploadSpans = useMemo(
    () => new Set(fixMode === "upload"
      ? findings.filter((f) => f.quote && findInText(grade.resume_text, f.quote)).map((f) => f.id)
      : []),
    [fixMode, findings, grade.resume_text]
  );
  // Pre-check only fixes that are safe as written: ready (no placeholder, no
  // unconfirmed number), not low severity, and at most one per bullet.
  const defaultFixChecks = (applicable: (f: GradeFinding) => boolean, bulletOf: (f: GradeFinding) => string | null) => {
    const out = new Set<string>();
    const used = new Set<string>();
    for (const f of findings) {
      if (!applicable(f) || f.severity === "low" || fixStatus(f, f.rewrite ?? "") !== "ready") continue;
      const bullet = bulletOf(f);
      if (bullet && used.has(bullet)) continue;
      if (bullet) used.add(bullet);
      out.add(f.id);
    }
    return out;
  };
  const [fixChecked, setFixChecked] = useState<Set<string>>(() =>
    fixMode === "upload" ? defaultFixChecks((f) => uploadSpans.has(f.id), () => null) : new Set()
  );
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (fixMode !== "master") return;
    api.getMasterResume()
      .then((m) => {
        const classes = classifyFindings(m, findings);
        setMasterClasses(classes);
        const bulletOf = (f: GradeFinding) => {
          const c = classes.get(f.id);
          return c?.kind === "applicable" ? c.match.bulletId : null;
        };
        setFixChecked(defaultFixChecks((f) => classes.get(f.id)?.kind === "applicable", bulletOf));
      })
      .catch(() => setMasterError(true));
    // Runs once per grade — findings never change for a stored report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixMode, grade.id]);

  // What each finding's card offers; null = no fix controls (tailored, or still matching).
  const fixOf = (f: GradeFinding): FixView | null => {
    if (fixMode === "master") {
      const c = masterClasses?.get(f.id);
      if (c) return c.kind === "applicable" ? { kind: "applicable", owner: c.match.owner } : c;
      return masterError ? { kind: "todo", unmatched: false } : null;
    }
    if (fixMode === "upload") return uploadSpans.has(f.id) ? { kind: "applicable", owner: null } : null;
    return null;
  };
  // A checked fix whose text later gains a placeholder (or is emptied) stops counting.
  // Checking a "confirm-number" fix is the confirmation that the number is real.
  const canApply = (f: GradeFinding) => {
    const s = fixStatus(f, edits[f.id] ?? "");
    return s === "ready" || s === "confirm-number";
  };
  const isFixChecked = (f: GradeFinding) => {
    const fix = fixOf(f);
    if (!fix || !fixChecked.has(f.id)) return false;
    return fix.kind === "todo" || canApply(f);
  };
  const toggleFix = (id: string, on: boolean) => {
    const next = new Set(fixChecked);
    if (on) next.add(id); else next.delete(id);
    setFixChecked(next);
  };

  // Two checked fixes on one bullet: only the first can land (the second's
  // `original` would no longer match), so later ones are held back and flagged.
  const conflicts = fixMode === "master" && masterClasses
    ? sameBulletConflicts(findings
        .filter((f) => masterClasses.get(f.id)?.kind === "applicable" && isFixChecked(f))
        .map((f) => ({ id: f.id, bulletId: (masterClasses.get(f.id) as Extract<FindingFix, { kind: "applicable" }>).match.bulletId })))
    : new Set<string>();
  const checkedApplicable = findings.filter((f) => fixOf(f)?.kind === "applicable" && isFixChecked(f) && !conflicts.has(f.id));
  const checkedTodos = findings.filter((f) => fixOf(f)?.kind === "todo" && isFixChecked(f));

  function applyToMaster() {
    setApplyError(null);
    const fixes: MasterFix[] = checkedApplicable.map((f) => {
      const fix = masterClasses!.get(f.id) as Extract<FindingFix, { kind: "applicable" }>;
      return {
        bulletId: fix.match.bulletId,
        original: fix.original,
        text: splice(fix.original, fix.match, edits[f.id].trim()),
        title: f.title,
      };
    });
    try {
      writeHandoff(sessionStorage, {
        gradeId: grade.id,
        targetRole: grade.target_role,
        level: grade.level,
        jdText: grade.jd_text,
        fixes,
        todos: checkedTodos.map((f) => ({
          title: f.title,
          category: labelFor.get(f.category) ?? f.category,
          problem: f.problem,
          rewrite: f.rewrite,
        })),
      });
    } catch {
      setApplyError("Your browser blocked session storage, so the fixes can't be handed to the editor.");
      return;
    }
    router.push("/resume/master");
  }

  const fixedText = fixMode === "upload"
    ? fixedResumeText(grade.resume_text, checkedApplicable.map((f) => ({ quote: f.quote!, text: edits[f.id].trim() })))
    : null;

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

      {canFeedback && (
        <div className="border border-paper-border rounded-xl bg-white p-4 flex flex-wrap items-center gap-3">
          <button
            onClick={sendFeedback}
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

      {fixMode === "master" && (
        <div className="sticky top-0 z-10 border border-paper-border rounded-xl bg-white p-4 flex flex-wrap items-center gap-3 shadow-sm">
          <button
            onClick={applyToMaster}
            disabled={!masterClasses || checkedApplicable.length + checkedTodos.length === 0}
            className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Apply {checkedApplicable.length} to master resume
            {checkedTodos.length > 0 ? ` + ${checkedTodos.length} to-do${checkedTodos.length === 1 ? "" : "s"}` : ""}
          </button>
          <span className="text-sm text-gray-500">
            {masterError
              ? "Couldn't load your master resume to match lines — findings can only go on the to-do list."
              : !masterClasses
              ? "Matching findings to your bullets…"
              : "Edit a rewrite before applying. Fixes open in the editor unsaved — nothing changes until you Save."}
          </span>
          {applyError && <span className="text-sm text-red-700">{applyError}</span>}
        </div>
      )}

      {fixMode === "upload" && uploadSpans.size > 0 && fixedText && (
        <div className="sticky top-0 z-10 border border-paper-border rounded-xl bg-white p-4 flex flex-wrap items-center gap-3 shadow-sm">
          <CopyButton text={fixedText.text} label={`Copy fixed resume text (${fixedText.replaced} fix${fixedText.replaced === 1 ? "" : "es"})`} />
          <span className="text-sm text-gray-500">Your graded text with the checked rewrites swapped in.</span>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-serif text-xl text-foreground">{findings.length} findings</h2>
        {findings.map((f) => {
          const fix = fixOf(f);
          const applicable = fix?.kind === "applicable";
          const edit = edits[f.id] ?? "";
          const status = fixStatus(f, edit);
          const blocked = status === "empty" || status === "placeholder";
          return (
            <div key={f.id} className="border border-paper-border rounded-xl bg-white p-5">
              <div className="flex items-start gap-3">
                {canFeedback && (
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
                {fix && (
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-label={applicable ? "Apply this fix" : "Add to to-do list"}
                    checked={isFixChecked(f)}
                    disabled={applicable && blocked}
                    title={applicable && blocked ? "Replace the [ ] parts with your real numbers first" : undefined}
                    onChange={(e) => toggleFix(f.id, e.target.checked)}
                  />
                )}
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-md border ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
                    <span className="text-xs text-gray-500">{labelFor.get(f.category)}</span>
                    {fix?.kind === "applicable" && fix.owner && (
                      <span className="text-xs text-violet-700">Applies to: {fix.owner}</span>
                    )}
                    {fixMode === "master" && fix?.kind === "todo" && (
                      <span className="text-xs text-gray-500">Check to add to your to-do list</span>
                    )}
                  </div>
                  <p className="font-medium text-paper-ink">{f.title}</p>
                  {f.quote && <blockquote className="text-sm text-gray-600 border-l-2 border-gray-200 pl-3">{f.quote}</blockquote>}
                  <p className="text-sm text-paper-ink">{f.problem}</p>
                  {conflicts.has(f.id) && (
                    <p className="text-xs text-amber-800">Another checked fix already rewrites this bullet — uncheck one, or merge both into one rewrite.</p>
                  )}
                  {fix?.kind === "todo" && fix.unmatched && (
                    <p className="text-xs text-gray-500">Couldn&apos;t match this to a single bullet — edit by hand.</p>
                  )}
                  {applicable ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge
                          ok={status === "ready"}
                          okText="Ready to apply"
                          warnText={
                            status === "placeholder" ? "Fill in the [ ] parts"
                            : status === "confirm-number" ? "New number — check it's real, or edit it"
                            : "Write a rewrite to apply"
                          }
                        />
                        <CopyButton text={edit} />
                      </div>
                      <textarea
                        value={edit}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [f.id]: e.target.value }))}
                        rows={Math.max(2, Math.ceil(edit.length / 110))}
                        className="w-full text-sm border border-paper-border rounded-md px-2.5 py-1.5 bg-white text-paper-ink focus:outline-none focus:ring-1 focus:ring-violet-500"
                      />
                    </div>
                  ) : f.rewrite && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <Badge ok={f.groundedness === "grounded"} okText="Uses your facts" warnText="Needs your input" />
                        <CopyButton text={f.rewrite} />
                      </div>
                      <p className="text-sm text-paper-ink">{f.rewrite}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
