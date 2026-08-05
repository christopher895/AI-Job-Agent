import { z } from "zod";
import { completeJSON } from "./llm";
import { EmailMessage, ClassifiedEmail } from "../ingest/types";

const SYSTEM_PROMPT = `You classify a single email about a job application. Decide whether it
relates to the candidate's own job application, and if so, what stage it represents.

Return JSON matching:
{
  "isJobRelated": boolean,   // true only if this is about the candidate's own application/candidacy
  "status": "applied" | "assessment" | "interviewing" | "offer" | "rejected" | "no_response" | "none",
  "company": string,         // the hiring company, "" if unknown
  "role": string,            // the job title/role, "" if unknown
  "deadlineAt": string | null // ISO 8601 date (YYYY-MM-DD) of any deadline/scheduled time, else null
}

Rules:
- "assessment" = an online assessment / coding challenge / take-home to complete.
- "interviewing" = an interview invite or scheduling (phone screen, onsite, technical).
- "offer" = an offer extended.
- "rejected" = not moving forward / position filled.
- "applied" = a bare application-received confirmation with no next step.
- "no_response" = generic acknowledgement with no state change.
- If not about the candidate's own application (newsletters, job alerts, marketing), set
  isJobRelated=false and status="none".
- Extract deadlineAt only when the email states a concrete date/time. Otherwise null.
Return ONLY the JSON object.`;

const ResponseSchema = z.object({
  isJobRelated: z.boolean(),
  status: z.enum(["applied", "assessment", "interviewing", "offer", "rejected", "no_response", "none"]),
  company: z.string().default(""),
  role: z.string().default(""),
  deadlineAt: z.string().nullable().default(null),
});

export async function classifyEmail(email: EmailMessage): Promise<ClassifiedEmail> {
  return completeJSON(ResponseSchema, {
    system: SYSTEM_PROMPT,
    user: [
      `From: ${email.from}`,
      `Subject: ${email.subject}`,
      "",
      email.body.slice(0, 6000),
    ].join("\n"),
    temperature: 0.1,
  });
}
