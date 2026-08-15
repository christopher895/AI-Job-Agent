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
 * No tectonic/DB/network needed — this runs in the default `npm test` gate.
 * The companion integration test (test-render-pdf.ts) proves these macros
 * actually compile; this one proves we emit them.
 */
import { tex } from "./render-pdf";

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

console.log(
  failures === 0
    ? "\n✓ tex-escape test PASSED"
    : `\n✗ tex-escape test FAILED (${failures} failing case${failures === 1 ? "" : "s"})`,
);
process.exit(failures === 0 ? 0 : 1);
