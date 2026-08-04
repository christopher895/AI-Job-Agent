import { MasterResume, RawSuggestion, Suggestion, TailoredResume, Bullet } from "./types";
import { numbers } from "./grounding";

function allBullets(master: MasterResume): Bullet[] {
  return [...master.experience, ...master.projects].flatMap((section) => section.bullets);
}

function findBullet(master: MasterResume, id: string): Bullet | null {
  return allBullets(master).find((b) => b.id === id) ?? null;
}

/** Every word a suggestion could plausibly point back to: bullet text/tech/metrics plus all skills. */
function masterHaystack(master: MasterResume): string {
  const bulletText = allBullets(master)
    .flatMap((b) => [b.text, ...b.tech, ...b.metrics])
    .join(" ");
  const skillText = [...master.skills.languages, ...master.skills.frameworks, ...master.skills.tools].join(" ");
  return `${bulletText} ${skillText}`.toLowerCase();
}

/**
 * Deterministic, not LLM-self-reported (a model grading its own honesty is a
 * weak signal — see grounding.ts's existing "deterministic backstop"
 * philosophy). A suggestion is "grounded" only if:
 *   - its JD keyword already appears somewhere in the master resume, AND
 *   - (bullet-rewrite only) it introduces no number beyond the source bullet's own.
 * Anything else is "extrapolated" — still shown to the user, never silently blocked.
 */
export function labelGroundedness(master: MasterResume, raw: RawSuggestion): "grounded" | "extrapolated" {
  const haystack = masterHaystack(master);
  const keywordGrounded = haystack.includes(raw.keyword.toLowerCase());

  if (raw.kind === "skill-addition") {
    return keywordGrounded ? "grounded" : "extrapolated";
  }

  const source = findBullet(master, raw.targetId);
  if (!source) return "extrapolated"; // unknown bullet id — treat conservatively

  const allowedNumbers = numbers(`${source.text} ${source.metrics.join(" ")}`);
  const hasNewNumber = [...numbers(raw.suggestedText)].some((n) => !allowedNumbers.has(n));

  return keywordGrounded && !hasNewNumber ? "grounded" : "extrapolated";
}

const SKILL_CATEGORIES = ["languages", "frameworks", "tools"] as const;
type SkillCategory = (typeof SKILL_CATEGORIES)[number];
function isSkillCategory(s: string): s is SkillCategory {
  return (SKILL_CATEGORIES as readonly string[]).includes(s);
}

/**
 * Applies only the accepted suggestions on top of the master resume. Every
 * bullet from every experience/project is included, in master order — this
 * flow never reorders, cuts, or restructures anything, only rewrites specific
 * bullets or adds specific skills that Christopher explicitly checked off.
 *
 * Returns an adjusted master (skill additions merged in) plus a full-coverage
 * TailoredResume, so the existing renderMarkdown(master, tailored) from
 * format.ts can render the result unchanged — no new markdown renderer.
 */
export function applySuggestions(
  master: MasterResume,
  accepted: Suggestion[]
): { master: MasterResume; tailored: TailoredResume } {
  const adjustedMaster: MasterResume = JSON.parse(JSON.stringify(master));

  for (const s of accepted) {
    if (s.kind !== "skill-addition" || !isSkillCategory(s.targetId)) continue;
    const category = adjustedMaster.skills[s.targetId];
    const already = category.some((c) => c.toLowerCase() === s.suggestedText.toLowerCase());
    if (!already) category.push(s.suggestedText);
  }

  const rewrites = new Map(
    accepted.filter((s) => s.kind === "bullet-rewrite").map((s) => [s.targetId, s.suggestedText])
  );

  const tailorSection = (sections: MasterResume["experience"] | MasterResume["projects"]) =>
    sections.map((section) => ({
      id: section.id,
      bullets: section.bullets.map((bullet) => ({
        sourceId: bullet.id,
        text: rewrites.get(bullet.id) ?? bullet.text,
      })),
    }));

  const tailored: TailoredResume = {
    experience: tailorSection(master.experience),
    projects: tailorSection(master.projects),
    skillsOrder: [], // renderMarkdown falls back to master's own order when empty — nothing is re-ranked
    keywordsCovered: accepted.map((s) => s.keyword),
    cut: [],
    reasoning: "",
  };

  return { master: adjustedMaster, tailored };
}
