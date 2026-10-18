import { z } from "zod";

/**
 * The grader's rubric. Five specialists each own one category; the category
 * maxima sum to 100 so the report score is a plain sum. The maxima match the
 * category scores ResuMax showed on 2026-10-17 (20/30/8/18/5 all fit under them).
 * See docs/superpowers/specs/2026-10-17-resume-grader-design.md.
 */

export const SPECIALISTS = ["recruiter", "ats", "content", "domain", "storyteller"] as const;
export type SpecialistName = (typeof SPECIALISTS)[number];

export const SPECIALIST_LABELS: Record<SpecialistName, string> = {
  recruiter: "Recruiter",
  ats: "ATS",
  content: "Content",
  domain: "Domain",
  storyteller: "Storyteller",
};

export const CATEGORIES = [
  { key: "ats", label: "ATS & structure", max: 25, specialist: "ats" },
  { key: "content", label: "Content quality", max: 35, specialist: "content" },
  { key: "writing", label: "Writing quality", max: 10, specialist: "recruiter" },
  { key: "job", label: "Job optimization", max: 20, specialist: "domain" },
  { key: "readiness", label: "Application readiness", max: 10, specialist: "storyteller" },
] as const satisfies readonly { key: string; label: string; max: number; specialist: SpecialistName }[];
export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export type Category = (typeof CATEGORIES)[number];

export function categoryFor(name: SpecialistName): Category {
  const c = CATEGORIES.find((cat) => cat.specialist === name);
  if (!c) throw new Error(`No category for specialist ${name}`);
  return c;
}

export const TARGET_ROLES = {
  swe: "Software Engineer",
  frontend: "Frontend Engineer",
  backend: "Backend Engineer",
  fullstack: "Full-Stack Engineer",
  mobile: "Mobile Engineer",
  devops: "DevOps / Infrastructure Engineer",
  data: "Data Engineer / Data Scientist",
  ml: "ML / AI Engineer",
} as const;
export type TargetRole = keyof typeof TARGET_ROLES;

export const LEVELS = {
  intern: "Intern",
  entry: "Entry level (0–2 years)",
  mid: "Mid level (3–5 years)",
  senior: "Senior (6–10 years)",
  staff: "Staff+ (10+ years)",
} as const;
export type Level = keyof typeof LEVELS;

// hasOwnProperty, not `in`: "toString" is `in` every object.
export function isTargetRole(v: unknown): v is TargetRole {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TARGET_ROLES, v);
}
export function isLevel(v: unknown): v is Level {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LEVELS, v);
}

export const RawFindingSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(["high", "medium", "low"]),
  /** Exact text from the resume this is about; null for whole-resume issues. */
  quote: z.string().nullable(),
  problem: z.string().min(1),
  /** Paste-ready replacement for `quote`, or a concrete instruction when quote is null. */
  rewrite: z.string().nullable(),
});
export type RawFinding = z.infer<typeof RawFindingSchema>;

/** Per-specialist schema: the score bound is the specialist's own category max. */
export function specialistResultSchema(max: number) {
  return z.object({
    score: z.number().int().min(0).max(max),
    summary: z.string().min(1),
    // Trimmed, not rejected: a 7th finding isn't worth failing the whole grade over.
    findings: z.array(RawFindingSchema).transform((all) => all.slice(0, 6)),
  });
}
export type SpecialistResult = { score: number; summary: string; findings: RawFinding[] };

/** A finding plus fields computed after the LLM call, never self-reported by the model. */
export type Finding = RawFinding & {
  id: string;
  category: CategoryKey;
  groundedness: "grounded" | "needs-your-input";
};

export type GradeCategory = { key: CategoryKey; label: string; score: number; max: number; summary: string };

export type GradeReport = { score: number; categories: GradeCategory[]; findings: Finding[] };

/** One entry of resume_grades.specialists — drives the pending-screen checklist. */
export type SpecialistState = { status: "pending" | "done" | "failed"; result?: SpecialistResult };
