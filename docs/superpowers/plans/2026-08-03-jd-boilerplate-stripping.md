# JD Boilerplate Stripping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip benefits/EEO/legal/"how to apply"/company-blurb boilerplate out of JD text extracted from a fetched URL, before it's sent to the LLM, since that text is currently billed up to 6x per `/tailor` request (once per `tailorResume` + `evaluate` call, across up to 3 generate-critique-revise iterations).

**Architecture:** A new `stripBoilerplate(contentHtml, company?)` function in `packages/agent/src/scraper/fetch-jd.ts` runs on Readability's parsed HTML (`article.content`) before it's flattened to plain text. It walks matched blocks (`h1`–`h6`, `p`, `li`) in document order and removes two categories: (1) boilerplate sections identified by heading text (Benefits, EEO, How to Apply, About Us/About the Company/About `{resolved company}`) — heading + everything until the next heading; (2) headerless boilerplate paragraphs identified by content signature (EEO statement, background-check/E-Verify notice), gated by a 120-char floor so a short legitimate requirement bullet is never caught. If stripping drops the result below the existing `MIN_LENGTH` (200 chars) safety threshold, the code falls back to the unstripped Readability text.

**Tech Stack:** TypeScript (strict mode), cheerio, `@mozilla/readability` + `jsdom` (already dependencies of `fetch-jd.ts`). Tests use this package's existing manual-script convention (`check()` helper, no framework), run via `npm run test:fetch-jd` (`tsx`).

## Global Constraints

