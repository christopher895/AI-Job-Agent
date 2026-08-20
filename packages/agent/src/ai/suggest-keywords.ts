import { z } from "zod";
import { completeJSON } from "./llm";
import { normalizeSkillCategories } from "./apply-suggestions";
import { MasterResume, RawSuggestion, RawSuggestionSchema } from "./types";

const SYSTEM_PROMPT = `You analyze a job description against a candidate's résumé and suggest a
SHORT list of targeted keyword insertions. That is your entire scope.

HARD RULES:
- The résumé below is FIXED and already exactly one page. Do NOT propose
  removing, cutting, or restructuring experience/project bullets — every
  existing bullet stays exactly where it is, for every job.
- You MAY regroup and reorder items WITHIN a skill category so related tools
  sit together. Do not invent a new category and do not touch Interests.
  A related tool must never be dumped at the end of the list when a family
  group already exists. Examples:
  - CloudWatch / S3 / IAM belong inside an existing "AWS (...)" group, not
    as a new trailing item.
  - Docker and Kubernetes should sit next to each other.
  - Argo CD and Kargo should sit next to each other.
- Each suggestion is one of:
  - "bullet-rewrite": a small wording change to ONE existing bullet (referenced
    by its exact "id" from the source below) that works in a JD keyword or
    technology the bullet doesn't currently mention.
  - "skill-addition": a skill/technology to add to one of the candidate's
    skill categories — "targetId" must be exactly "languages", "frameworks",
    or "tools" (never "interests").
    When the new item belongs in an existing family group (AWS, GCP, Azure,
    etc.), set originalText to that group's current text verbatim and
    suggestedText to the rewritten group with the new item inside the
    parentheses:
      originalText: "AWS (EKS, Lambda, Bedrock)"
      suggestedText: "AWS (EKS, Lambda, Bedrock, CloudWatch)"
    When the new item should sit next to a related standalone skill rather
    than at the end, set originalText to that neighbor (it will be inserted
    after it) and suggestedText to the new name only.
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
      "originalText": string,       // bullet-rewrite: the bullet's CURRENT text, verbatim.
                                     // skill-addition: the family group or neighbor to
                                     //   place this next to (omit only if it's a true
                                     //   standalone with no related item)
      "suggestedText": string,      // bullet-rewrite: the full reworded bullet text.
                                     // skill-addition: the rewritten family group, or
                                     //   the new standalone skill/tool name
      "rationale": string           // one sentence: why this JD keyword fits here
    }
  ]
}
Return ONLY the JSON object.`;

const ResponseSchema = z.object({ suggestions: z.array(RawSuggestionSchema) });

function tailorableSlice(master: MasterResume) {
  const normalized: MasterResume = JSON.parse(JSON.stringify(master));
  normalizeSkillCategories(normalized);
  return {
    experience: normalized.experience.map((e) => ({
      id: e.id,
      company: e.company,
      bullets: e.bullets.map((b) => ({ id: b.id, text: b.text, tech: b.tech })),
    })),
    projects: normalized.projects.map((p) => ({
      id: p.id,
      name: p.name,
      bullets: p.bullets.map((b) => ({ id: b.id, text: b.text, tech: b.tech })),
    })),
    skills: {
      languages: normalized.skills.languages,
      frameworks: normalized.skills.frameworks,
      tools: normalized.skills.tools,
    },
  };
}

export async function suggestKeywords(
  jd: string,
  master: MasterResume,
  apiKey?: string,
  signal?: AbortSignal
): Promise<RawSuggestion[]> {
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
    signal,
  });
  return result.suggestions;
}
