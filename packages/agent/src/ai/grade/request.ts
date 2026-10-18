import { LEVELS, Level, TARGET_ROLES, TargetRole, isLevel, isTargetRole } from "./rubric";
import { MAX_GRADE_TEXT_CHARS } from "./resume-text";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres throws on a malformed uuid; check first so a bad URL is a 404, not a 500. */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export type GradeRequest = {
  source: "master" | "tailored" | "upload";
  resumeId: string | null;
  text: string | null;
  label: string | null;
  targetRole: TargetRole;
  level: Level;
  jdText: string;
};

/**
 * Validates the shape of POST /api/grades. `hasFile` is set by the route when
 * multer saw a PDF, since the file itself never reaches this pure function.
 * Resolving the resume text (DB reads, PDF parsing) happens in the route.
 */
export function parseGradeRequest(
  body: Record<string, unknown>
): { ok: true; value: GradeRequest } | { ok: false; error: string } {
  const { source, resumeId, text, label, targetRole, level, jdText, hasFile } = body;

  if (source !== "master" && source !== "tailored" && source !== "upload") {
    return { ok: false, error: "source must be 'master', 'tailored' or 'upload'." };
  }
  if (!isTargetRole(targetRole)) {
    return { ok: false, error: `targetRole must be one of: ${Object.keys(TARGET_ROLES).join(", ")}.` };
  }
  if (!isLevel(level)) {
    return { ok: false, error: `level must be one of: ${Object.keys(LEVELS).join(", ")}.` };
  }
  if (jdText !== undefined && jdText !== null && typeof jdText !== "string") {
    return { ok: false, error: "jdText must be a string." };
  }
  const jd = typeof jdText === "string" ? jdText.trim() : "";
  if (jd.length > MAX_GRADE_TEXT_CHARS) {
    return { ok: false, error: `The job description is too long (max ${MAX_GRADE_TEXT_CHARS.toLocaleString()} characters).` };
  }

  if (source === "tailored" && !isUuid(resumeId)) {
    return { ok: false, error: "resumeId must be a resume id." };
  }
  if (source === "upload" && !hasFile && typeof text !== "string") {
    return { ok: false, error: "Paste resume text or upload a PDF." };
  }

  return {
    ok: true,
    value: {
      source,
      resumeId: source === "tailored" ? (resumeId as string) : null,
      text: source === "upload" && typeof text === "string" ? text : null,
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 120) : null,
      targetRole,
      level,
      jdText: jd,
    },
  };
}
