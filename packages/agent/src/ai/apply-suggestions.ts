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

function sameSkill(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** "AWS (EKS, Lambda, Bedrock)" → { family: "AWS", items: ["EKS", "Lambda", "Bedrock"] } */
function parseGroup(entry: string): { family: string; items: string[] } | null {
  const m = entry.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!m || !m[1].trim()) return null;
  return { family: m[1].trim(), items: m[2].split(",").map((s) => s.trim()).filter(Boolean) };
}

function formatGroup(family: string, items: string[]): string {
  return `${family} (${items.join(", ")})`;
}

function mergeGroupItems(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((i) => i.toLowerCase()));
  const merged = [...existing];
  for (const item of incoming) {
    if (!seen.has(item.toLowerCase())) {
      seen.add(item.toLowerCase());
      merged.push(item);
    }
  }
  return merged;
}

/** Well-known children of a vendor family — backstop when the model forgets originalText. */
const FAMILY_CHILDREN: Record<string, string[]> = {
  aws: [
    "cloudwatch",
    "s3",
    "ec2",
    "lambda",
    "eks",
    "ecs",
    "bedrock",
    "rds",
    "dynamodb",
    "sqs",
    "sns",
    "iam",
    "vpc",
    "cloudformation",
    "fargate",
    "sagemaker",
    "athena",
    "glue",
    "api gateway",
    "cognito",
    "cloudfront",
    "route 53",
    "elasticache",
    "redshift",
    "kinesis",
    "opensearch",
    "x-ray",
    "waf",
    "step functions",
  ],
  gcp: ["gke", "bigquery", "cloud run", "cloud functions", "pub/sub", "cloud storage", "dataflow"],
  azure: ["aks", "azure functions", "cosmos db", "blob storage", "app service"],
};

function familyKey(name: string): string | null {
  const n = name.toLowerCase();
  if (n === "aws" || n === "amazon web services" || n.startsWith("aws ")) return "aws";
  if (n === "gcp" || n === "google cloud" || n.startsWith("gcp ") || n.startsWith("google cloud ")) return "gcp";
  if (n === "azure" || n.startsWith("azure ")) return "azure";
  return null;
}

function alreadyListed(category: string[], addition: string): boolean {
  return category.some((c) => {
    if (sameSkill(c, addition)) return true;
    const g = parseGroup(c);
    if (!g) return false;
    return sameSkill(g.family, addition) || g.items.some((i) => sameSkill(i, addition));
  });
}

function findFamilyHost(category: string[], addition: string): number {
  const add = addition.toLowerCase();
  for (let i = 0; i < category.length; i++) {
    const parsed = parseGroup(category[i]);
    const familyName = parsed?.family ?? category[i];
    const key = familyKey(familyName);
    if (!key || sameSkill(familyName, addition) || key === add) continue;
    const children = FAMILY_CHILDREN[key] ?? [];
    if (children.includes(add)) return i;
  }
  return -1;
}

/**
 * Place a new skill next to its family instead of always appending. Prefers
 * folding into an existing "AWS (...)" group; falls back to insert-after a
 * neighbor, then a vendor-family backstop, then append.
 */
export function placeSkill(category: string[], suggestedText: string, originalText?: string): void {
  const proposed = suggestedText.trim();
  if (!proposed) return;

  if (!alreadyListed(category, proposed)) {
    const proposedGroup = parseGroup(proposed);

    if (proposedGroup) {
      const hostIdx = category.findIndex((c) => {
        const g = parseGroup(c);
        return g !== null && sameSkill(g.family, proposedGroup.family);
      });
      if (hostIdx >= 0) {
        const host = parseGroup(category[hostIdx])!;
        category[hostIdx] = formatGroup(host.family, mergeGroupItems(host.items, proposedGroup.items));
      } else {
        category.push(proposed);
      }
    } else if (originalText) {
      const idx = category.findIndex((c) => sameSkill(c, originalText));
      if (idx >= 0) {
        const host = parseGroup(category[idx]);
        if (host) {
          category[idx] = formatGroup(host.family, mergeGroupItems(host.items, [proposed]));
        } else {
          category.splice(idx + 1, 0, proposed);
        }
      } else {
        const familyIdx = findFamilyHost(category, proposed);
        if (familyIdx >= 0) {
          nestOrInsert(category, familyIdx, proposed);
        } else {
          category.push(proposed);
        }
      }
    } else {
      const familyIdx = findFamilyHost(category, proposed);
      if (familyIdx >= 0) {
        nestOrInsert(category, familyIdx, proposed);
      } else {
        category.push(proposed);
      }
    }
  }

  foldOrphanFamilyMembers(category);
}

function nestOrInsert(category: string[], hostIdx: number, proposed: string): void {
  const host = parseGroup(category[hostIdx]);
  if (host) {
    category[hostIdx] = formatGroup(host.family, mergeGroupItems(host.items, [proposed]));
    return;
  }
  category.splice(hostIdx + 1, 0, proposed);
}

/** Pull standalone vendor services (CloudWatch, S3, …) into an existing family group. */
function foldOrphanFamilyMembers(category: string[]): void {
  for (let i = category.length - 1; i >= 0; i--) {
    if (parseGroup(category[i])) continue;
    const hostIdx = findFamilyHost(category, category[i]);
    if (hostIdx < 0 || hostIdx === i) continue;
    const host = parseGroup(category[hostIdx]);
    if (!host) continue;
    category[hostIdx] = formatGroup(host.family, mergeGroupItems(host.items, [category[i]]));
    category.splice(i, 1);
  }
}

/**
 * Applies only the accepted suggestions on top of the master resume. Every
 * bullet from every experience/project is included, in master order — this
 * flow never cuts or restructures sections, only rewrites specific bullets
 * or adds/regroups specific skills that Christopher explicitly checked off.
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
    placeSkill(adjustedMaster.skills[s.targetId], s.suggestedText, s.originalText);
  }

  for (const category of SKILL_CATEGORIES) {
    foldOrphanFamilyMembers(adjustedMaster.skills[category]);
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
