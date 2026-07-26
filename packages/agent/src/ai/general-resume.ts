import { generateBestResume } from "./chain";
import { fitToOnePage } from "./fit-page";

/**
 * Stands in for a real job description when there's no specific posting to
 * tailor against. Fed through the exact same generateBestResume() pipeline
 * as a job-tailored resume — this is the only thing that makes the general
 * resume "general" rather than a raw, uncurated dump of the master resume.
 */
export const GENERIC_SWE_PROMPT = `General Software Engineer — no specific job posting.

This resume isn't tailored to one job description; it's a general-purpose,
one-page resume for cold outreach, career fairs, and "send me your resume"
requests. Select and rank the strongest, most broadly impressive experience
across backend, full-stack, and systems engineering: distributed systems,
APIs and services, cloud infrastructure (AWS/GCP/Azure), databases (SQL and
NoSQL), CI/CD, containers and orchestration (Docker, Kubernetes), testing
and observability, and modern web frameworks (React, Node.js, TypeScript,
Python, Go, Java). Favor bullets with the clearest, most quantified impact
over ones that are merely broad in scope. Lead with what would impress the
widest range of software engineering hiring managers, not what matches any
single company's stack.`;

export type GeneralResumeResult = {
  markdown: string;
  pdf: Buffer;
  criticScore: number;
};

/**
 * Generates the general resume: the standard generate->critique->revise
 * loop against GENERIC_SWE_PROMPT, then a hard one-page fit pass. Unlike
 * job-tailored resumes there's no JD to naturally narrow content down to a
 * page, so fitToOnePage() is load-bearing here, not just a safety net.
 */
export async function generateGeneralResume(): Promise<GeneralResumeResult> {
  const result = await generateBestResume(GENERIC_SWE_PROMPT, {
    jobTitle: "General Software Engineer",
  });
  const fitted = await fitToOnePage(result.markdown);
  return {
    markdown: fitted.markdown,
    pdf: fitted.pdf,
    criticScore: result.critic.finalScore,
  };
}
