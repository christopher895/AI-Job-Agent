/**
 * Unit test for tex() — the Markdown → LaTeX character escaper in render-pdf.ts.
 *
 * Regression guard for two distinct classes of bug:
 *
 *  1. LaTeX metacharacters (& % $ # _ { } ~ ^ \) must be escaped or the render
 *     fails outright.
 *  2. Non-Latin-1 characters an LLM emits into a bullet (→ ’ “ ” … • ≥ …) have
 *     no glyph in this template's 8-bit font stack. Left raw they do NOT fail
 *     the build — tectonic emits a "Missing character" warning and drops them,
 *     so "Kafka → Spark" silently ships to a recruiter as "Kafka  Spark".
 *
 * Also covers the project-link helpers (displayUrl/hrefUrl/isLinkLine), which
 * are pure string functions on the same render path: a project link that the
 * parser doesn't recognise is dropped from the PDF with no error at all.
 *
 * No tectonic/DB/network needed — this runs in the default `npm test` gate.
 * The companion integration test (test-render-pdf.ts) proves these macros
 * actually compile; this one proves we emit them.
 */
import { tex, displayUrl, hrefUrl, isLinkLine } from "./render-pdf";

let failures = 0;

function check(name: string, input: string, expected: string): void {
  const actual = tex(input);
  if (actual === expected) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}\n      input:    ${JSON.stringify(input)}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
    failures++;
  }
}

console.log("LaTeX metacharacters:");
check("ampersand", "R&D", "R\\&D");
check("percent", "cut 75%", "cut 75\\%");
check("dollar", "saved $5k", "saved \\$5k");
check("hash", "issue #12", "issue \\#12");
check("underscore", "user_id", "user\\_id");
check("braces", "{a}", "\\{a\\}");
check("tilde", "~5 hrs", "\\textasciitilde{}5 hrs");
check("caret", "2^10", "2\\textasciicircum{}10");
check("backslash", "a\\b", "a\\textbackslash{}b");

console.log("\nDashes and separators (pre-existing behaviour):");
check("en-dash", "2024–2025", "2024--2025");
check("em-dash", "a—b", "a---b");
check("middot", "a · b", "a \\textperiodcentered{} b");

console.log("\nNon-Latin-1 characters that would otherwise vanish from the PDF:");
check("right arrow", "Kafka → Spark", "Kafka $\\rightarrow$ Spark");
check("left arrow", "a ← b", "a $\\leftarrow$ b");
check("left-right arrow", "a ↔ b", "a $\\leftrightarrow$ b");
check("double right arrow", "a ⇒ b", "a $\\Rightarrow$ b");
check("unicode minus", "−5%", "$-$5\\%");
check("less-or-equal", "≤ 100ms", "$\\leq$ 100ms");
check("greater-or-equal", "≥ 99.9%", "$\\geq$ 99.9\\%");
check("ellipsis", "and…", "and\\ldots{}");
check("bullet", "a • b", "a \\textbullet{} b");
check("trademark", "Kafka™", "Kafka\\texttrademark{}");
check("curly double quotes", "“scale”", "``scale''");
check("curly single quotes", "‘scale’", "`scale'");
check("curly apostrophe", "don’t", "don't");

console.log("\nOrdering — math delimiters we introduce must not be re-escaped:");
// tex() escapes `$` before substituting arrows; if that order ever flips, the
// arrow would come out as "\$\rightarrow\$" and print literally.
check("arrow beside a literal dollar", "$5 → $10", "\\$5 $\\rightarrow$ \\$10");
check("arrow chain", "A → B → C", "A $\\rightarrow$ B $\\rightarrow$ C");

function eq(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
    failures++;
  }
}

console.log("\nProject links — displayUrl() is what prints, hrefUrl() is what opens:");
eq("display strips protocol", displayUrl("https://swimvolt.com"), "swimvolt.com");
eq("display strips www and trailing slash", displayUrl("http://www.swimvolt.com/"), "swimvolt.com");
eq("display keeps the path", displayUrl("https://github.com/x/y"), "github.com/x/y");
eq("display leaves a bare domain alone", displayUrl("swimvolt.com"), "swimvolt.com");
eq("display of empty", displayUrl(""), "");
eq("href keeps an explicit scheme", hrefUrl("https://swimvolt.com"), "https://swimvolt.com");
// A schemeless href target is not a working link in any PDF reader.
eq("href adds a scheme to a bare domain", hrefUrl("swimvolt.com"), "https://swimvolt.com");
eq("href adds a scheme to www.", hrefUrl("www.swimvolt.com"), "https://www.swimvolt.com");

console.log("\nProject links — which standalone lines count as a link:");
// The /resume/master Link field is free text, so a bare domain is what gets typed.
eq("bare domain is a link", isLinkLine("swimvolt.com"), true);
eq("bare domain with path is a link", isLinkLine("github.com/x/y"), true);
eq("http is a link", isLinkLine("https://swimvolt.com"), true);
eq("www is a link", isLinkLine("www.swimvolt.com"), true);
eq("prose is not a link", isLinkLine("Shipped a swim-start analyzer"), false);
eq("empty is not a link", isLinkLine(""), false);

console.log(
  failures === 0
    ? "\n✓ tex-escape test PASSED"
    : `\n✗ tex-escape test FAILED (${failures} failing case${failures === 1 ? "" : "s"})`,
);
process.exit(failures === 0 ? 0 : 1);
