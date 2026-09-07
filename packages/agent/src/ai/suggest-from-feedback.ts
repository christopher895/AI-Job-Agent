import { z } from "zod";
import { completeJSON } from "./llm";
import { applySuggestions } from "./apply-suggestions";
import { tailorableSlice } from "./suggest-keywords";
import { MasterResume, RawSuggestion, RawSuggestionSchema, Suggestion } from "./types";

/**
 * Turns free-form reviewer feedback ("your skills section is missing SQL and
 * Git; the posting calls out testing — add Jest") into the same suggestion
 * shape the JD keyword pass produces, so it flows through the existing review
 * checklist and apply pipeline untouched. Runs against the resume AS IT
 * CURRENTLY STANDS (earlier accepted suggestions applied), so "add X next to
 * Y" resolves against the text the reviewer was actually looking at.
 */
const SYSTEM_PROMPT = `You turn a reviewer's free-form feedback on a candidate's résumé into a SHORT
list of concrete, reviewable edits. That is your entire scope.

HARD RULES:
- The résumé below is FIXED and already exactly one page. Do NOT propose
  removing, cutting, reordering, or restructuring experience/project bullets —
  every existing bullet stays exactly where it is.
- Only act on what the feedback asks for. Do not add unrelated improvements,
  even good ones. If the feedback also mentions the job description, use the
  job description below only to resolve which terms it means.
- If a feedback point cannot be applied without inventing experience the
  résumé gives no basis for, skip it — produce no suggestion for it. A
  plausible extrapolation from something already on the résumé (a closely
  related tool, the standard name for a thing the candidate clearly did) is
  fine: the candidate reviews and approves every suggestion before anything
  is applied.
- Each suggestion is one of:
  - "bullet-rewrite": a small wording change to ONE existing bullet (referenced
    by its exact "id" from the source below). Keep the bullet's meaning and
    length; work the requested term in, don't rewrite the bullet.
  - "skill-addition": a skill/technology to add to one of the candidate's
    skill categories — "targetId" must be exactly "languages", "frameworks",
    or "tools" (never "interests").
    When the new item belongs in an existing family group (AWS, GCP, Azure,
    etc.), set originalText to that group's current text verbatim and
    suggestedText to the rewritten group with the new item inside the
    parentheses:
      originalText: "AWS (EKS, Lambda, Bedrock)"
      suggestedText: "AWS (EKS, Lambda, Bedrock, CloudWatch)"
    When the new item should sit next to a related existing skill, set
    originalText to that neighbor (it will be inserted after it) and
    suggestedText to the new name only. Example: feedback "also add SQL" →
    originalText "PostgreSQL", suggestedText "SQL".
- Never suggest more than one change per bullet. A feedback point that names
  several things (e.g. "add Git, GitHub and code review") may produce several
  suggestions.
- Never touch Education, Extracurriculars, or any field not shown to you below.
- Do not re-suggest something the résumé below already contains.

OUTPUT: JSON matching:
{
  "suggestions": [
    {
      "id": string,                 // e.g. "sugg-1"
      "kind": "bullet-rewrite" | "skill-addition",
      "targetId": string,           // bullet-rewrite: an id from the source below.
                                     // skill-addition: "languages" | "frameworks" | "tools"
      "keyword": string,            // the concrete term being worked in, exactly as it
                                     //   will read on the résumé (e.g. "SQL", "Jest") — not
                                     //   a paraphrase of the feedback
      "originalText": string,       // bullet-rewrite: the bullet's CURRENT text, verbatim.
                                     // skill-addition: the family group or neighbor to
                                     //   place this next to (omit only if it's a true
                                     //   standalone with no related item)
      "suggestedText": string,      // bullet-rewrite: the full reworded bullet text.
                                     // skill-addition: the rewritten family group, or
                                     //   the new standalone skill/tool name
      "rationale": string           // one sentence: which feedback point this satisfies and why it's true of the candidate
    }
  ]
}
Return ONLY the JSON object.`;

const ResponseSchema = z.object({ suggestions: z.array(RawSuggestionSchema) });

export type ResumeSlice = ReturnType<typeof tailorableSlice>;

/**
 * The master resume with earlier accepted suggestions folded in — what the
 * reviewer was looking at. applySuggestions() returns the adjusted skills on
 * its master copy and the reworded bullets on `tailored`; this stitches the
 * two back into one MasterResume so both the prompt and labelGroundedness()
 * see the same text. Never mutates `master`.
 */
export function currentMaster(master: MasterResume, priorAccepted: Suggestion[]): MasterResume {
  const { master: adjusted, tailored } = applySuggestions(master, priorAccepted);
  const rewritten = new Map<string, string>();
  for (const section of [...tailored.experience, ...tailored.projects]) {
    for (const b of section.bullets) rewritten.set(b.sourceId, b.text);
  }
  for (const section of [...adjusted.experience, ...adjusted.projects]) {
    for (const b of section.bullets) b.text = rewritten.get(b.id) ?? b.text;
  }
  return adjusted;
}

/** The tailorable slice of currentMaster() — the prompt's view of the résumé. */
export function currentResumeSlice(master: MasterResume, priorAccepted: Suggestion[]): ResumeSlice {
  return tailorableSlice(currentMaster(master, priorAccepted));
}

export function buildFeedbackUserMessage(feedback: string, jd: string | null, slice: ResumeSlice): string {
  const parts = ["=== REVIEWER FEEDBACK ===", feedback.trim()];
  if (jd?.trim()) parts.push("=== JOB DESCRIPTION (context only) ===", jd.trim());
  parts.push("=== RÉSUMÉ AS IT CURRENTLY STANDS (fixed, one page — reference bullets by id) ===", JSON.stringify(slice));
  return parts.join("\n\n");
}

export async function suggestFromFeedback(
  feedback: string,
  jd: string | null,
  master: MasterResume,
  priorAccepted: Suggestion[],
  apiKey?: string,
  signal?: AbortSignal
): Promise<RawSuggestion[]> {
  const result = await completeJSON(ResponseSchema, {
    system: SYSTEM_PROMPT,
    user: buildFeedbackUserMessage(feedback, jd, currentResumeSlice(master, priorAccepted)),
    temperature: 0.3,
    anthropicApiKey: apiKey,
    signal,
  });
  return result.suggestions;
}
