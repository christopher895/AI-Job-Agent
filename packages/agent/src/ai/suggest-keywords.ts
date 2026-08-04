import { z } from "zod";
import { completeJSON } from "./llm";
import { MasterResume, RawSuggestion, RawSuggestionSchema } from "./types";

const SYSTEM_PROMPT = `You analyze a job description against a candidate's résumé and suggest a
SHORT list of targeted keyword insertions. That is your entire scope.

HARD RULES:
- The résumé below is FIXED and already exactly one page. Do NOT propose
  removing, reordering, cutting, or restructuring anything — every existing
  bullet and skill stays exactly where it is, for every job.
- Each suggestion is one of:
  - "bullet-rewrite": a small wording change to ONE existing bullet (referenced
    by its exact "id" from the source below) that works in a JD keyword or
    technology the bullet doesn't currently mention.
  - "skill-addition": a single skill/technology name to add to one of the
    candidate's skill categories — "targetId" must be exactly "languages",
    "frameworks", or "tools" (never "interests").
- Never suggest more than one change per bullet.
- Never touch Education, Extracurriculars, or any field not shown to you below.
- It is acceptable to suggest a plausible extrapolation beyond what's literally
  stated (e.g. a closely related tool to one already named) — the candidate
  reviews and approves every suggestion before anything is applied. Do not
  invent something wildly unrelated to the source material below.
- Prefer fewer, higher-confidence suggestions (aim for 3-8) over many marginal
  ones. If the JD has little to add, return fewer suggestions — never pad the
  list.

OUTPUT: JSON matching:
{
  "suggestions": [
    {
      "id": string,                 // e.g. "sugg-1"
      "kind": "bullet-rewrite" | "skill-addition",
      "targetId": string,           // bullet-rewrite: an id from the source below.
                                     // skill-addition: "languages" | "frameworks" | "tools"
      "keyword": string,            // the JD term this addresses
      "originalText": string,       // bullet-rewrite only: the bullet's CURRENT text, verbatim
      "suggestedText": string,      // bullet-rewrite: the full reworded bullet text.
                                     // skill-addition: the skill/tool name to add
      "rationale": string           // one sentence: why this JD keyword fits here
    }
  ]
}
Return ONLY the JSON object.`;

const ResponseSchema = z.object({ suggestions: z.array(RawSuggestionSchema) });

function tailorableSlice(master: MasterResume) {
  return {
    experience: master.experience.map((e) => ({
      id: e.id,
      company: e.company,
      bullets: e.bullets.map((b) => ({ id: b.id, text: b.text, tech: b.tech })),
    })),
    projects: master.projects.map((p) => ({
      id: p.id,
      name: p.name,
      bullets: p.bullets.map((b) => ({ id: b.id, text: b.text, tech: b.tech })),
    })),
    skills: {
      languages: master.skills.languages,
      frameworks: master.skills.frameworks,
      tools: master.skills.tools,
    },
  };
}

export async function suggestKeywords(jd: string, master: MasterResume, apiKey?: string): Promise<RawSuggestion[]> {
  const result = await completeJSON(ResponseSchema, {
    system: SYSTEM_PROMPT,
    user: [
      "=== JOB DESCRIPTION ===",
      jd.trim(),
      "=== RÉSUMÉ (fixed, one page — reference bullets by id) ===",
      JSON.stringify(tailorableSlice(master)),
    ].join("\n\n"),
    temperature: 0.3,
    anthropicApiKey: apiKey,
  });
  return result.suggestions;
}
