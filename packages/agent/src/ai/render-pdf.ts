import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { MasterResume } from "./types";

const execFileAsync = promisify(execFile);

// Path to the checked-in LaTeX template directory
const TEMPLATE_DIR = path.join(__dirname, "../../../../Resume_Template");
const TECTONIC = process.env.TECTONIC_PATH || "tectonic";

function allowHtmlFallback(): boolean {
  return /^(1|true|yes)$/i.test(process.env.ALLOW_HTML_PDF_FALLBACK ?? "");
}

// ─── LaTeX escaping ──────────────────────────────────────────────────────────

export function tex(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/_/g, "\\_")
    .replace(/–/g, "--")   // en-dash → LaTeX double dash
    .replace(/—/g, "---")  // em-dash → LaTeX triple dash
    // Raw "·" (U+00B7) has no reliable glyph under this template's legacy
    // 8-bit font stack (mathptmx + T1 fontenc, no fontspec/inputenc) and
    // renders as mojibake (e.g. "˚u"). \textperiodcentered is the LaTeX-safe
    // macro for the same glyph, safe under any font encoding.
    .replace(/·/g, "\\textperiodcentered{}");
}

function texUrl(s: string): string {
  // URLs inside \href{} only need % and # escaped
  return String(s ?? "").replace(/%/g, "\\%").replace(/#/g, "\\#");
}

function inlineTex(s: string): string {
  return s.split(/\*\*(.+?)\*\*/).map((p, i) => i % 2 === 1 ? `\\textbf{${tex(p)}}` : tex(p)).join("");
}

// ─── Markdown parser ─────────────────────────────────────────────────────────

type ContactFields = {
  location: string;
  email: string;
  phone: string;
  github: string;
  linkedin: string;
  portfolio: string;
};

// Matches US phone formats with any mix of separators around the area code,
// including "(704)-877-1460" (paren immediately followed by a hyphen, no
// space) — the original regex required exactly one separator char between
// each digit group, which silently rejected that combination.
const PHONE_RE = /^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]?\d{4}$/;

// A bare domain like "christopherzhang.dev" (no http/www prefix) — the kind
// of thing a portfolio field legitimately contains once a user drops the
// protocol while editing.
const BARE_DOMAIN_RE = /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(\/\S*)?$/i;

export function parseContactLine(line: string): ContactFields {
  const f: ContactFields = { location: "", email: "", phone: "", github: "", linkedin: "", portfolio: "" };
  const otherUrls: string[] = [];
  for (const part of line.split(" · ").map(s => s.trim())) {
    if (part.includes("@") && !part.startsWith("http")) f.email = part;
    else if (PHONE_RE.test(part)) f.phone = part;
    else if (part.includes("github.com")) f.github = part;
    else if (part.includes("linkedin.com")) f.linkedin = part;
    else if (part.startsWith("http") || part.startsWith("www.") || BARE_DOMAIN_RE.test(part)) otherUrls.push(part);
    else if (!f.location) f.location = part;
  }
  // Any remaining URLs (not github/linkedin) are portfolio links, in order of appearance.
  // Only the first is kept — buildLatex has one portfolio slot — so nothing is silently
  // overwritten by a later URL the way a single shared "else" bucket would.
  if (otherUrls.length) f.portfolio = otherUrls[0];
  return f;
}

// A header line looks like "**Name** <dash> rest" or "**Name** · rest". Editors will
// type whichever dash their keyboard/autocorrect produces (-, –, —), so accept all three
// as long as they're a standalone token (surrounded by whitespace) — this avoids matching
// a hyphen inside a compound word like "Full-Stack".
const HEADER_DASH_SPLIT = /^\*\*(.+?)\*\*\s+[-–—]\s+(.+)$/;
const HEADER_DOT_SPLIT = /^\*\*(.+?)\*\*\s*·\s*(.+)$/;

/** Splits "a · b · c" respecting that any field may itself be empty. */
function splitDots(s: string): string[] {
  return s.split(" · ").map((p) => p.trim());
}

type ExpEntry  = { company: string; title: string; location: string; dates: string; bullets: string[] };
type ProjEntry = { name: string; tech: string; dates: string; link: string; bullets: string[] };
type EduEntry  = { school: string; degrees: string; location: string; graduation: string; gpa?: string; notes?: string; coursework?: string };

type ParsedDoc = {
  name: string;
  contact: ContactFields;
  summary: string;
  experience: ExpEntry[];
  projects: ProjEntry[];
  extracurriculars: ExpEntry[];
  skills: string[];
  education: EduEntry[];
};

