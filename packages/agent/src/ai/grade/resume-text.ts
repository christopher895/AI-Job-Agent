import { dateRange } from "../format";
import { Experience, MasterResume } from "../types";

/** Resume and JD text cap for one grade — five prompts each carry the whole resume. */
export const MAX_GRADE_TEXT_CHARS = 30_000;

const join = (sep: string, ...parts: (string | undefined)[]) =>
  parts.filter((p) => p && p.trim()).join(sep);

/**
 * Plain-text rendering of the master resume for grading. Section headings and
 * order match the PDF (render-pdf.ts buildLatex) so the ATS specialist judges
 * what a recruiter actually receives. `aboutMe` is private notes — never included.
 */
export function masterToText(m: MasterResume): string {
  const b = m.basics;
  const lines: string[] = [b.name, join(" | ", b.location, b.email, b.phone, b.github, b.linkedin, b.portfolio)];
  if (b.summary.trim()) lines.push("", b.summary.trim());

  if (m.education.length) {
    lines.push("", "Education");
    for (const e of m.education) {
      lines.push(join(" | ", `${e.school} — ${e.degrees.join(", ")}`, e.location, e.graduation));
      const gpaNotes = join(", ", e.gpa ? `GPA: ${e.gpa}` : "", ...e.notes);
      if (gpaNotes) lines.push(gpaNotes);
      if (e.coursework.length) lines.push(`Relevant Coursework: ${e.coursework.join(", ")}`);
    }
  }

  const roles = (heading: string, items: Experience[]) => {
    if (!items.length) return;
    lines.push("", heading);
    for (const e of items) {
      lines.push(join(" | ", e.company, e.location), join(" | ", e.title, dateRange(e.start, e.end)));
      for (const bullet of e.bullets) lines.push(`- ${bullet.text}`);
    }
  };

  roles("Experience", m.experience);

  if (m.projects.length) {
    lines.push("", "Projects");
    for (const p of m.projects) {
      lines.push(join(" | ", join(" - ", p.name, p.link), p.tech.join(", "), dateRange(p.start, p.end)));
      for (const bullet of p.bullets) lines.push(`- ${bullet.text}`);
    }
  }

  roles("Extracurriculars", m.extracurriculars);

  const s = m.skills;
  const skillLines = [
    s.languages.length ? `Languages: ${s.languages.join(", ")}` : "",
    s.frameworks.length ? `Frameworks: ${s.frameworks.join(", ")}` : "",
    s.tools.length ? `Tools: ${s.tools.join(", ")}` : "",
    s.interests.length ? `Interests: ${s.interests.join(", ")}` : "",
  ].filter(Boolean);
  if (skillLines.length) lines.push("", "Skills & Interests", ...skillLines);

  return lines.join("\n").trim();
}

/** Text from an uploaded PDF — shared with POST /api/master-resume/import. */
export async function extractPdfText(buf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buf });
  try {
    const parsed = await parser.getText({ pageJoiner: "" });
    return parsed.text;
  } finally {
    await parser.destroy();
  }
}
