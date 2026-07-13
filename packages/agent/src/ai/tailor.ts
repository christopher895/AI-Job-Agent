import { completeJSON } from "./llm";
import { getMasterResume } from "../db/queries";
import { MasterResume, TailoredResume, TailoredResumeSchema } from "./types";
import { bestPracticesPromptBlock } from "./knowledge/best-practices";
import { checkGrounding, GroundingReport } from "./grounding";

export type TailorOptions = {
  /** Override the source résumé (defaults to the committed master). */
  master?: MasterResume;
  /** Optional explicit target role/company for context. */
  jobTitle?: string;
  company?: string;
  model?: string;
  /** Critic fixes from a previous pass, fed back to drive revision (the loop). */
  feedback?: string[];
};

export type TailorResult = {
  tailored: TailoredResume;
  grounding: GroundingReport;
};

const SYSTEM_PROMPT = `You are an expert software-engineering résumé writer and ATS optimizer.

You tailor a candidate's EXPERIENCE, PROJECTS, and SKILLS to a specific job
description. That is your entire scope. Education, extracurriculars, contact
info, and interests are fixed, handled elsewhere, and are not shown to you —
do not reference, guess, or attempt to produce them.

The source below is the single source of truth: a superset of everything true
about the candidate's experience, projects, and skills (languages, frameworks,
tools — interests are NOT included here and are out of scope).

HARD RULES (non-negotiable):
- You may ONLY select, reorder, cut, and REPHRASE facts that exist in the source.
- NEVER invent or add a skill, tool, technology, employer, title, metric, or number
  that is not already present in the source bullet you are rewriting.
- Every output bullet MUST include the exact "sourceId" of the source bullet it came
  from. Every section "id" must be a source experience/project id.
- "skillsOrder" must be a reordered subset of the source's languages/frameworks/tools
  — invent nothing, and do not merge or reshuffle across the three categories; each
  stays rendered as its own group, you are only ranking relevance WITHIN a group.
  Keep changes light: this is light re-ranking toward JD-relevant items, not a rewrite
  — most candidates' skill sets barely change and shouldn't be aggressively reordered.
- If a job keyword has no truthful basis in the source, OMIT it. Do not stretch.

OPTIMIZATION GOAL: maximize relevance to the job while staying 100% truthful. Lead
with the most JD-relevant bullets and skills; cut what's irrelevant; reword to mirror
the JD's exact terminology only where the underlying fact already supports it.

${bestPracticesPromptBlock()}

OUTPUT: a single JSON object with this shape:
{
  "experience": [{ "id": string, "bullets": [{ "sourceId": string, "text": string }] }],
  "projects":   [{ "id": string, "bullets": [{ "sourceId": string, "text": string }] }],
  "skillsOrder": string[],                 // JD-relevant master skills first
  "keywordsCovered": string[],             // JD keywords now truthfully reflected
  "cut": string[],                         // master ids deliberately dropped
  "reasoning": string                      // brief: what you prioritized and why
}
Return ONLY the JSON object.`;

/** The only slice of the master résumé the tailorer is allowed to see or edit. */
function tailorableSlice(master: MasterResume) {
  return {
    experience: master.experience,
    projects: master.projects,
    // Interests are fixed and rendered verbatim, never seen by the tailorer —
    // only languages/frameworks/tools are ever reordered per JD.
    skills: {
      languages: master.skills.languages,
      frameworks: master.skills.frameworks,
      tools: master.skills.tools,
    },
  };
}

function buildUserPrompt(master: MasterResume, jd: string, opts: TailorOptions): string {
  const target = [opts.jobTitle && `Target role: ${opts.jobTitle}`, opts.company && `Company: ${opts.company}`]
    .filter(Boolean)
    .join("\n");

  const feedback =
    opts.feedback && opts.feedback.length
      ? "=== FIX THESE (from the previous draft's critique) ===\n" + opts.feedback.map((f) => `- ${f}`).join("\n")
      : "";

  return [
    target,
    "=== JOB DESCRIPTION ===",
    jd.trim(),
    feedback,
    "=== SOURCE (experience, projects, skills; use these exact ids) ===",
    JSON.stringify(tailorableSlice(master)),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Tailors the master résumé to a job description. Single pass: produces the
 * tailored output and a grounding report. Iteration (regenerate on violations /
 * low score) is the critic loop's job, built next.
 */
export async function tailorResume(jd: string, opts: TailorOptions = {}): Promise<TailorResult> {
  const master = opts.master ?? await getMasterResume();

  const tailored = await completeJSON(TailoredResumeSchema, {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(master, jd, opts),
    model: opts.model,
    temperature: 0.4,
  });

  const grounding = checkGrounding(master, tailored);
  return { tailored, grounding };
}