/**
 * Parses a "**Company** — Title · Location · Start–End" style header. Used for
 * both Experience and Extracurriculars, which share the exact same shape.
 * Throws instead of silently dropping the line or merging its bullets into the
 * previous entry — a malformed header should surface as a visible render error,
 * not vanish from the PDF.
 */
function parseExpHeader(line: string, section: string): ExpEntry {
  const m = line.match(HEADER_DASH_SPLIT);
  if (!m) {
    throw new Error(
      `Couldn't parse ${section} entry header: "${line}" — expected ` +
      `"**Company** — Title · Location · Start–End"`
    );
  }
  const parts = splitDots(m[2]);
  return {
    company: m[1],
    title: parts[0] ?? "",
    location: parts[1] ?? "",
    dates: parts.slice(2).join(" · ").replace(/–/g, "--"),
    bullets: [],
  };
}

function parseMd(md: string): ParsedDoc {
  const lines = md.split("\n");
  let i = 0;
  const doc: ParsedDoc = {
    name: "", contact: { location: "", email: "", phone: "", github: "", linkedin: "", portfolio: "" },
    summary: "", experience: [], projects: [], extracurriculars: [], skills: [], education: [],
  };

  if (lines[i]?.startsWith("# ")) { doc.name = lines[i].slice(2).trim(); i++; }
  if (i < lines.length && !lines[i].startsWith("##")) { doc.contact = parseContactLine(lines[i]); i++; }

  const summaryParts: string[] = [];
  while (i < lines.length && !lines[i].startsWith("## ")) {
    const l = lines[i].trim();
    if (l) summaryParts.push(l);
    i++;
  }
  doc.summary = summaryParts.join(" ");

  while (i < lines.length) {
    if (!lines[i].startsWith("## ")) { i++; continue; }
    const section = lines[i].slice(3).trim().toLowerCase();
    i++;

    if (section === "experience" || section === "extracurriculars") {
      const bucket = section === "experience" ? doc.experience : doc.extracurriculars;
      let cur: ExpEntry | null = null;
      while (i < lines.length && !lines[i].startsWith("## ")) {
        const l = lines[i].trim();
        if (l.startsWith("**")) {
          if (cur) bucket.push(cur);
          cur = parseExpHeader(l, section);
        } else if (l.startsWith("- ")) {
          if (!cur) throw new Error(`Bullet "${l}" appears before any ${section} header`);
          cur.bullets.push(l.slice(2));
        }
        i++;
      }
      if (cur) bucket.push(cur);

    } else if (section === "projects") {
      let cur: ProjEntry | null = null;
      while (i < lines.length && !lines[i].startsWith("## ")) {
        const l = lines[i].trim();
        if (l.startsWith("**")) {
          if (cur) doc.projects.push(cur);
          const m = l.match(HEADER_DOT_SPLIT);
          if (!m) {
            throw new Error(
              `Couldn't parse project entry header: "${l}" — expected ` +
              `"**Name** · Tech · Start–End"`
            );
          }
          const parts = splitDots(m[2]);
          const dates = (parts.pop() ?? "").replace(/–/g, "--");
          cur = { name: m[1], tech: parts.join(", "), dates, link: "", bullets: [] };
        } else if ((l.startsWith("http") || l.startsWith("www.")) && !l.startsWith("- ")) {
          if (!cur) throw new Error(`Project link "${l}" appears before any project header`);
          if (!cur.link) cur.link = l;
        } else if (l.startsWith("- ")) {
          if (!cur) throw new Error(`Bullet "${l}" appears before any project header`);
          cur.bullets.push(l.slice(2));
        }
        i++;
      }
      if (cur) doc.projects.push(cur);

    } else if (section === "skills") {
      while (i < lines.length && !lines[i].startsWith("## ")) {
        const l = lines[i].trim();
        if (l) doc.skills.push(l);
        i++;
      }

    } else if (section === "education") {
      let cur: EduEntry | null = null;
      while (i < lines.length && !lines[i].startsWith("## ")) {
        const l = lines[i].trim();
        if (l.startsWith("**")) {
          if (cur) doc.education.push(cur);
          const m = l.match(HEADER_DASH_SPLIT);
          if (!m) {
            throw new Error(
              `Couldn't parse education entry header: "${l}" — expected ` +
              `"**School** — Degrees · Location · Graduation"`
            );
          }
          const parts = splitDots(m[2]);
          cur = { school: m[1], degrees: parts[0] ?? "", location: parts[1] ?? "", graduation: parts.slice(2).join(" · ") };
        } else if (l.startsWith("GPA:")) {
          if (!cur) throw new Error(`"${l}" appears before any education header`);
          cur.gpa = l.slice(4).trim();
        } else if (l.startsWith("Notes:")) {
          if (!cur) throw new Error(`"${l}" appears before any education header`);
          cur.notes = l.slice(6).trim();
        } else if (l.startsWith("Coursework:")) {
          if (!cur) throw new Error(`"${l}" appears before any education header`);
          cur.coursework = l.slice(11).trim();
        }
        i++;
      }
      if (cur) doc.education.push(cur);

    } else {
      while (i < lines.length && !lines[i].startsWith("## ")) i++;
    }
  }

  return doc;
}

