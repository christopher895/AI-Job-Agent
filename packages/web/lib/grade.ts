import type { CreateGradeBody, Grade, GradeFinding, Level, SpecialistName, TargetRole } from "./api";

/** Mirrors agent/src/ai/grade/rubric.ts — keep the two in sync. */
export const ROLE_OPTIONS: { value: TargetRole; label: string }[] = [
  { value: "swe", label: "Software Engineer" },
  { value: "frontend", label: "Frontend" },
  { value: "backend", label: "Backend" },
  { value: "fullstack", label: "Full-Stack" },
  { value: "mobile", label: "Mobile" },
  { value: "devops", label: "DevOps" },
  { value: "data", label: "Data" },
  { value: "ml", label: "ML / AI" },
];

export const LEVEL_OPTIONS: { value: Level; label: string }[] = [
  { value: "intern", label: "Intern" },
  { value: "entry", label: "Entry (0–2y)" },
  { value: "mid", label: "Mid (3–5y)" },
  { value: "senior", label: "Senior (6–10y)" },
  { value: "staff", label: "Staff+ (10y+)" },
];

export const roleLabel = (r: TargetRole) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;
export const levelLabel = (l: Level) => LEVEL_OPTIONS.find((o) => o.value === l)?.label ?? l;

export const SPECIALIST_STEPS: { name: SpecialistName; label: string; detail: string }[] = [
  { name: "recruiter", label: "Recruiter", detail: "First-impression skim and writing" },
  { name: "ats", label: "ATS", detail: "Parseability and structure" },
  { name: "content", label: "Content", detail: "Bullet strength and impact" },
  { name: "domain", label: "Domain", detail: "Fit for the target role" },
  { name: "storyteller", label: "Storyteller", detail: "Timeline and narrative" },
];

/** POST /api/resume/:id/feedback rejects anything longer (agent MAX_PASTE_CHARS). */
export const MAX_FEEDBACK_CHARS = 12_000;

/**
 * Formats checked findings as feedback for the existing feedback round. Drops
 * whole findings from the end rather than cutting one mid-sentence when the
 * route's length limit would be exceeded; `included` lets the UI say so.
 */
export function findingsToFeedback(findings: GradeFinding[]): { text: string; included: number } {
  let text = "Fix these issues from a resume review:\n";
  let included = 0;
  for (const f of findings) {
    const block = [
      `\n${included + 1}. ${f.title} — ${f.problem}`,
      f.quote ? `\n   Line: "${f.quote}"` : "",
      f.rewrite ? `\n   Suggested: ${f.rewrite}` : "",
    ].join("");
    if (text.length + block.length > MAX_FEEDBACK_CHARS) break;
    text += block;
    included++;
  }
  return { text, included };
}

export function defaultCheckedIds(findings: GradeFinding[]): Set<string> {
  return new Set(findings.filter((f) => f.severity !== "low").map((f) => f.id));
}

/** A process restart orphans a pending grade; after this long, offer Re-run. */
export const STALE_PENDING_MS = 10 * 60 * 1000;

export function isStalePending(g: Pick<Grade, "status" | "created_at">, now = Date.now()): boolean {
  return g.status === "pending" && now - new Date(g.created_at).getTime() > STALE_PENDING_MS;
}

/**
 * Same inputs as the original grade. Master and tailored re-read the current
 * resume (so edits show up as score movement); an upload — or a tailored grade
 * whose resume was deleted since — resends the stored snapshot.
 */
export function rerunBody(g: Grade): CreateGradeBody {
  const base = { targetRole: g.target_role, level: g.level, jdText: g.jd_text ?? undefined };
  if (g.source === "master") return { ...base, source: "master" };
  if (g.source === "tailored" && g.resume_id) return { ...base, source: "tailored", resumeId: g.resume_id };
  return { ...base, source: "upload", text: g.resume_text, label: g.label };
}

/**
 * Which header/progress actions a grade offers. A stale pending grade keeps
 * Cancel alongside Re-run: it may be an orphan from a restart (Cancel is the
 * only way to clear it) or just slow behind the limiter.
 */
export function pendingActions(
  g: Pick<Grade, "status" | "created_at">,
  now = Date.now()
): { canCancel: boolean; canRerun: boolean } {
  if (g.status !== "pending") return { canCancel: false, canRerun: true };
  return { canCancel: true, canRerun: isStalePending(g, now) };
}
