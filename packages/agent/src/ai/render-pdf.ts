import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const execFileAsync = promisify(execFile);

// Path to the checked-in LaTeX template directory
const TEMPLATE_DIR = path.join(__dirname, "../../../../Resume_Template");
const TECTONIC = process.env.TECTONIC_PATH || "tectonic";

function allowHtmlFallback(): boolean {
  return /^(1|true|yes)$/i.test(process.env.ALLOW_HTML_PDF_FALLBACK ?? "");
}

// ─── LaTeX escaping ──────────────────────────────────────────────────────────

function tex(s: string): string {
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
    .replace(/—/g, "---"); // em-dash → LaTeX triple dash
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
  portfolio: string;
};

function parseContactLine(line: string): ContactFields {
  const f: ContactFields = { location: "", email: "", phone: "", github: "", portfolio: "" };
  for (const part of line.split(" · ").map(s => s.trim())) {
    if (part.includes("@") && !part.startsWith("http")) f.email = part;
    else if (/^\(?\d{3}[\)\s.-]\s*\d{3}[\s.-]\d{4}$/.test(part)) f.phone = part;
    else if (part.includes("github.com")) f.github = part;
    else if (part.startsWith("http") || part.startsWith("www.")) f.portfolio = part;
    else if (!f.location) f.location = part;
  }
  return f;
}

type ExpEntry  = { company: string; title: string; location: string; dates: string; bullets: string[] };
type ProjEntry = { name: string; tech: string; dates: string; link: string; bullets: string[] };
type EduEntry  = { school: string; degrees: string; location: string; graduation: string; gpa?: string };

type ParsedDoc = {
  name: string;
  contact: ContactFields;
  summary: string;
  experience: ExpEntry[];
  projects: ProjEntry[];
  skills: string[];
  education: EduEntry[];
};

function parseMd(md: string): ParsedDoc {
  const lines = md.split("\n");
  let i = 0;
  const doc: ParsedDoc = {
    name: "", contact: { location: "", email: "", phone: "", github: "", portfolio: "" },
    summary: "", experience: [], projects: [], skills: [], education: [],
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

    if (section === "experience") {
      let cur: ExpEntry | null = null;
      while (i < lines.length && !lines[i].startsWith("## ")) {
        const l = lines[i].trim();
        if (l.startsWith("**") && l.includes("—")) {
          if (cur) doc.experience.push(cur);
          const m = l.match(/^\*\*(.+?)\*\*\s*[—–]\s*(.+)$/);
          if (m) {
            const parts = m[2].split(" · ");
            cur = {
              company: m[1],
              title: parts[0] ?? "",
              location: parts[1] ?? "",
              dates: parts.slice(2).join(" · ").replace(/–/g, "--"),
              bullets: [],
            };
          }
        } else if (l.startsWith("- ") && cur) {
          cur.bullets.push(l.slice(2));
        }
        i++;
      }
      if (cur) doc.experience.push(cur);

    } else if (section === "projects") {
      let cur: ProjEntry | null = null;
      while (i < lines.length && !lines[i].startsWith("## ")) {
        const l = lines[i].trim();
        if (l.startsWith("**") && !l.startsWith("- ")) {
          if (cur) doc.projects.push(cur);
          const m = l.match(/^\*\*(.+?)\*\*\s*·\s*(.+)$/);
          if (m) {
            const parts = m[2].split(" · ");
            const dates = (parts.pop() ?? "").replace(/–/g, "--");
            cur = { name: m[1], tech: parts.join(", "), dates, link: "", bullets: [] };
          } else {
            cur = { name: l.replace(/\*/g, ""), tech: "", dates: "", link: "", bullets: [] };
          }
        } else if ((l.startsWith("http") || l.startsWith("www.")) && cur && !cur.link) {
          cur.link = l;
        } else if (l.startsWith("- ") && cur) {
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
          const m = l.match(/^\*\*(.+?)\*\*\s*[—–]\s*(.+)$/);
          if (m) {
            const parts = m[2].split(" · ");
            cur = { school: m[1], degrees: parts[0] ?? "", location: parts[1] ?? "", graduation: parts.slice(2).join(" · ") };
          }
        } else if (l.startsWith("GPA:") && cur) {
          cur.gpa = l.slice(4).trim();
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
    for (const e of doc.education) {
      lines.push(`{\\bf ${tex(e.school)},} {\\em ${tex(e.degrees)}} \\hfill {${tex(e.location)}}\\\\`);
      if (e.gpa) lines.push(`\\textbf{GPA:} ${tex(e.gpa)} \\hfill {\\em ${tex(e.graduation)}}`);
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

// ─── Main export ──────────────────────────────────────────────────────────────

export async function renderPdf(markdown: string): Promise<Buffer> {
  const doc = parseMd(markdown);
  const latexSrc = buildLatex(doc);

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

    const pdfPath = path.join(tmpDir, "resume.pdf");
    return await fs.readFile(pdfPath);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (allowHtmlFallback()) {
      console.warn("[render-pdf] tectonic unavailable — using HTML fallback");
      return renderHtmlFallback(markdown);
    }
    throw new Error(`LaTeX PDF render failed with ${TECTONIC}: ${msg}`);
  } finally {
    if (tmpDir) {
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