// ─── LaTeX document generator ─────────────────────────────────────────────────

function buildLatex(doc: ParsedDoc): string {
  const c = doc.contact;
  const addrParts: string[] = [];
  if (c.email)    addrParts.push(`\\href{mailto:${texUrl(c.email)}}{${tex(c.email)}}`);
  if (c.phone)    addrParts.push(tex(c.phone));
  if (c.github)   addrParts.push(`\\href{${texUrl(c.github)}}{${tex(c.github.replace(/^https?:\/\//, ""))}}`);
  if (c.linkedin) addrParts.push(`\\href{${texUrl(c.linkedin)}}{${tex(c.linkedin.replace(/^https?:\/\//, ""))}}`);
  if (c.portfolio) addrParts.push(`\\href{${texUrl(c.portfolio)}}{${tex(c.portfolio.replace(/^https?:\/\//, ""))}}`);

  const lines: string[] = [];

  lines.push(
    `\\documentclass[10pt]{czresume}`,
    `\\usepackage[left=0.4in,top=0.4in,right=0.4in,bottom=0.4in]{geometry}`,
    ``,
    `\\name{${tex(doc.name)}}`,
    `\\address{${addrParts.join(" \\\\ ")}}`,
    ``,
    `\\begin{document}`,
  );

  if (doc.summary) {
    lines.push(``, `\\vspace{2pt}\\small{${tex(doc.summary)}}\\vspace{4pt}`);
  }

  // Education
  if (doc.education.length) {
    lines.push(``, `\\begin{rSection}{Education}`, ``);
    for (let idx = 0; idx < doc.education.length; idx++) {
      const e = doc.education[idx];
      const isLastEntry = idx === doc.education.length - 1;
      const fields: string[] = [
        `{\\bf ${tex(e.school)},} {\\em ${tex(e.degrees)}} \\hfill {${tex(e.location)}}`,
      ];
      const gpaAndNotes = [e.gpa && `\\textbf{GPA:} ${tex(e.gpa)}`, e.notes && tex(e.notes)].filter(Boolean).join(", ");
      if (gpaAndNotes) fields.push(`${gpaAndNotes} \\hfill {\\em ${tex(e.graduation)}}`);
      if (e.coursework) fields.push(`\\textbf{Relevant Coursework:} ${tex(e.coursework)}`);
      // Every field forces a line break except the last field of the last
      // entry: a trailing "\\" right before "\end{rSection}" doubles the
      // gap to the next section (the "\\" break plus the blank-line
      // paragraph break both add vertical space) — every other section
      // ends with "\end{itemize}" instead, which has no such trailing break.
      fields.forEach((field, fieldIdx) => {
        const isLastField = isLastEntry && fieldIdx === fields.length - 1;
        lines.push(isLastField ? field : `${field}\\\\`);
      });
    }
    lines.push(``, `\\end{rSection}`);
  }

  // Experience
  if (doc.experience.length) {
    lines.push(``, `\\begin{rSection}{Experience}`, ``);
    for (let idx = 0; idx < doc.experience.length; idx++) {
      const e = doc.experience[idx];
      lines.push(
        `\\textbf{${tex(e.company)}} \\hfill {${tex(e.location)}}\\\\`,
        `\\textbf{${tex(e.title)}} \\hfill {\\em ${tex(e.dates)}}`,
      );
      if (e.bullets.length) {
        lines.push(`\\begin{itemize}`);
        for (const b of e.bullets) lines.push(`    \\item ${tex(b)}`);
        lines.push(`\\end{itemize}`);
      }
      if (idx < doc.experience.length - 1) lines.push(`\\vspace{0.5em}`, ``);
    }
    lines.push(``, `\\end{rSection}`);
  }

  // Projects
  if (doc.projects.length) {
    lines.push(``, `\\begin{rSection}{Projects}`, `\\vspace{-1em}`, ``);
    for (const p of doc.projects) {
      lines.push(`\\item \\textbf{${tex(p.name)},} {\\em ${tex(p.tech)}} \\hfill {\\em ${tex(p.dates)}}`);
      if (p.bullets.length) {
        lines.push(`\\begin{itemize}`);
        for (const b of p.bullets) lines.push(`    \\item ${tex(b)}`);
        lines.push(`\\end{itemize}`);
        lines.push(``);
      }
    }
    lines.push(`\\end{rSection}`);
  }

  // Extracurriculars
  if (doc.extracurriculars?.length) {
    lines.push(``, `\\begin{rSection}{Extracurriculars}`, ``);
    for (let idx = 0; idx < doc.extracurriculars.length; idx++) {
      const e = doc.extracurriculars[idx];
      lines.push(
        `\\textbf{${tex(e.company)}} \\hfill {${tex(e.location)}}\\\\`,
        `\\textbf{${tex(e.title)}} \\hfill {\\em ${tex(e.dates)}}`,
      );
      if (e.bullets.length) {
        lines.push(`\\begin{itemize}`);
        for (const b of e.bullets) lines.push(`    \\item ${tex(b)}`);
        lines.push(`\\end{itemize}`);
      }
      if (idx < doc.extracurriculars.length - 1) lines.push(`\\vspace{0.5em}`, ``);
    }
    lines.push(``, `\\end{rSection}`);
  }

  // Skills
  if (doc.skills.length) {
    lines.push(``, `\\begin{rSection}{Skills \\& Interests}`, `\\begin{itemize}`);
    for (const s of doc.skills) lines.push(`    \\item ${inlineTex(s)}`);
    lines.push(`\\end{itemize}`, `\\end{rSection}`);
  }

  lines.push(``, `\\end{document}`);
  return lines.join("\n");
}

