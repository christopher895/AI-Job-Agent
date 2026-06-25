import { MasterResume, TailoredResume } from "./types";
import {
  WEAK_PHRASES,
  STRONG_ACTION_VERBS,
  ACRONYM_EXPANSIONS,
  BULLET_GUIDELINES,
} from "./knowledge/best-practices";

/**
 * Deterministic formatting layer. The LLM emits STRUCTURE (sections + bullets);
 * format correctness is produced here, not trusted to the model:
 *   - renderMarkdown(): an ATS-safe single-column document (no tables/columns/icons).
 *   - lintFormat(): computable checks the renderer can't enforce.
 *   - masterVocabulary() + keywordCoverage(): the deterministic JD-match signal.
 *
 * All pure functions — no I/O, fully testable offline.
 */

type SectionMeta = { header: string; link: string };

function buildMeta(master: MasterResume): Map<string, SectionMeta> {
  const meta = new Map<string, SectionMeta>();
  for (const e of [...master.experience, ...master.extracurriculars]) {
    meta.set(e.id, {
      header: `**${e.company}** — ${e.title} · ${e.location} · ${e.start}–${e.end}`,
      link: "",
    });
  }
  for (const p of master.projects) {
    meta.set(p.id, {
      header: `**${p.name}** · ${p.tech.join(", ")} · ${p.start}–${p.end}`,
      link: p.link,
    });
  }
  return meta;
}

/** ATS-safe single-column Markdown. Standard headings; tech inline; links surfaced. */
export function renderMarkdown(master: MasterResume, tailored: TailoredResume): string {
  const meta = buildMeta(master);
  const lines: string[] = [];

  const b = master.basics;
  lines.push(`# ${b.name}`);
  const contact = [b.location, b.email, b.phone, b.github, b.portfolio, b.linkedin].filter(Boolean);
  if (contact.length) lines.push(contact.join(" · "));
  if (tailored.summary) lines.push("", tailored.summary);

  const renderSections = (heading: string, sections: TailoredResume["experience"]) => {
    if (!sections.length) return;
    lines.push("", `## ${heading}`);
    for (const s of sections) {
      const m = meta.get(s.id);
      lines.push("", m ? m.header : `**${s.id}**`);
      if (m?.link) lines.push(m.link);
      for (const bullet of s.bullets) lines.push(`- ${bullet.text}`);
    }
  };

  renderSections("Experience", tailored.experience);
  renderSections("Projects", tailored.projects);

  // Skills: front-load the tailored order, then any remaining master skills.
  const allSkills = [
    ...master.skills.languages,
    ...master.skills.frameworks,
    ...master.skills.tools,
  ];
  const ordered = [
    ...tailored.skillsOrder,
    ...allSkills.filter((s) => !tailored.skillsOrder.some((o) => o.toLowerCase() === s.toLowerCase())),
  ];
  lines.push("", "## Skills", ordered.join(" · "));

  // Education (untailored — facts are fixed).
  if (master.education.length) {
    lines.push("", "## Education");
    for (const ed of master.education) {
      lines.push("", `**${ed.school}** — ${ed.degrees.join(", ")} · ${ed.location} · ${ed.graduation}`);
      if (ed.gpa) lines.push(`GPA: ${ed.gpa}`);
    }
  }

  return lines.join("\n");
}

