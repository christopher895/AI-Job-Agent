import type { Bullet, EducationEntry, ExperienceEntry, MasterResume, ProjectEntry } from "./api";

/**
 * Text mode for /resume/master: the master resume as the same Markdown a
 * tailored resume is edited in (mirrors the agent's renderMarkdown), and a
 * deterministic parser back. No LLM — edits apply as you type and nothing is
 * reworded. Ids are carried over from the previous resume so grades and
 * suggestion history that reference bullet ids keep matching.
 */

const SEP = " · ";

function seg(...parts: (string | undefined)[]): string {
  return parts.filter((p) => p && p.trim()).join(SEP);
}

function dateRange(start: string, end: string): string {
  const s = (start ?? "").trim();
  const e = (end ?? "").trim();
  if (s && e) return `${s}–${e}`;
  return s || e;
}

export function masterToMarkdown(mr: MasterResume): string {
  const b = mr.basics;
  const lines: string[] = [`# ${b.name}`];
  const contact = [b.location, b.email, b.phone, b.github, b.portfolio, b.linkedin].filter((s) => s && s.trim());
  if (contact.length) lines.push(contact.join(SEP));
  if (b.summary?.trim()) lines.push("", b.summary.trim());

  if (mr.education.length) {
    lines.push("", "## Education");
    for (const ed of mr.education) {
      lines.push("", `**${ed.school}** — ${seg(ed.degrees.join(", "), ed.location, ed.graduation)}`);
      if (ed.gpa) lines.push(`GPA: ${ed.gpa}`);
      if (ed.notes.length) lines.push(`Notes: ${ed.notes.join(", ")}`);
      if (ed.coursework.length) lines.push(`Coursework: ${ed.coursework.join(", ")}`);
    }
  }

  const entries = (heading: string, list: ExperienceEntry[]) => {
    if (!list.length) return;
    lines.push("", `## ${heading}`);
    for (const e of list) {
      lines.push("", `**${e.company}** — ${seg(e.title, e.location, dateRange(e.start, e.end))}`);
      for (const bl of e.bullets) lines.push(`- ${bl.text}`);
    }
  };

  entries("Experience", mr.experience);

  if (mr.projects.length) {
    lines.push("", "## Projects");
    for (const p of mr.projects) {
      lines.push("", `**${p.name}** · ${seg(p.tech.join(", "), dateRange(p.start, p.end))}`);
      if (p.link) lines.push(p.link);
      for (const bl of p.bullets) lines.push(`- ${bl.text}`);
    }
  }

  entries("Extracurriculars", mr.extracurriculars);

  const s = mr.skills;
  const skillLines: string[] = [];
  if (s.languages.length) skillLines.push(`**Languages:** ${s.languages.join(", ")}`);
  if (s.frameworks.length) skillLines.push(`**Frameworks & Libraries:** ${s.frameworks.join(", ")}`);
  if (s.tools.length) skillLines.push(`**Tools & Technologies:** ${s.tools.join(", ")}`);
  if (s.interests.length) skillLines.push(`**Interests:** ${s.interests.join(", ")}`);
  if (skillLines.length) lines.push("", "## Skills", ...skillLines);

  return lines.join("\n");
}

// ── Parsing ─────────────────────────────────────────────────────────

export type ParseError = { line: number; message: string };
export type ParseResult = { ok: true; resume: MasterResume } | { ok: false; errors: ParseError[] };