// ─── HTML fallback (when tectonic unavailable) ────────────────────────────────

function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (s: string) => esc(s).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    if (line.startsWith("# "))       { if (inList) { out.push("</ul>"); inList = false; } out.push(`<h1>${esc(line.slice(2))}</h1>`); }
    else if (line.startsWith("## ")) { if (inList) { out.push("</ul>"); inList = false; } out.push(`<h2>${esc(line.slice(3))}</h2>`); }
    else if (line.startsWith("- "))  { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(line.slice(2))}</li>`); }
    else if (line.trim() === "")     { if (inList) { out.push("</ul>"); inList = false; } }
    else                             { if (inList) { out.push("</ul>"); inList = false; } out.push(`<p>${inline(line)}</p>`); }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

async function renderHtmlFallback(markdown: string): Promise<Buffer> {
  const { chromium } = await import("playwright");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Times New Roman',Times,serif;font-size:11pt;color:#000;padding:0.65in 0.75in;line-height:1.35}
    h1{font-size:16pt;font-weight:bold;text-align:center;margin-bottom:3px}
    h2{font-size:10.5pt;font-weight:bold;text-transform:uppercase;border-bottom:1px solid #000;margin:9px 0 3px;letter-spacing:.06em;padding-bottom:1px}
    p{font-size:10.5pt;margin:2px 0}
    ul{margin:2px 0 2px 18px;padding:0}
    li{font-size:10.5pt;margin:1px 0}
    strong{font-weight:bold}
  </style></head><body>${markdownToHtml(markdown)}</body></html>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({ format: "Letter", margin: { top: "0", bottom: "0", left: "0", right: "0" }, printBackground: false });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// ─── Shared LaTeX compilation ─────────────────────────────────────────────────

async function compileTex(latexSrc: string): Promise<Buffer> {
  let tmpDir: string | null = null;
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "resume-pdf-"));

    // Copy czresume.cls from the checked-in template (unique name avoids tectonic's CTAN cache)
    await fs.copyFile(
      path.join(TEMPLATE_DIR, "czresume.cls"),
      path.join(tmpDir, "czresume.cls"),
    );

    const texFile = path.join(tmpDir, "resume.tex");
    await fs.writeFile(texFile, latexSrc, "utf8");
    await execFileAsync(TECTONIC, [texFile], { cwd: tmpDir, timeout: 30_000 });

    return await fs.readFile(path.join(tmpDir, "resume.pdf"));
  } finally {
    if (tmpDir) {
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ─── Main exports ─────────────────────────────────────────────────────────────

export async function renderPdf(markdown: string): Promise<Buffer> {
  const doc = parseMd(markdown);
  const latexSrc = buildLatex(doc);
  try {
    return await compileTex(latexSrc);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (allowHtmlFallback()) {
      console.warn("[render-pdf] tectonic unavailable — using HTML fallback");
      return renderHtmlFallback(markdown);
    }
    throw new Error(`LaTeX PDF render failed with ${TECTONIC}: ${msg}`);
  }
}

// ─── Master Resume JSON → LaTeX → PDF ────────────────────────────────────────

function masterResumeToDoc(mr: MasterResume): ParsedDoc {
  const b = mr.basics;
  const skillLines: string[] = [];
  if (mr.skills.languages.length) skillLines.push(`**Languages:** ${mr.skills.languages.join(", ")}`);
  if (mr.skills.frameworks.length) skillLines.push(`**Frameworks:** ${mr.skills.frameworks.join(", ")}`);
  if (mr.skills.tools.length) skillLines.push(`**Tools:** ${mr.skills.tools.join(", ")}`);
  if (mr.skills.interests.length) skillLines.push(`**Interests:** ${mr.skills.interests.join(", ")}`);

  return {
    name: b.name,
    contact: {
      location: b.location,
      email: b.email,
      phone: b.phone,
      github: b.github,
      linkedin: b.linkedin,
      portfolio: b.portfolio,
    },
    summary: b.summary,
    experience: mr.experience.map((exp) => ({
      company: exp.company,
      title: exp.title,
      location: exp.location,
      dates: [exp.start, exp.end].filter(Boolean).join("--"),
      bullets: exp.bullets.map((bullet) => bullet.text),
    })),
    projects: mr.projects.map((p) => ({
      name: p.name,
      tech: p.tech.join(", "),
      dates: [p.start, p.end].filter(Boolean).join("--"),
      link: p.link,
      bullets: p.bullets.map((bullet) => bullet.text),
    })),
    extracurriculars: mr.extracurriculars.map((e) => ({
      company: e.company,
      title: e.title,
      location: e.location,
      dates: [e.start, e.end].filter(Boolean).join("--"),
      bullets: e.bullets.map((bullet) => bullet.text),
    })),
    skills: skillLines,
    education: mr.education.map((edu) => ({
      school: edu.school,
      degrees: edu.degrees.join(", "),
      location: edu.location,
      graduation: edu.graduation,
      gpa: edu.gpa,
      notes: edu.notes.join(", "),
      coursework: edu.coursework.join(", "),
    })),
  };
}

export async function renderMasterResumePdf(mr: MasterResume): Promise<Buffer> {
  const doc = masterResumeToDoc(mr);
  const latexSrc = buildLatex(doc);
  try {
    return await compileTex(latexSrc);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (allowHtmlFallback()) {
      console.warn("[render-pdf] tectonic unavailable — using HTML fallback for master resume");
      const b = mr.basics;
      const skills = [
        mr.skills.languages.length ? `Languages: ${mr.skills.languages.join(", ")}` : "",
        mr.skills.frameworks.length ? `Frameworks: ${mr.skills.frameworks.join(", ")}` : "",
        mr.skills.tools.length ? `Tools: ${mr.skills.tools.join(", ")}` : "",
        mr.skills.interests.length ? `Interests: ${mr.skills.interests.join(", ")}` : "",
      ].filter(Boolean).map((s) => `- ${s}`);
      const md = [
        `# ${b.name}`,
        `${b.location} · ${b.email} · ${b.phone}`,
        b.summary,
        `## Experience`,
        ...mr.experience.flatMap((e) => [
          `**${e.company}** — ${e.title} · ${e.start}--${e.end}`,
          ...e.bullets.map((bullet) => `- ${bullet.text}`),
        ]),
        `## Projects`,
        ...mr.projects.flatMap((p) => [
          `**${p.name}** · ${p.tech.join(", ")}`,
          ...p.bullets.map((bullet) => `- ${bullet.text}`),
        ]),
        `## Skills`,
        ...skills,
      ].join("\n");
      return renderHtmlFallback(md);
    }
    throw new Error(`LaTeX PDF render failed with ${TECTONIC}: ${msg}`);
  }
}
