import { completeJSON } from "../llm";
import {
  LEVELS,
  Level,
  SpecialistName,
  SpecialistResult,
  TARGET_ROLES,
  TargetRole,
  categoryFor,
  specialistResultSchema,
} from "./rubric";

export type GradeInput = {
  resumeText: string;
  targetRole: TargetRole;
  level: Level;
  jdText: string | null;
};

/** What each specialist judges — only its own category; the others cover the rest. */
const FOCUS: Record<SpecialistName, string> = {
  ats:
    "You are the ATS specialist. Judge parseability by an applicant tracking system: standard section " +
    "headings (Education, Experience, Projects, Skills), complete contact info (email, phone, LinkedIn/GitHub), " +
    "consistent date formats, reverse-chronological order within sections, no content that implies tables, " +
    "columns, icons or graphics, and appropriate length for the level (one page for intern/entry).",
  content:
    "You are the Content specialist. Judge bullet strength: each bullet should state an action, its scope, and " +
    "a measurable result. Reward ownership over participation, specificity over vagueness, and quantification — " +
    "count how many bullets carry a number and say so (\"N of M bullets carry a number\").",
  recruiter:
    "You are the Recruiter doing a six-second first-impression skim. Judge writing quality: clarity, concision, " +
    "consistent tense and voice (past tense for past roles), filler words, buzzwords, repetition of the same " +
    "verb, and typos or grammar slips.",
  domain:
    "You are the Domain specialist for the target role. Judge job optimization: are the skills, tools and kinds " +
    "of work a hiring manager for this role and level expects present and easy to find? Is the most relevant " +
    "work surfaced first? When a job description is given, judge keyword and requirement coverage against it; " +
    "otherwise judge against typical postings for this role and level.",
  storyteller:
    "You are the Storyteller. Judge application readiness and narrative: unexplained timeline gaps, unclear " +
    "current status (student? graduation date? availability for the role's start?), missing project dates, and " +
    "whether the resume reads as a coherent arc toward the target role.",
};

export function systemPrompt(name: SpecialistName): string {
  const { label, max } = categoryFor(name);
  return [
    "You are one member of a panel of senior engineering recruiters grading a resume.",
    FOCUS[name],
    "",
    `Your category is "${label}". Score it as an integer from 0 to ${max}.`,
    `A solid resume for the stated level lands around 75–85% of ${max}; give the full ${max} only when you ` +
      "would change nothing. Calibrate to the level: an intern is not penalized for lacking production " +
      "experience — projects and coursework count.",
    "",
    "Rules:",
    "- Report only issues in your own category; the other panelists cover the rest.",
    "- Return at most 6 findings, most costly first. Return an empty list if nothing in your category costs points.",
    "- `quote` is text copied verbatim from the resume (a whole bullet or line), or null for a whole-resume issue.",
    "- `problem` says why it costs points, in a recruiter's terms, in one or two sentences.",
    "- `rewrite` is a paste-ready replacement for `quote`, or a concrete instruction when `quote` is null.",
    "- Rewrites may only use facts already in the resume. Never invent a number, tool, employer, title, or " +
      "outcome. When a stronger bullet needs a number you do not have, write a bracketed placeholder where it " +
      "goes, such as [X%] or [N users].",
    "- Formatting markers such as **, ## or leading dashes come from a plain-text export of the resume; do not grade them.",
    "- `summary` is your one- or two-sentence verdict on this category.",
    "",
    "Return ONLY JSON: {\"score\": int, \"summary\": string, \"findings\": [{\"title\", \"severity\": \"high\"|\"medium\"|\"low\", \"quote\", \"problem\", \"rewrite\"}]}",
  ].join("\n");
}

export function buildUserMessage(input: GradeInput): string {
  const jd = input.jdText?.trim() ?? "";
  const parts = [
    `Target role: ${TARGET_ROLES[input.targetRole]}`,
    `Experience level: ${LEVELS[input.level]}`,
    "",
  ];
  if (jd) {
    parts.push("<job_description>", jd, "</job_description>", "");
  } else {
    parts.push(`No job description was given — judge fit against typical ${TARGET_ROLES[input.targetRole]} postings at this level.`, "");
  }
  parts.push("<resume>", input.resumeText, "</resume>");
  return parts.join("\n");
}

export async function runSpecialist(
  name: SpecialistName,
  input: GradeInput,
  signal?: AbortSignal
): Promise<SpecialistResult> {
  return completeJSON(specialistResultSchema(categoryFor(name).max), {
    system: systemPrompt(name),
    user: buildUserMessage(input),
    temperature: 0.2,
    signal,
  });
}
