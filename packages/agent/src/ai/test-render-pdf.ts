import { tex, parseContactLine, renderPdf } from "./render-pdf";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const execFileAsync = promisify(execFile);

let allPass = true;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) {
    allPass = false;
    console.log(`   ✗ [${label}] ${detail ?? "failed"}`);
  }
}

// --- tex(): middle-dot escaping (root cause of the "˚u" mojibake bug) ---
{
  const out = tex("Java · Docker · Kubernetes");
  check(
    "tex-middot-escaped",
    !out.includes("·") && out.includes("\\textperiodcentered{}"),
    `got: ${JSON.stringify(out)}`
  );
}
{
  // Existing en/em dash handling must be unaffected.
  check("tex-endash-unaffected", tex("2024–2025") === "2024--2025");
  check("tex-emdash-unaffected", tex("A—B") === "A---B");
}

// --- parseContactLine(): phone format that was previously silently dropped ---
{
  const f = parseContactLine("Providence, RI · a@b.com · (704)-877-1460 · https://github.com/x · christopherzhang.dev");
  check("phone-paren-hyphen", f.phone === "(704)-877-1460", `got: ${JSON.stringify(f.phone)}`);
}
{
  // Regression: formats that already worked must keep working.
  check("phone-plain-hyphen", parseContactLine("704-877-1460 · a@b.com").phone === "704-877-1460");
  check("phone-paren-space", parseContactLine("(704) 877-1460 · a@b.com").phone === "(704) 877-1460");
}

// --- parseContactLine(): bare domain (no http/www prefix) previously dropped ---
{
  const f = parseContactLine("Providence, RI · a@b.com · (704)-877-1460 · https://github.com/x · christopherzhang.dev");
  check("portfolio-bare-domain", f.portfolio === "christopherzhang.dev", `got: ${JSON.stringify(f.portfolio)}`);
}
{
  // Regression: protocol-prefixed portfolio URLs must keep working.
  const f = parseContactLine("Providence, RI · a@b.com · https://christopherzhang.dev");
  check("portfolio-with-protocol", f.portfolio === "https://christopherzhang.dev");
}
{
  // Location must not be misidentified as a domain.
  const f = parseContactLine("Providence, RI · a@b.com");
  check("location-not-domain", f.location === "Providence, RI", `got: ${JSON.stringify(f.location)}`);
}

// --- Header: the name must sit at the page's horizontal center ---
// Regression: the document is set \raggedright, which adds a right-side fill to
// every line. czresume.cls used to center the name with \hfil on both sides, so
// the right got twice the stretch and the name landed a third of the way across.
// \centerline is a fixed-width box and is immune to that.
async function nameCenterOffset(): Promise<{ offset: number; detail: string }> {
  const md = [
    "# Christopher Zhang",
    "Providence, RI · a@b.edu · (704)-877-1460 · https://github.com/x · christopherzhang.dev",
    "",
    "## Experience",
    "**Scout Motors** — AI Engineering Intern · Charlotte, NC · May 2026–Present",
    "- Engineered an AI security assistant",
  ].join("\n");
  const pdf = await renderPdf(md);
  const tmp = path.join(os.tmpdir(), `render-pdf-test-${Date.now()}.pdf`);
  try {
    await fs.writeFile(tmp, pdf);
    // pdftotext ships with poppler alongside pdfinfo, which fit-page.ts already requires.
    const { stdout } = await execFileAsync(process.env.PDFTOTEXT_PATH || "pdftotext", ["-bbox", tmp, "-"]);
    const page = stdout.match(/<page width="([\d.]+)"/);
    const words = [...stdout.matchAll(/<word xMin="([\d.]+)"[^>]*xMax="([\d.]+)"[^>]*>(Christopher|Zhang)<\/word>/g)];
    if (!page || words.length !== 2) return { offset: NaN, detail: `couldn't locate name in pdftotext output` };
    const left = Math.min(...words.map((w) => parseFloat(w[1])));
    const right = Math.max(...words.map((w) => parseFloat(w[2])));
    const pageCenter = parseFloat(page[1]) / 2;
    const nameCenter = (left + right) / 2;
    return { offset: nameCenter - pageCenter, detail: `name center ${nameCenter.toFixed(1)}pt vs page center ${pageCenter.toFixed(1)}pt` };
  } finally {
    fs.rm(tmp, { force: true }).catch(() => {});
  }
}

(async () => {
  const { offset, detail } = await nameCenterOffset();
  check("name-centered", Math.abs(offset) < 2, detail);

  console.log(allPass ? "\n✓ render-pdf test PASSED" : "\n✗ render-pdf test FAILED");
  process.exit(allPass ? 0 : 1);
})();
