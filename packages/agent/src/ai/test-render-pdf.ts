import { tex, parseContactLine } from "./render-pdf";

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

console.log(allPass ? "\n✓ render-pdf test PASSED" : "\n✗ render-pdf test FAILED");
process.exit(allPass ? 0 : 1);