export type FormatIssue = { level: "error" | "warning"; rule: string; detail: string };
export type FormatReport = { score: number; issues: FormatIssue[] };

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Deterministic ATS/format checks over the tailored bullets. */
export function lintFormat(master: MasterResume, tailored: TailoredResume): FormatReport {
  const meta = buildMeta(master);
  const issues: FormatIssue[] = [];
  const sections = [...tailored.experience, ...tailored.projects];
  const allText = sections.flatMap((s) => s.bullets.map((x) => x.text)).join("\n");

  let bulletCount = 0;
  for (const s of sections) {
    for (const { text } of s.bullets) {
      bulletCount++;
      const lower = text.toLowerCase();
      const first = text.trim().split(/\s+/)[0] ?? "";

      const weak = WEAK_PHRASES.find((p) => lower.startsWith(p));
      if (weak) issues.push({ level: "error", rule: "weak-opener", detail: `bullet starts with "${weak}": "${text}"` });
      else if (!STRONG_ACTION_VERBS.some((v) => v.toLowerCase() === first.toLowerCase()))
        issues.push({ level: "warning", rule: "weak-verb", detail: `bullet doesn't open with a strong action verb: "${first}…"` });

      const words = wordCount(text);
      if (words > 45) issues.push({ level: "error", rule: "bullet-too-long", detail: `${words} words (>2 lines): "${text}"` });
      else if (words > BULLET_GUIDELINES.idealWordRange[1] + 14)
        issues.push({ level: "warning", rule: "bullet-long", detail: `${words} words: "${text}"` });
    }
  }

  // Acronyms used should appear spelled-out somewhere at least once.
  for (const [acr, expansion] of Object.entries(ACRONYM_EXPANSIONS)) {
    const re = new RegExp(`\\b${acr.replace("/", "\\/")}\\b`, "i");
    if (re.test(allText) && !allText.toLowerCase().includes(expansion.toLowerCase()))
      issues.push({ level: "warning", rule: "acronym-unexpanded", detail: `"${acr}" used without spelling out "${expansion}" once` });
  }

  // hiring-agent's biggest lever: included projects should carry a link.
  for (const p of tailored.projects) {
    if (!meta.get(p.id)?.link)
      issues.push({ level: "warning", rule: "project-no-link", detail: `project "${p.id}" has no link (hiring-agent −30–50%)` });
  }

  // One-page budget heuristic.
  if (bulletCount > 18) issues.push({ level: "warning", rule: "length-budget", detail: `${bulletCount} bullets — likely exceeds one page` });

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  const score = Math.max(0, 100 - errors * 15 - warnings * 3);
  return { score, issues };
}

/** Lowercased set of every tool/skill the candidate truthfully has. */
export function masterVocabulary(master: MasterResume): Set<string> {
  const vocab = new Set<string>();
  const add = (s: string) => s && vocab.add(s.toLowerCase());
  [...master.skills.languages, ...master.skills.frameworks, ...master.skills.tools].forEach(add);
  for (const e of [...master.experience, ...master.projects, ...master.extracurriculars])
    for (const bl of e.bullets) bl.tech.forEach(add);
  for (const p of master.projects) p.tech.forEach(add);
  return vocab;
}

export type KeywordCoverage = {
  /** Skills the candidate has that the JD also asks for. */
  relevant: string[];
  /** Of those, the ones surfaced in the tailored résumé. */
  covered: string[];
  /** Relevant skills NOT surfaced — actionable gaps for the critic/loop. */
  missing: string[];
  /** covered / relevant, 0–1. */
  ratio: number;
};

/** Deterministic JD-match: which truthful, JD-relevant skills did we surface? */
export function keywordCoverage(master: MasterResume, tailored: TailoredResume, jd: string): KeywordCoverage {
  const vocab = masterVocabulary(master);
  const jdLower = jd.toLowerCase();
  // Only count what the TAILORING surfaced (ordered skills + selected bullets + summary),
  // not renderMarkdown's full fallback skills dump — otherwise coverage is trivially 100%.
  const surfaced = [
    tailored.summary,
    tailored.skillsOrder.join(" "),
    tailored.keywordsCovered.join(" "),
    ...[...tailored.experience, ...tailored.projects].flatMap((s) => s.bullets.map((b) => b.text)),
  ].join(" ").toLowerCase();
  const resumeText = surfaced;

  const relevant = [...vocab].filter((term) => jdLower.includes(term));
  const covered = relevant.filter((term) => resumeText.includes(term));
  const missing = relevant.filter((term) => !resumeText.includes(term));
  return {
    relevant,
    covered,
    missing,
    ratio: relevant.length ? covered.length / relevant.length : 1,
  };
}