/** Comma-separated list; commas inside (), [] or {} don't split — "AWS (EKS, Lambda)" stays one item. */
function list(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const YEAR = /\b(19|20)\d{2}\b/;
const MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\b/i;
function isDateLike(s: string): boolean {
  return YEAR.test(s) || MONTH.test(s) || /\b(present|current|now)\b/i.test(s);
}

function splitDates(s: string): { start: string; end: string } {
  const parts = s.split(/\s*[–—]\s*|\s+-\s+|\s+to\s+/);
  if (parts.length >= 2) return { start: parts[0].trim(), end: parts.slice(1).join(" - ").trim() };
  return { start: s.trim(), end: "" };
}

function splitSegments(s: string): string[] {
  return s.split(/\s+·\s+|\s+\|\s+/).map((x) => x.trim()).filter(Boolean);
}

/** `**Name** — rest` or `**Name** · rest` → [name, rest]; null when not a bold header. */
function boldHeader(line: string): [string, string] | null {
  const m = line.match(/^\*\*(.+?)\*\*\s*(?:[—–-]|·|\|)?\s*(.*)$/);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

function isLink(s: string): boolean {
  return !/\s/.test(s) && /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s);
}

function classifyContact(parts: string[]): MasterResume["basics"] {
  const b = { name: "", location: "", email: "", phone: "", github: "", linkedin: "", portfolio: "", summary: "" };
  const rest: string[] = [];
  for (const p of parts) {
    if (!b.email && /@/.test(p) && !/\s/.test(p)) b.email = p;
    else if (!b.github && /github\.com/i.test(p)) b.github = p;
    else if (!b.linkedin && /linkedin\.com/i.test(p)) b.linkedin = p;
    else if (!b.phone && /^[+()\d\s.-]{7,}$/.test(p) && (p.match(/\d/g)?.length ?? 0) >= 7) b.phone = p;
    else if (!b.portfolio && isLink(p)) b.portfolio = p;
    else rest.push(p);
  }
  b.location = rest.join(SEP);
  return b;
}

type Section = "education" | "experience" | "projects" | "extracurriculars" | "skills";
const SECTION_NAMES: Record<string, Section> = {
  education: "education",
  experience: "experience",
  "work experience": "experience",
  projects: "projects",
  extracurriculars: "extracurriculars",
  "extracurricular activities": "extracurriculars",
  leadership: "extracurriculars",
  skills: "skills",
};

type DraftEntry = { name: string; rest: string; link: string; bullets: string[] };

export function parseMasterMarkdown(md: string, prev: MasterResume): ParseResult {
  const errors: ParseError[] = [];
  const lines = md.split("\n");
  let name = "";
  let contact: string[] | null = null;
  const summary: string[] = [];
  let section: Section | null = null;
  const sections: Record<Exclude<Section, "skills" | "education">, DraftEntry[]> = {
    experience: [],
    projects: [],
    extracurriculars: [],
  };
  const education: EducationEntry[] = [];
  const skills = { languages: [] as string[], frameworks: [] as string[], tools: [] as string[], interests: [] as string[] };
  let current: DraftEntry | null = null;
  let currentEd: EducationEntry | null = null;

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line) return;

    if (/^#\s+/.test(line)) {
      if (name) errors.push({ line: n, message: "Only the first line should start with a single #, for your name." });
      else name = line.replace(/^#\s+/, "").trim();
      return;
    }
    if (/^##\s+/.test(line)) {
      const title = line.replace(/^##\s+/, "").trim().toLowerCase();
      const s = SECTION_NAMES[title];
      if (!s) {
        errors.push({ line: n, message: `Unknown section "${line.replace(/^##\s+/, "")}". Use Education, Experience, Projects, Extracurriculars or Skills.` });
        section = null;
      } else section = s;
      current = null;
      currentEd = null;
      return;
    }

    if (section === null) {
      if (!name) errors.push({ line: n, message: "Start with your name on a line like \"# Your Name\"." });
      else if (contact === null) contact = splitSegments(line);
      else summary.push(line);
      return;
    }

    if (section === "skills") {
      const m = line.match(/^\*\*(.+?):?\*\*:?\s*(.*)$/) ?? line.match(/^([^:]+):\s*(.*)$/);
      const label = m?.[1].replace(/:$/, "").trim().toLowerCase() ?? "";
      const key = label.startsWith("lang") ? "languages"
        : label.startsWith("framework") || label.startsWith("librar") ? "frameworks"
        : label.startsWith("tool") || label.startsWith("tech") ? "tools"
        : label.startsWith("interest") ? "interests" : null;
      if (!m || !key) {
        errors.push({ line: n, message: "Skills lines look like \"**Languages:** Python, Go\" (Languages, Frameworks & Libraries, Tools & Technologies, Interests)." });
        return;
      }
      skills[key] = list(m[2]);
      return;
    }

    if (section === "education") {
      const h = boldHeader(line);
      if (h) {
        const parts = splitSegments(h[1]);
        let graduation = "";
        if (parts.length && isDateLike(parts[parts.length - 1])) graduation = parts.pop()!;
        const location = parts.length > 1 ? parts.pop()! : "";
        currentEd = { school: h[0], degrees: list(parts.join(", ")), location, graduation, coursework: [], notes: [] };
        education.push(currentEd);
        return;
      }
      const kv = line.match(/^(GPA|Notes|Coursework)\s*:\s*(.*)$/i);
      if (kv && currentEd) {
        const k = kv[1].toLowerCase();
        if (k === "gpa") currentEd.gpa = kv[2].trim();
        else if (k === "notes") currentEd.notes = list(kv[2]);
        else currentEd.coursework = list(kv[2]);
        return;
      }
      errors.push({ line: n, message: "In Education, use \"**School** — Degree · Location · Graduation\" then GPA:, Notes: or Coursework: lines." });
      return;
    }

    // experience / projects / extracurriculars
    const h = boldHeader(line);
    if (h) {
      current = { name: h[0], rest: h[1], link: "", bullets: [] };
      sections[section].push(current);
      return;
    }
    if (/^[-*•]\s+/.test(line)) {
      if (!current) {
        errors.push({ line: n, message: "This bullet has no entry above it. Add a header like \"**Company** — Title · Location · Dates\"." });
        return;
      }
      const text = line.replace(/^[-*•]\s+/, "").trim();
      if (text) current.bullets.push(text);
      return;
    }
    if (section === "projects" && current && !current.link && current.bullets.length === 0 && isLink(line)) {
      current.link = line;
      return;
    }
    errors.push({
      line: n,
      message: current
        ? "Start bullets with \"- \". Entry headers look like \"**Name** — …\"."
        : "Each entry starts with a bold header like \"**Company** — Title · Location · Dates\".",
    });
  });

  if (!name) errors.push({ line: 1, message: "Start with your name on a line like \"# Your Name\"." });
  if (errors.length) return { ok: false, errors };

  return { ok: true, resume: buildResume(prev, name, contact ?? [], summary, education, sections, skills) };
}

