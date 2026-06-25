import { Bullet, MasterResume, TailoredResume } from "./types";

/**
 * The anti-fabrication backstop. Tailoring may rephrase, reorder, and cut — never
 * invent. This verifies, structurally, that every tailored claim traces back to
 * the master résumé:
 *
 *   1. Every section id and bullet sourceId references a real master entry.
 *   2. Every NUMBER in a tailored bullet appears in its source bullet (no
 *      fabricated metrics — the highest-risk form of résumé lying).
 *   3. Every reordered skill exists in the master skills.
 *
 * Pure functions, no I/O — fully testable without an API call.
 */

export type GroundingViolation = {
  kind: "unknown-section" | "unknown-source" | "fabricated-number" | "unknown-skill";
  detail: string;
};

export type ProvenanceRow = { sourceId: string; sourceText: string; tailoredText: string };

export type GroundingReport = {
  ok: boolean;
  violations: GroundingViolation[];
  provenance: ProvenanceRow[];
};

/** Extracts numeric tokens (money, %, counts, +, k/m/b, million/billion) from text. */
function numbers(text: string): Set<string> {
  const out = new Set<string>();
  const re = /\$?\d[\d,]*\.?\d*\s*(?:%|\+|k|m|b|million|billion|thousand)?/gi;
  for (const match of text.matchAll(re)) {
    const norm = match[0]
      .toLowerCase()
      .replace(/million/g, "m")
      .replace(/billion/g, "b")
      .replace(/thousand/g, "k")
      .replace(/[\s,$]/g, "");
    if (norm) out.add(norm);
  }
  return out;
}

function indexMaster(master: MasterResume) {
  const sections = new Map<string, Map<string, Bullet>>();
  for (const e of [...master.experience, ...master.projects, ...master.extracurriculars]) {
    sections.set(e.id, new Map(e.bullets.map((b) => [b.id, b])));
  }
  const skills = new Set(
    [
      ...master.skills.languages,
      ...master.skills.frameworks,
      ...master.skills.tools,
    ].map((s) => s.toLowerCase())
  );
  return { sections, skills };
}

export function checkGrounding(master: MasterResume, tailored: TailoredResume): GroundingReport {
  const { sections, skills } = indexMaster(master);
  const violations: GroundingViolation[] = [];
  const provenance: ProvenanceRow[] = [];

  for (const section of [...tailored.experience, ...tailored.projects]) {
    const masterBullets = sections.get(section.id);
    if (!masterBullets) {
      violations.push({ kind: "unknown-section", detail: `section id "${section.id}" not in master` });
      continue;
    }
    for (const bullet of section.bullets) {
      const source = masterBullets.get(bullet.sourceId);
      if (!source) {
        violations.push({
          kind: "unknown-source",
          detail: `bullet sourceId "${bullet.sourceId}" not in section "${section.id}"`,
        });
        continue;
      }
      provenance.push({ sourceId: source.id, sourceText: source.text, tailoredText: bullet.text });

      const allowed = numbers(`${source.text} ${source.metrics.join(" ")}`);
      for (const n of numbers(bullet.text)) {
        if (!allowed.has(n)) {
          violations.push({
            kind: "fabricated-number",
            detail: `"${n}" in tailored bullet (from ${source.id}) has no basis in the source: "${source.text}"`,
          });
        }
      }
    }
  }

  for (const skill of tailored.skillsOrder) {
    if (!skills.has(skill.toLowerCase())) {
      violations.push({ kind: "unknown-skill", detail: `skill "${skill}" not in master skills` });
    }
  }

  return { ok: violations.length === 0, violations, provenance };
}
