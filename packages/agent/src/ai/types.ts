import { z } from "zod";

/**
 * The master résumé is the single source of truth: a superset of everything
 * true about the candidate. Nothing here is ever sent as-is — the tailorer
 * SELECTS, REORDERS, and REPHRASES from it per job, and the grounding check
 * verifies every tailored bullet traces back to a master bullet `id`.
 *
 * Rule: facts only ever get removed or reworded during tailoring, never added.
 */

export const BulletSchema = z.object({
  /** Stable id, e.g. "exp-scout-1" — referenced by the tailor's provenance map. */
  id: z.string(),
  /** Canonical, truthful phrasing. The tailorer may reword this, not invent beyond it. */
  text: z.string(),
  /** Tools/tech named in this bullet — doubles as keyword inventory for JD matching. */
  tech: z.array(z.string()).default([]),
  /** Quantified results present in this bullet. The tailorer may not add new numbers. */
  metrics: z.array(z.string()).default([]),
  /** Coarse tags for relevance selection, e.g. "backend", "ai", "devops", "frontend". */
  tags: z.array(z.string()).default([]),
});
export type Bullet = z.infer<typeof BulletSchema>;

export const ExperienceSchema = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string(),
  start: z.string(),
  end: z.string(),
  bullets: z.array(BulletSchema),
});
export type Experience = z.infer<typeof ExperienceSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  tech: z.array(z.string()).default([]),
  start: z.string(),
  end: z.string(),
  /** Live demo URL. hiring-agent rewards this heavily (+10–20%); absence is penalized (−30–50%). */
  link: z.string().default(""),
  /** Source repo URL. Label external open-source contributions distinctly in bullets. */
  repo: z.string().default(""),
  bullets: z.array(BulletSchema),
});
export type Project = z.infer<typeof ProjectSchema>;

export const EducationSchema = z.object({
  school: z.string(),
  degrees: z.array(z.string()),
  location: z.string(),
  gpa: z.string().optional(),
  graduation: z.string(),
  coursework: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type Education = z.infer<typeof EducationSchema>;

export const MasterResumeSchema = z.object({
  basics: z.object({
    name: z.string(),
    location: z.string(),
    email: z.string().default(""),
    phone: z.string().default(""),
    /** Surface prominently — hiring-agent enriches scoring from the GitHub profile. */
    github: z.string().default(""),
    linkedin: z.string().default(""),
    portfolio: z.string().default(""),
    summary: z.string().default(""),
  }),
  education: z.array(EducationSchema),
  experience: z.array(ExperienceSchema),
  projects: z.array(ProjectSchema),
  /** Same shape as experience; surfaced/cut depending on role relevance. */
  extracurriculars: z.array(ExperienceSchema),
  skills: z.object({
    languages: z.array(z.string()).default([]),
    frameworks: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]),
    interests: z.array(z.string()).default([]),
  }),
});
export type MasterResume = z.infer<typeof MasterResumeSchema>;

/* ------------------------------------------------------------------ */
/* Tailored output — what the tailorer produces per job.              */
/* Every bullet carries `sourceId` so grounding can prove provenance. */
/* ------------------------------------------------------------------ */

export const TailoredBulletSchema = z.object({
  /** The master Bullet.id this was derived from. Grounding rejects unknown ids. */
  sourceId: z.string(),
  /** Reworded for the JD — but only rephrasing facts in the source bullet. */
  text: z.string(),
});

export const TailoredSectionSchema = z.object({
  /** The master experience/project id. */
  id: z.string(),
  bullets: z.array(TailoredBulletSchema),
});

export const TailoredResumeSchema = z.object({
  /** Optional tailored summary line; "" if omitted. */
  summary: z.string().default(""),
  experience: z.array(TailoredSectionSchema),
  projects: z.array(TailoredSectionSchema),
  /** Skills reordered to front-load JD-relevant ones; must be a subset of master skills. */
  skillsOrder: z.array(z.string()).default([]),
  /** JD keywords the tailorer believes are now truthfully covered. */
  keywordsCovered: z.array(z.string()).default([]),
  /** Master ids deliberately cut as irrelevant, for auditability. */
  cut: z.array(z.string()).default([]),
  /** Short rationale: what was prioritized and why. */
  reasoning: z.string().default(""),
});
export type TailoredResume = z.infer<typeof TailoredResumeSchema>;
