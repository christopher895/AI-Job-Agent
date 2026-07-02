import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { z } from "zod";
import { completeJSON } from "./llm";
import { renderPdf } from "./render-pdf";

const execFileAsync = promisify(execFile);
const PDFINFO = process.env.PDFINFO_PATH || "pdfinfo";

// Estimated characters per line for bullet text at 10pt Times Roman, 7.7in text width
// with itemize left-indent (~0.2in). Rough but catches obvious widows.
const CHARS_PER_BULLET_LINE = 88;

// Tectonic emits PDF 1.5 with compressed object streams, so the page tree
// isn't visible to a raw byte/string scan — shell out to pdfinfo instead.
async function countPdfPages(pdf: Buffer): Promise<number> {
  const tmpFile = path.join(os.tmpdir(), `fit-page-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await fs.writeFile(tmpFile, pdf);
    const { stdout } = await execFileAsync(PDFINFO, [tmpFile]);
    const match = stdout.match(/^Pages:\s+(\d+)/m);
    return match ? parseInt(match[1], 10) : 1;
  } finally {
    fs.rm(tmpFile, { force: true }).catch(() => {});
  }
}

function findWidowBullets(markdown: string): string[] {
  const widows: string[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("- ")) continue;
    const bullet = line.slice(2).trim();
    if (bullet.length <= CHARS_PER_BULLET_LINE) continue; // single line, no wrap

    // Simulate word-by-word line breaking to find the last line's word count.
    const words = bullet.split(" ");
    const lines: string[][] = [[]];
    let currentLen = 0;
    for (const word of words) {
      const addLen = currentLen === 0 ? word.length : currentLen + 1 + word.length;
      if (addLen > CHARS_PER_BULLET_LINE && currentLen > 0) {
        lines.push([word]);
        currentLen = word.length;
      } else {
        lines[lines.length - 1].push(word);
        currentLen = addLen;
      }
    }

    if (lines.length >= 2 && lines[lines.length - 1].length <= 1) {
      widows.push(bullet);
    }
  }
  return widows;
}

const TrimSchema = z.object({ markdown: z.string() });

async function trimToOnePage(markdown: string, overflowLines: number): Promise<string> {
  const result = await completeJSON(TrimSchema, {
    system: `You are editing a résumé that overflows onto a second page by approximately ${overflowLines} printed lines.

Shorten it to fit one page by:
- Removing the least relevant bullet from one or more roles/projects (prefer older or less relevant roles)
- Shortening verbose bullets by cutting filler words (never remove facts, metrics, or technologies)

Do NOT change font, margins, section headers, names, titles, companies, dates, or URLs.
Do NOT add any content.
Return the complete résumé markdown as JSON: { "markdown": "..." }`,
    user: markdown,
    temperature: 0.15,
  });
  return result.markdown;
}

const WidowFixSchema = z.object({
  fixes: z.array(z.object({ original: z.string(), revised: z.string() })),
});

async function fixWidowBullets(markdown: string, widowBullets: string[]): Promise<string> {
  const result = await completeJSON(WidowFixSchema, {
    system: `You are fixing typography in a résumé. Each bullet below ends with a single word on its last printed line, which looks unprofessional.

For each bullet, shorten it by 1–3 words so the trailing word merges back onto the previous line. Cut filler words or condense phrasing. Do NOT change facts, metrics, or technologies.

Return JSON: { "fixes": [{ "original": "...", "revised": "..." }] }`,
    user: widowBullets.map((b) => `- "${b}"`).join("\n"),
    temperature: 0.15,
  });

  let out = markdown;
  for (const fix of result.fixes) {
    if (!fix.original || !fix.revised || fix.original === fix.revised) continue;
    if (!out.includes(fix.original)) {
      console.warn("[fit-page] widow fix did not match markdown, skipping:", fix.original);
      continue;
    }
    out = out.replace(fix.original, fix.revised);
  }
  return out;
}

/**
 * Fits the résumé markdown to one page:
 *   1. Renders to PDF and counts pages.
 *   2. If > 1 page, runs an LLM trim pass (up to 2 attempts).
 *   3. Runs a heuristic widow-word scan and one LLM fix pass if any are found.
 *
 * Returns the final (possibly shortened) markdown alongside the PDF so both
 * can be stored consistently in the database.
 */
export async function fitToOnePage(
  markdown: string,
): Promise<{ markdown: string; pdf: Buffer }> {
  let current = markdown;
  let pdf = await renderPdf(current);

  // Page overflow trim loop (max 2 extra LLM passes)
  let pages = await countPdfPages(pdf);
  for (let attempt = 0; attempt < 2 && pages > 1; attempt++) {
    const overflowLines = Math.ceil((pages - 1) * 50);
    current = await trimToOnePage(current, overflowLines);
    pdf = await renderPdf(current);
    pages = await countPdfPages(pdf);
  }
  if (pages > 1) {
    console.warn(`[fit-page] resume still ${pages} pages after 2 trim passes`);
  }

  // Widow word fix (one pass after page is stable)
  const widows = findWidowBullets(current);
  if (widows.length > 0) {
    current = await fixWidowBullets(current, widows);
    pdf = await renderPdf(current);
  }

  return { markdown: current, pdf };
}
