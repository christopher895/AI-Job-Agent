import { z } from "zod";
import { completeJSON } from "./llm";
import {
  ApplicationAnswer,
  MasterResume,
  RawApplicationAnswersSchema,
} from "./types";

export const MAX_PASTE_CHARS = 12_000;
export const MAX_ANSWERS = 8;

const SYSTEM_PROMPT = `You draft first-person answers to job-application questions
for the candidate described in the résumé JSON. You write like a sharp student
talking to a recruiter, not like a cover-letter generator.

VOICE
- First person. Short sentences. Concrete nouns.
- No em dashes. No "passionate about", "thrilled", "leverage", "utilize",
  "robust", "excited to contribute", "aligns with my values", "I am eager".
- Do not open with "As a [role] at [school]". Start with the thing you did.
- Prefer 80–160 words unless the question asks for bullets. If it asks for
  bullets, give 3–5 short bullets, each one line.

FACTS
- Candidate facts come ONLY from the résumé JSON. Do not invent jobs, projects,
  titles, metrics, coursework, or awards.
- You may rephrase and tell the story behind a résumé bullet. You may not add
  a new accomplishment.
- Company facts (products, mission, public operating principles) may come from
  the job description OR well-known public information about that company.
  Do not invent a product or principle you are not sure exists.
- If a question cannot be answered from the résumé + JD + public company facts,
  write the strongest honest draft you can and stay specific about what you
  actually did.

TASK
The user pasted text copied from an application form. Extract the actual
open-ended questions (ignore UI chrome, asterisks, "required", button labels,
name/email/resume-upload fields). Answer each one. Return at most ${MAX_ANSWERS}.

OUTPUT: JSON only
{ "answers": [ { "question": string, "answer": string } ] }
Return ONLY the JSON object.`;

/** Compact slice of the master résumé — enough for stories, no ids/tags. */
export function answerContext(master: MasterResume) {
  return {
    name: master.basics.name,
    location: master.basics.location,
    github: master.basics.github,
    portfolio: master.basics.portfolio,
    education: master.education,
    experience: master.experience.map((e) => ({
      company: e.company,
      title: e.title,
      location: e.location,
      start: e.start,
      end: e.end,
      bullets: e.bullets.map((b) => b.text),
    })),
    projects: master.projects.map((p) => ({
      name: p.name,
      tech: p.tech,
      start: p.start,
      end: p.end,
      link: p.link,
      repo: p.repo,
      bullets: p.bullets.map((b) => b.text),
    })),
    extracurriculars: master.extracurriculars.map((e) => ({
      company: e.company,
      title: e.title,
      bullets: e.bullets.map((b) => b.text),
    })),
    skills: master.skills,
  };
}

export function assignAnswerIds(
  raw: z.infer<typeof RawApplicationAnswersSchema>
): ApplicationAnswer[] {
  return raw.answers.slice(0, MAX_ANSWERS).map((a, i) => ({
    id: `ans-${i + 1}`,
    question: a.question.trim(),
    answer: a.answer.trim(),
  }));
}

export async function generateAnswers(
  opts: {
    pasted: string;
    jd: string;
    company: string | null;
    jobTitle: string | null;
    master: MasterResume;
    signal?: AbortSignal;
  }
): Promise<ApplicationAnswer[]> {
  const pasted = opts.pasted.trim();
  if (!pasted) throw new Error("Paste at least one application question.");
  if (pasted.length > MAX_PASTE_CHARS) {
    throw new Error(`Pasted text is too long (max ${MAX_PASTE_CHARS} characters).`);
  }

  const result = await completeJSON(RawApplicationAnswersSchema, {
    system: SYSTEM_PROMPT,
    user: [
      "=== ROLE ===",
      [opts.jobTitle, opts.company].filter(Boolean).join(" at ") || "(untitled)",
      "=== JOB DESCRIPTION ===",
      opts.jd.trim(),
      "=== CANDIDATE RÉSUMÉ ===",
      JSON.stringify(answerContext(opts.master)),
      "=== PASTED APPLICATION QUESTIONS ===",
      pasted,
    ].join("\n\n"),
    temperature: 0.55,
    signal: opts.signal,
  });

  return assignAnswerIds(result);
}