- TypeScript strict mode (`packages/agent/tsconfig.json` has `"strict": true`) — no implicit `any`. Avoid importing `Element` from `domhandler` (not part of cheerio's public type exports); let TypeScript infer element types from cheerio's `.each()` callback instead of extracting a separately-typed helper function.
- Readability's `article.content` is typed `string | null | undefined` — always coalesce with `?? ""` before passing to `stripBoilerplate`.
- Follow the existing test file's convention exactly: inline HTML template literals (see Cases 3–5 in `test-fetch-jd.ts`), `check(label, ok, detail)` calls, `console.log` of anything useful for debugging a failure, `process.exit(allPass ? 0 : 1)` at the end (already present — do not duplicate).
- Out of scope: pasted JD text (not fetched from a URL), and the `CONTAINER_SELECTORS`/raw-`<body>` fallback paths in `extractFromHtml` — neither gets boilerplate stripping (see spec `docs/superpowers/specs/2026-08-03-jd-boilerplate-stripping-design.md` for why).

---

### Task 1: Add `stripBoilerplate` and wire it into `extractFromHtml`

**Files:**
- Modify: `packages/agent/src/scraper/fetch-jd.ts`
- Test: `packages/agent/src/scraper/test-fetch-jd.ts`

**Interfaces:**
- Produces: `stripBoilerplate(contentHtml: string, company?: string): string` — a private (non-exported) function in `fetch-jd.ts`. Not consumed outside this file; `extractFromHtml`'s existing exported signature (`{ text: string; title?: string; company?: string; location?: string }`) is unchanged.

- [ ] **Step 1: Write the failing tests**

Append these four cases to the end of `packages/agent/src/scraper/test-fetch-jd.ts`, immediately before the final `console.log(allPass ? ...)` / `process.exit(...)` lines:

```typescript
// Case 6: real Responsibilities/Requirements content alongside headed Benefits,
// Equal Employment Opportunity, About [Company], and How to Apply boilerplate.
// This JD text gets sent to the LLM up to 6x per /tailor request (once per
// tailorResume + evaluate call, across up to 3 generate-critique-revise
// iterations in chain.ts), so every token of boilerplate that survives
// extraction is billed repeatedly for zero tailoring value.
{
  const html = `
<html>
<head><title>Software Engineer - Acme Corp</title></head>
<body>
<article>
<h1>Software Engineer</h1>
<h2>Responsibilities</h2>
<p>${"Build and maintain scalable backend services using Python and Kubernetes. ".repeat(6)}</p>
<h2>Requirements</h2>
<ul>
<li>5+ years of experience with distributed systems and cloud infrastructure.</li>
<li>Must be able to pass a background check for site access.</li>
</ul>
<h2>Benefits</h2>
<ul>
<li>Comprehensive health, dental, and vision insurance for you and your family.</li>
<li>Generous 401k match and unlimited PTO policy for all full-time employees.</li>
</ul>
<h2>About Acme Corp</h2>
<p>${"Acme Corp is a leading provider of cloud infrastructure solutions trusted by Fortune 500 companies worldwide. ".repeat(3)}</p>
<h2>How to Apply</h2>
<p>Submit your resume and cover letter through our careers portal to be considered for this position.</p>
<h2>Equal Employment Opportunity</h2>
<p>Acme Corp is proud to be an equal opportunity employer. All qualified applicants will receive consideration for employment without regard to race, religion, color, sex, national origin, or veteran status.</p>
</article>
</body>
</html>`;
  const url = "https://acmecorp.com/careers/software-engineer";
  const result = extractFromHtml(html, url);

  console.log("[boilerplate-strip] text length:", result.text.length);

  check("boilerplate-strip", result.text.includes("Python and Kubernetes"), "Responsibilities content was stripped");
  check(
    "boilerplate-strip",
    result.text.includes("Must be able to pass a background check"),
    "short in-list requirement bullet was wrongly stripped alongside its longer sibling"
  );
  check("boilerplate-strip", !result.text.includes("401k"), "Benefits section leaked into extracted JD");
  check("boilerplate-strip", !result.text.includes("Fortune 500"), "About [Company] section leaked into extracted JD");
  check("boilerplate-strip", !result.text.includes("cover letter"), "How to Apply section leaked into extracted JD");
  check(
    "boilerplate-strip",
    !result.text.includes("equal opportunity employer"),
    "Equal Employment Opportunity section leaked into extracted JD"
  );
}

// Case 7: pseudo-heading — many ATS templates render section titles as
// <p><strong>Benefits</strong></p> instead of a real <h2>. Must still be
// recognized and dropped.
{
  const html = `
<html><head><title>Backend Engineer - Acme</title></head>
<body><article>
<h1>Backend Engineer</h1>
<p>${"Design and operate backend services at scale for millions of users. ".repeat(6)}</p>
<p><strong>Benefits</strong></p>
<p>${"We offer health insurance, a 401k match, unlimited PTO, and remote-first work. ".repeat(3)}</p>
</article></body></html>`;
  const url = "https://acme.com/careers/backend-engineer";
  const result = extractFromHtml(html, url);

  check(
    "pseudo-heading",
    result.text.includes("Design and operate backend"),
    "real job content was stripped alongside the pseudo-heading section"
  );
  check("pseudo-heading", !result.text.includes("401k"), "pseudo-heading Benefits section was not recognized/dropped");
}

// Case 8: "About the Role" is real job content (team mission, what you'll
// work on), not a company blurb — must NOT be caught by the "About ..."
// boilerplate match. Only "About [Company]" (using the company name already
// resolved by extractTitleCompany) should be stripped.
{
  const html = `
<html><head><title>Engineer - Acme Corp</title></head>
<body><article>
<h1>Engineer</h1>
<h2>About the Role</h2>
<p>${"You will own the payments infrastructure team and drive reliability improvements across our checkout stack. ".repeat(4)}</p>
<h2>About Acme Corp</h2>
<p>${"Acme Corp is a leading provider of cloud infrastructure solutions trusted by Fortune 500 companies worldwide. ".repeat(3)}</p>
</article></body></html>`;
  const url = "https://acmecorp.com/careers/engineer";
  const result = extractFromHtml(html, url);

  check(
    "about-the-role",
    result.text.includes("payments infrastructure team"),
    "'About the Role' content was wrongly treated as company-blurb boilerplate"
  );
  check("about-the-role", !result.text.includes("Fortune 500"), "'About Acme Corp' company blurb was not stripped");
}

// Case 9: headerless boilerplate paragraph — the EEO statement is often
// appended with no heading at all. Must still be stripped by content
// signature, independent of the heading-based removal state machine.
{
  const html = `
<html><head><title>Engineer - Acme Corp</title></head>
<body><article>
<h1>Engineer</h1>
<h2>Requirements</h2>
<p>${"Own the reliability of our payment processing pipeline end to end. ".repeat(5)}</p>
<p>Acme Corp is proud to be an equal opportunity employer. All qualified applicants will receive consideration for employment without regard to race, religion, color, sex, national origin, or veteran status.</p>
</article></body></html>`;
  const url = "https://acmecorp.com/careers/engineer-2";
  const result = extractFromHtml(html, url);

  check("headerless-eeo", result.text.includes("payment processing pipeline"), "Requirements content was stripped");
  check(
    "headerless-eeo",
    !result.text.includes("equal opportunity employer"),
    "headerless EEO paragraph was not stripped"
  );
}
```

- [ ] **Step 2: Run tests to verify the new cases fail**

Run: `npm run test:fetch-jd --workspace=packages/agent` (or `cd packages/agent && npx tsx src/scraper/test-fetch-jd.ts`)

Expected: FAIL. Cases 6–9 all report `✗` on the "leaked" / "was not recognized/dropped" / "was not stripped" checks (the `Benefits gone`, `Fortune 500`, `cover letter`, `equal opportunity employer`, `401k` assertions), because `extractFromHtml` doesn't strip anything yet — Readability's raw `textContent` still contains all of it. The "content survives" checks (Python and Kubernetes, background-check bullet, Design and operate backend, payments infrastructure team, payment processing pipeline) already pass today since nothing is being removed. Overall script exits with code 1 and prints `✗ fetch-jd extraction test FAILED`.

- [ ] **Step 3: Implement `stripBoilerplate` and wire it in**

In `packages/agent/src/scraper/fetch-jd.ts`, insert the following block after `extractJsonLdLocation` (which currently ends at line 202, right before `export function extractFromHtml`):

```typescript
// Section headings that mark the START of a boilerplate section to drop
// entirely (heading + everything until the next heading). Deliberately
// blacklist-only — anything not matched here is kept by default, so
// Requirements/Responsibilities/Qualifications/Skills sections are never
// touched.
const BOILERPLATE_SECTION_HEADINGS: RegExp[] = [
  /^(the\s+)?benefits?(\s+(&|and)\s+perks?)?$/i,
  /^perks?(\s+(&|and)\s+benefits?)?$/i,
  /^(our\s+)?compensation(\s+(&|and)\s+benefits?)?$/i,
  /^why\s+(join|work\s+(at|for))\s+us/i,
  /^about\s+(us|the\s+company|our\s+company|this\s+company)\b/i,
  /^how\s+to\s+apply/i,
  /^application\s+process/i,
  /^equal\s+(employment\s+)?opportunity/i,
  /^diversity(,?\s*equity(,?\s*(&|and)?\s*inclusion)?)?$/i,
  /^accessibility$/i,
  /^accommodations?$/i,
];

// Headerless boilerplate paragraphs — matched by content signature, dropped
// wherever they appear regardless of heading structure. Gated by
// BOILERPLATE_PARAGRAPH_MIN_LENGTH below so a short legitimate requirement
// bullet (e.g. "Must be able to pass a background check for site access")
// is never caught by the same pattern as a long-form legal statement.
const BOILERPLATE_PARAGRAPH_PATTERNS: RegExp[] = [
  /equal opportunity employer/i,
  /reasonable accommodation/i,
  /background check/i,
  /e-?verify/i,
  /without regard to (race|religion|color|sex|national origin)/i,
];

const BOILERPLATE_PARAGRAPH_MIN_LENGTH = 120;
const PSEUDO_HEADING_MAX_LENGTH = 60;
const BLOCK_SELECTOR = "h1, h2, h3, h4, h5, h6, p, li";
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function isBoilerplateHeading(text: string, company?: string): boolean {
  const cleaned = text.replace(/:+\s*$/, "").trim();
  if (BOILERPLATE_SECTION_HEADINGS.some((re) => re.test(cleaned))) return true;
  if (company) {
    const companyRe = new RegExp(`^about\\s+${escapeRegExp(company)}\\b`, "i");
    if (companyRe.test(cleaned)) return true;
  }
  return false;
}

function isBoilerplateParagraph(text: string): boolean {
  if (text.length < BOILERPLATE_PARAGRAPH_MIN_LENGTH) return false;
  return BOILERPLATE_PARAGRAPH_PATTERNS.some((re) => re.test(text));
}

// Drops known-boilerplate sections (benefits, EEO/legal, "how to apply",
// company blurbs) from Readability's parsed HTML before it's flattened to
// text. This content is repeated on every tailor + critic call in the
// generate-critique-revise loop (up to 6x per /tailor request) and never
// helps résumé tailoring — the tailoring prompt only cares about
// responsibilities/requirements/qualifications.
//
// Walks li individually rather than whole ul/ol: treating a whole list as
// one block let one long sibling <li> drag a short, legitimate sibling <li>
// (e.g. a one-line background-check requirement) over the paragraph-length
// floor and get it removed too.
function stripBoilerplate(contentHtml: string, company?: string): string {
  const $ = cheerio.load(contentHtml);
  let dropping = false;

  $(BLOCK_SELECTOR).each((_, el) => {
    const $el = $(el);
    const text = normalize($el.text());
    const tag = $el.prop("tagName")?.toLowerCase() ?? "";

    // Many ATS templates render section titles as <p><strong>Benefits</strong></p>
    // instead of a real heading tag.
    const isPseudoHeading =
      tag === "p" &&
      text.length > 0 &&
      text.length <= PSEUDO_HEADING_MAX_LENGTH &&
      normalize($el.children("strong, b").text()) === text;

    const isHeading = HEADING_TAGS.has(tag) || isPseudoHeading;

    if (isHeading) {
      dropping = isBoilerplateHeading(text, company);
      if (dropping) $el.remove();
      return;
    }

    if (dropping || isBoilerplateParagraph(text)) {
      $el.remove();
    }
  });

  return normalize($.root().text());
}
```

This reuses the `escapeRegExp` helper already defined earlier in the file (used by `stripJobBoardBrand`) — no new import needed.

Then, in `extractFromHtml`, replace the Readability block:

```typescript
  let text = "";
  try {
    const dom = new JSDOM(cleanedHtml, { url });
    const article = new Readability(dom.window.document).parse();
    text = normalize(article?.textContent ?? "");
  } catch {
    text = "";
  }
```

with:

```typescript
  let text = "";
  try {
    const dom = new JSDOM(cleanedHtml, { url });
    const article = new Readability(dom.window.document).parse();
    if (article) {
      const stripped = stripBoilerplate(article.content ?? "", titleCompany.company);
      text = stripped.length >= MIN_LENGTH ? stripped : normalize(article.textContent ?? "");
    }
  } catch {
    text = "";
  }
```

`titleCompany.company` is already resolved above this point in `extractFromHtml` (via `extractTitleCompany` + the `companyFromHost` fallback), so no reordering of existing code is needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && npx tsx src/scraper/test-fetch-jd.ts`

Expected: PASS — all of Cases 1–9 report no `✗` lines, and the script prints `✓ fetch-jd extraction test PASSED` and exits 0. Pay particular attention to Cases 1–5 (the pre-existing Bank of America / Optiver / ATS-host / Jobright fixtures) still passing unchanged — this confirms the new stripping logic doesn't regress real-world extraction.

- [ ] **Step 5: Typecheck**

Run: `cd packages/agent && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/scraper/fetch-jd.ts packages/agent/src/scraper/test-fetch-jd.ts
git commit -m "$(cat <<'EOF'
perf: strip JD boilerplate (benefits/EEO/how-to-apply/about-us) before it reaches the LLM

Fetched JD text is sent to the LLM up to 6x per /tailor request (tailor +
critic, across up to 3 generate-critique-revise iterations), so boilerplate
that survives extraction is billed repeatedly for zero tailoring value.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
