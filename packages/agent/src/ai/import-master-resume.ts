import { completeJSON } from "./llm";
import { MasterResume, MasterResumeSchema } from "./types";

const SYSTEM_PROMPT = `You extract structured résumé data from raw text — pasted from a Google Doc,
LaTeX source, or text extracted from a PDF — into a fixed JSON schema.

HARD RULES:
- This is an IMPORT, not a rewrite: copy bullet wording, dates, titles, and company
  names EXACTLY as they appear in the input. Do not improve, shorten, or rephrase
  anything, even if it reads awkwardly.
- Invent a stable "id" for every experience entry, project, and bullet, following
  the pattern "exp-<slug>-<n>" / "proj-<slug>-<n>" for entries (e.g. "exp-acme",
  "proj-recipe-finder") and "<entry-id>-<n>" for that entry's bullets in order
  (e.g. "exp-acme-1", "exp-acme-2").
- If a field isn't present in the input (LinkedIn URL, GPA, a project's repo link,
  etc.), leave it as an empty string or empty array — never guess or invent a value.
- Per bullet: "tech" is tools/technologies literally named in that bullet's own
  text; "metrics" is any number/percentage/dollar amount already in that bullet's
  text (never invent one that isn't there); "tags" may be left as an empty array.
- Classify every skill mentioned anywhere in the input into exactly one of
  skills.languages / skills.frameworks / skills.tools — never invent a skill not
  present in the input. skills.interests is usually absent from a resume; leave
  it as an empty array unless the input has an explicit interests/hobbies section.

OUTPUT: a single JSON object matching this exact shape:
{
  "basics": { "name": string, "location": string, "email": string, "phone": string,
              "github": string, "linkedin": string, "portfolio": string, "summary": string },
  "education": [{ "school": string, "degrees": string[], "location": string,
                   "gpa": string, "graduation": string, "coursework": string[], "notes": string[] }],
  "experience": [{ "id": string, "company": string, "title": string, "location": string,
                    "start": string, "end": string,
                    "bullets": [{ "id": string, "text": string, "tech": string[], "metrics": string[], "tags": string[] }] }],
  "projects": [{ "id": string, "name": string, "tech": string[], "start": string, "end": string,
                  "link": string, "repo": string, "bullets": [ /* same bullet shape as above */ ] }],
  "extracurriculars": [ /* same shape as experience entries */ ],
  "skills": { "languages": string[], "frameworks": string[], "tools": string[], "interests": string[] }
}
Return ONLY the JSON object.`;

/**
 * The LLM invents entry/bullet ids during import with no uniqueness guarantee
 * — two similarly-named roles or projects can collide. Renumbers everything
 * deterministically after the fact so ids are always globally unique,
 * regardless of what the model produced. Shared across experience, projects,
 * AND extracurriculars — format.ts's buildMeta() keys a Map by entry id
 * across experience+extracurriculars together, so cross-category uniqueness
 * matters too, not just within one category.
 */
export function dedupeIds(mr: MasterResume): MasterResume {
  const seenEntryIds = new Set<string>();

  function uniqueEntryId(base: string): string {
    let id = base || "entry";
    let n = 2;
    while (seenEntryIds.has(id)) {
      id = `${base}-${n}`;
      n++;
    }
    seenEntryIds.add(id);
    return id;
  }

  function renumberBullets<B extends { id: string }>(entryId: string, bullets: B[]): B[] {
    return bullets.map((b, i) => ({ ...b, id: `${entryId}-${i + 1}` }));
  }

  const experience = mr.experience.map((e) => {
    const id = uniqueEntryId(e.id);
    return { ...e, id, bullets: renumberBullets(id, e.bullets) };
  });
  const projects = mr.projects.map((p) => {
    const id = uniqueEntryId(p.id);
    return { ...p, id, bullets: renumberBullets(id, p.bullets) };
  });
  const extracurriculars = mr.extracurriculars.map((e) => {
    const id = uniqueEntryId(e.id);
    return { ...e, id, bullets: renumberBullets(id, e.bullets) };
  });

  return { ...mr, experience, projects, extracurriculars };
}

export async function importMasterResume(rawText: string): Promise<MasterResume> {
  const parsed = await completeJSON(MasterResumeSchema, {
    system: SYSTEM_PROMPT,
    user: rawText,
    temperature: 0.1,
  });
  return dedupeIds(parsed);
}