function buildResume(
  prev: MasterResume,
  name: string,
  contact: string[],
  summary: string[],
  education: EducationEntry[],
  sections: Record<"experience" | "projects" | "extracurriculars", DraftEntry[]>,
  skills: MasterResume["skills"],
): MasterResume {
  const basics = { ...prev.basics, ...classifyContact(contact), name, summary: summary.join("\n") };
  return {
    ...prev,
    basics,
    education: education.map((ed, i) => {
      const old = prev.education.find((o) => o.school.trim().toLowerCase() === ed.school.toLowerCase()) ?? prev.education[i];
      // Merge into the old object so key order (and the form's dirty check) is stable.
      const merged: EducationEntry = { ...(old ?? {}), ...ed };
      if (!ed.gpa) delete merged.gpa;
      return merged;
    }),
    experience: matchAll(sections.experience, prev.experience, (e) => e.company).map(({ d, old }) => toExperience(d, old, "exp")),
    projects: matchAll(sections.projects, prev.projects, (p) => p.name).map(({ d, old }) => toProject(d, old)),
    extracurriculars: matchAll(sections.extracurriculars, prev.extracurriculars, (e) => e.company).map(({ d, old }) =>
      toExperience(d, old, "extra"),
    ),
    skills: { ...prev.skills, ...skills },
  };
}

/** Pairs each parsed entry with the previous entry it most likely is: same name first, else same position. */
function matchAll<T>(drafts: DraftEntry[], olds: T[], key: (t: T) => string): { d: DraftEntry; old: T | undefined }[] {
  const used = new Set<number>();
  const byName = drafts.map((d) => {
    const idx = olds.findIndex((o, j) => !used.has(j) && key(o).trim().toLowerCase() === d.name.toLowerCase());
    if (idx >= 0) used.add(idx);
    return idx;
  });
  return drafts.map((d, i) => {
    let idx = byName[i];
    if (idx < 0 && i < olds.length && !used.has(i)) {
      idx = i;
      used.add(i);
    }
    return { d, old: idx >= 0 ? olds[idx] : undefined };
  });
}

function toExperience(d: DraftEntry, old: ExperienceEntry | undefined, prefix: string): ExperienceEntry {
  const parts = splitSegments(d.rest);
  let start = "";
  let end = "";
  if (parts.length && isDateLike(parts[parts.length - 1])) ({ start, end } = splitDates(parts.pop()!));
  const id = old?.id ?? newId(prefix);
  return {
    ...old,
    id,
    company: d.name,
    title: parts[0] ?? "",
    location: parts.slice(1).join(SEP),
    start,
    end,
    bullets: carryBullets(d.bullets, old?.bullets ?? [], id),
  };
}

function toProject(d: DraftEntry, old: ProjectEntry | undefined): ProjectEntry {
  const parts = splitSegments(d.rest);
  let start = "";
  let end = "";
  if (parts.length && isDateLike(parts[parts.length - 1])) ({ start, end } = splitDates(parts.pop()!));
  const id = old?.id ?? newId("proj");
  return {
    ...old,
    id,
    name: d.name,
    tech: list(parts.join(", ")),
    start,
    end,
    link: d.link,
    repo: old?.repo ?? "",
    bullets: carryBullets(d.bullets, old?.bullets ?? [], id),
  };
}

/** Reuses ids (and tech/metrics/tags) from the previous bullets: identical text first, then same position. */
function carryBullets(texts: string[], olds: Bullet[], prefix: string): Bullet[] {
  const used = new Set<number>();
  const exact = texts.map((t) => {
    const idx = olds.findIndex((o, j) => !used.has(j) && o.text.trim() === t);
    if (idx >= 0) used.add(idx);
    return idx;
  });
  return texts.map((text, i) => {
    let idx = exact[i];
    if (idx < 0 && i < olds.length && !used.has(i)) {
      idx = i;
      used.add(i);
    }
    const old = idx >= 0 ? olds[idx] : undefined;
    return old ? { ...old, text } : { id: newId(prefix), text, tech: [], metrics: [], tags: [] };
  });
}

function newId(prefix: string): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}
