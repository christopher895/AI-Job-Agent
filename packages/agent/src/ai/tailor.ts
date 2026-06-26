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

You tailor a candidate's MASTER résumé to a specific job description. The master
is the single source of truth: a superset of everything true about the candidate.

HARD RULES (non-negotiable):
- You may ONLY select, reorder, cut, and REPHRASE facts that exist in the master.
- NEVER invent or add a skill, tool, technology, employer, title, metric, or number
  that is not already present in the source bullet you are rewriting.
- Every output bullet MUST include the exact "sourceId" of the master bullet it came
  from. Every section "id" must be a master experience/project id.
- "skillsOrder" must be a reordered subset of the master's skills — invent nothing.
- If a job keyword has no truthful basis in the master, OMIT it. Do not stretch.

OPTIMIZATION GOAL: maximize relevance to the job while staying 100% truthful. Lead
with the most JD-relevant bullets and skills; cut what's irrelevant; reword to mirror
the JD's exact terminology only where the underlying fact already supports it.

${bestPracticesPromptBlock()}

OUTPUT: a single JSON object with this shape:
{
  "summary": string,                       // one tailored line, grounded in the master, or ""
  "experience": [{ "id": string, "bullets": [{ "sourceId": string, "text": string }] }],
  "projects":   [{ "id": string, "bullets": [{ "sourceId": string, "text": string }] }],
  "skillsOrder": string[],                 // JD-relevant master skills first
  "keywordsCovered": string[],             // JD keywords now truthfully reflected
  "cut": string[],                         // master ids deliberately dropped
  "reasoning": string                      // brief: what you prioritized and why
}
Return ONLY the JSON object.`;

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
    "=== MASTER RÉSUMÉ (source of truth; use these exact ids) ===",
    JSON.stringify(master, null, 2),
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
