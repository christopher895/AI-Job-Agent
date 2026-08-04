# Strip JD boilerplate before it reaches the LLM

## Problem

`fetchJd()` (`packages/agent/src/scraper/fetch-jd.ts`) extracts JD text with Readability + a noise-selector strip, but the result often still includes non-JD boilerplate that survives extraction: benefits/perks lists, "About [Company]" culture blurbs, compensation-range legal disclaimers, "How to Apply" instructions, and EEO/accommodation/background-check statements.

That extracted text is not sent to the LLM once — `generateBestResume()` (`packages/agent/src/ai/chain.ts`) runs up to 3 loop iterations, and each iteration calls both `tailorResume()` and `evaluate()` (the critic) with the full JD text. So every token of boilerplate in the extracted JD is billed up to 6x per tailoring request, none of it useful: the tailoring system prompt only cares about responsibilities/requirements/qualifications, never company culture or legal notices.

## Scope

Confined to `packages/agent/src/scraper/fetch-jd.ts`, specifically `extractFromHtml()`'s Readability path. Pasted JD text (not fetched from a URL) is out of scope — the user types/copies that themselves. The `CONTAINER_SELECTORS` and raw `<body>` text fallback paths (used when Readability fails or under-extracts) are also out of scope — they're already low-signal degraded paths, and adding boilerplate stripping there risks pushing an already-short extraction below `MIN_LENGTH`.

## Design

### `stripBoilerplate(contentHtml: string): string`

New function in `fetch-jd.ts`, called on Readability's `article.content` (HTML, still has heading/paragraph structure) before it's flattened to `article.textContent` and passed through `normalize()`.

Loads `contentHtml` into cheerio and walks matched blocks (`h1`–`h6`, `p`, `li`) in document order, applying two independent mechanisms. `li` is matched individually rather than whole `<ul>`/`<ol>` — prototyping this against a synthetic Requirements list showed that treating a whole list as one block let one long sibling `<li>` drag a short, legitimate sibling `<li>` (e.g. a one-line background-check requirement) over the paragraph-length floor and get it removed too. Matching `li` individually fixes that.

**1. Heading-based section removal.** A block counts as a heading if it is a real `<h1>`–`<h6>`, or a `<p>` under 60 characters whose text is entirely wrapped in `<strong>`/`<b>` (the common ATS "pseudo-heading" pattern, e.g. `<p><strong>Benefits</strong></p>`). When a heading's normalized text matches `BOILERPLATE_SECTION_HEADINGS`, that heading and every following sibling block are removed until the next heading (of either kind) is reached. Matched categories:

- Benefits / Perks / Compensation
- Why join us / About Us / About the Company
- How to Apply / Application Process
- Equal Opportunity / Diversity, Equity & Inclusion / Accommodations

Additionally, if `extractFromHtml` has already resolved a company name (via its existing title/company extraction, which runs before this step), a heading matching `About {company}` is stripped too. This is deliberately narrower than a bare `/^about\b/i` match: prototyping showed that pattern also swallows "About the Role" / "About the Team" headings, which usually hold real job content (team mission, what you'll work on), not company-culture boilerplate. Only "About Us", "About the Company", and "About {the resolved company name}" are treated as boilerplate.

**2. Headerless paragraph removal.** Some boilerplate is appended with no heading at all — most commonly the EEO statement and the accommodation/background-check/E-Verify notice. Any `<p>`/`<li>` whose text is over 120 characters AND matches one of `BOILERPLATE_PARAGRAPH_PATTERNS` (e.g. `/equal opportunity employer/i`, `/reasonable accommodation/i`, `/without regard to (race|religion|color|sex|national origin)/i`) is removed outright, independent of the heading-removal state machine. The 120-char floor exists so a short, legitimate requirement bullet (e.g. "Must be able to pass a background check for site access") is never caught by the same pattern — only long-form legal boilerplate paragraphs are.

Both mechanisms are blacklist-only: nothing is removed unless it matches a known-boilerplate signature. Requirements/Responsibilities/Qualifications/Skills content is never touched by default.

### Wiring into `extractFromHtml()`

```
article = Readability(...).parse()
if article:
  strippedText = stripBoilerplate(article.content, titleCompany.company)  // company already resolved above
  text = strippedText.length >= MIN_LENGTH ? strippedText : normalize(article.textContent)   // stripping over-trimmed — fall back unstripped
else:
  text = ""
... existing CONTAINER_SELECTORS / body-text fallback, unchanged, not boilerplate-stripped
```

The `MIN_LENGTH` (200 char) safety net is the only new failure-handling behavior — stripping can never cause a fetch that would otherwise have succeeded to report `failed`.

## Testing

Extend `packages/agent/src/scraper/test-fetch-jd.ts` (existing manual test-script convention, `npm run test:fetch-jd`) with synthetic HTML fixtures covering:

- A JD with a real Requirements/Responsibilities section plus headed Benefits, Equal Employment Opportunity, About \[Company\], and How to Apply sections — assert the boilerplate sections are absent from `result.text` and the requirements content survives.
- A headerless EEO paragraph appended at the end with no heading — assert it's stripped.
- A short in-context requirement bullet mentioning "background check" sitting in the same `<ul>` as a longer sibling bullet (under 120 chars itself, inside the Requirements section) — assert it survives, proving both the length floor and the per-`li` matching prevent false-positive stripping.
- A pseudo-heading case (`<p><strong>Benefits</strong></p>` followed by plain `<p>` perks text, no real `<h2>`) — assert the section is still recognized and dropped.
- An "About the Role" heading containing real job content (team mission, what you'll work on) alongside an "About \[Company\]" or "About Us" heading — assert "About the Role" content survives while the company/culture blurb is stripped.

## Error handling

No new failure modes. `fetchJd()` still returns `{ text: "", method: "failed" }` on total failure exactly as before; the `MIN_LENGTH` fallback described above ensures over-aggressive stripping degrades to the pre-existing unstripped behavior rather than ever shrinking a request into a failure.
