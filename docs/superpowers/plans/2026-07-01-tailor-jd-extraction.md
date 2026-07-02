# Tailor JD Extraction Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/tailor`'s "paste a job URL" flow extract clean job-description text (no cookie banners / analytics noise / footer boilerplate) and auto-fill Job Title and Company from the fetched page when they're not already known.

**Architecture:** Replace the brittle selector-list JD extraction in `packages/agent/src/scraper/fetch-jd.ts` with a `@mozilla/readability`-based pipeline (same engine behind Firefox Reader View), preceded by a noise-stripping pass that removes cookie/consent banners the current code misses. Add a `<title>`/`<h1>`-based heuristic to guess job title and company from the same page, wired through the existing `/api/tailor/fetch-jd` and `/api/tailor` routes into `TailorForm.tsx`, which fills the Job Title/Company inputs only when they're currently empty.

**Tech Stack:** TypeScript (agent package, CommonJS module target), `cheerio` (already a dep), new deps `jsdom` + `@mozilla/readability`, Next.js/React on the web side. No test framework in `packages/agent` — tests are manual `tsx` scripts that `process.exit(0|1)`, matching `test-format.ts`/`test-grounding.ts`.

## Global Constraints

- Scope is limited to `packages/agent/src/scraper/fetch-jd.ts`, `packages/agent/src/api/routes/tailor.ts`, `packages/web/lib/api.ts`, `packages/web/components/TailorForm.tsx`, and their tests — do not touch `packages/agent/src/scraper/adapters/*` (per-company scraper adapters are a separate, already-tuned path).
- `MIN_LENGTH = 200` and `TIMEOUT_MS = 15_000` thresholds in `fetch-jd.ts` stay unchanged.
- `validateUrl()`'s SSRF checks (blocks localhost/private IPs/`.internal`/`.local`) stay unchanged — do not weaken them.
- Auto-fill of Job Title / Company in `TailorForm.tsx` must never overwrite a non-empty field.
- Follow the existing manual-test-script convention (`export` pure functions, assert booleans, `console.log` results, `process.exit(pass ? 0 : 1)`) — no new test framework.

---

### Task 1: Add extraction dependencies

**Files:**
- Modify: `packages/agent/package.json`

**Interfaces:**
- Produces: `jsdom` and `@mozilla/readability` importable from any file in `packages/agent/src`.

- [ ] **Step 1: Add the dependencies to `packages/agent/package.json`**

In the `"dependencies"` block, add (alphabetically, next to `"googleapis"`):

```json
    "jsdom": "^29.1.1",
    "@mozilla/readability": "^0.6.0",
```

(Full updated `dependencies` block should read: `cheerio`, `dotenv`, `express`, `googleapis`, `@mozilla/readability`, `jsdom`, `node-cron`, `openai`, `pg`, `playwright`, `resend`, `zod` — keep alphabetical order.)

Also add to `"devDependencies"`, next to `"@types/pg"`:

```json
    "@types/jsdom": "^21.1.7",
```

- [ ] **Step 2: Install**

Run: `npm install` (from repo root — this is an npm workspaces monorepo, root `node_modules` is shared)
Expected: exits 0, `jsdom`, `@mozilla/readability`, and `@types/jsdom` appear under `/Users/christopherzhang/Projects/AI-Job-Agent/node_modules/`.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/package.json package-lock.json
git commit -m "chore: add jsdom + @mozilla/readability for JD extraction"
```

---

### Task 2: Rewrite JD extraction with Readability + title/company heuristic

**Files:**
- Create: `packages/agent/src/scraper/test-fixtures/bofa-job.html`
- Modify: `packages/agent/src/scraper/fetch-jd.ts`
- Create: `packages/agent/src/scraper/test-fetch-jd.ts`
- Modify: `packages/agent/package.json` (add test script)

**Interfaces:**
- Consumes: `cheerio.load` (existing dep), `jsdom`'s `JSDOM`, `@mozilla/readability`'s `Readability` (Task 1).
- Produces:
  - `export function extractFromHtml(html: string, url: string): { text: string; title?: string; company?: string }` — pure, network-free, used directly by the test and internally by `fetchJd`.
  - `export type FetchJdResult = { text: string; method: "cheerio" | "playwright" | "failed"; title?: string; company?: string }` — the `title`/`company` fields are new; `fetchJd(url: string): Promise<FetchJdResult>`'s signature is unchanged, consumed by Task 3.

- [ ] **Step 1: Verify the test fixture is in place**

A real, previously-fetched snapshot of the Bank of America `tal.net` job page that motivated this work should already exist at `packages/agent/src/scraper/test-fixtures/bofa-job.html` (893 lines, ~52KB). Confirm it's there:

Run: `wc -l packages/agent/src/scraper/test-fixtures/bofa-job.html`
Expected: `893 packages/agent/src/scraper/test-fixtures/bofa-job.html`

If it's missing, regenerate it with:
```bash
curl -s -A "Mozilla/5.0 (compatible; JobAgent/1.0)" \
  "https://bankcampuscareers.tal.net/vx/lang-en-GB/mobile-0/brand-4/user-5282441/candidate/so/pm/1/pl/1/opp/14418-Global-Technology-Summer-Analyst-2027-Software-Engineer-and-Mainframe-Analyst/en-GB" \
  -o packages/agent/src/scraper/test-fixtures/bofa-job.html --max-time 20
```

- [ ] **Step 2: Write the failing test**

Create `packages/agent/src/scraper/test-fetch-jd.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFromHtml } from "./fetch-jd";

const fixturePath = join(__dirname, "test-fixtures", "bofa-job.html");
const html = readFileSync(fixturePath, "utf-8");
const url =
  "https://bankcampuscareers.tal.net/vx/lang-en-GB/mobile-0/brand-4/user-5282441/candidate/so/pm/1/pl/1/opp/14418-Global-Technology-Summer-Analyst-2027-Software-Engineer-and-Mainframe-Analyst/en-GB";

const result = extractFromHtml(html, url);

console.log("title:", result.title);
console.log("company:", result.company);
console.log("text length:", result.text.length);

const noCookieBanner = !result.text.includes("Strictly Necessary cookies");
const noGtmNoise = !result.text.toLowerCase().includes("googletagmanager");
const hasRealContent = result.text.includes("mainframe environment is the third largest");
const titleCorrect =
  result.title === "Global Technology Summer Analyst 2027 - Software Engineer and Mainframe Analyst";
const companyCorrect = result.company === "Bank of America";

if (!noCookieBanner) console.log("   ✗ cookie banner text leaked into extracted JD");
if (!noGtmNoise) console.log("   ✗ GTM/analytics noise leaked into extracted JD");
if (!hasRealContent) console.log("   ✗ missing expected job description content");
if (!titleCorrect) console.log(`   ✗ title mismatch: got ${JSON.stringify(result.title)}`);
if (!companyCorrect) console.log(`   ✗ company mismatch: got ${JSON.stringify(result.company)}`);

const pass = noCookieBanner && noGtmNoise && hasRealContent && titleCorrect && companyCorrect;
console.log(pass ? "\n✓ fetch-jd extraction test PASSED" : "\n✗ fetch-jd extraction test FAILED");
process.exit(pass ? 0 : 1);
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/agent && npx tsx src/scraper/test-fetch-jd.ts`
Expected: FAIL — `extractFromHtml` is not exported from `./fetch-jd` yet (module has no such export; TypeScript/Node throws `SyntaxError: The requested module './fetch-jd' does not provide an export named 'extractFromHtml'` or equivalent `undefined is not a function`).

- [ ] **Step 4: Replace `packages/agent/src/scraper/fetch-jd.ts` with the full new implementation**

```ts
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export type FetchJdResult = {
  text: string;
  method: "cheerio" | "playwright" | "failed";
  title?: string;
  company?: string;
};

const MIN_LENGTH = 200;
const TIMEOUT_MS = 15_000;

// Blocks SSRF: private IPs, localhost, cloud metadata endpoints
function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL must use http or https");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("URL targets a private or internal address");
  }
}

const CONTAINER_SELECTORS = [
  '[class*="job-description"]',
  '[id*="job-description"]',
  '[class*="jobDescription"]',
  '[id*="jobDescription"]',
  '[class*="job-detail"]',
  '[id*="job-detail"]',
  '[class*="description-content"]',
  "article",
  "main",
];

const NOISE_SELECTORS = [
  "script", "style", "noscript", "iframe",
  "nav", "header", "footer", "aside", "[role=navigation]",
  '[id*="cookie" i]', '[class*="cookie" i]',
  '[id*="consent" i]', '[class*="consent" i]',
  '[class*="gdpr" i]',
].join(", ");

const TITLE_SEPARATORS = [" | ", " — ", " - ", " · ", " • "];

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractTitleCompany($: CheerioAPI): { title?: string; company?: string } {
  const h1 = normalize($("h1").first().text());
  const pageTitle = normalize($("title").first().text());
  if (!pageTitle) return {};

  // Job titles often contain " - " themselves (e.g. "X 2027 - Software Engineer"),
  // so prefer stripping the h1's own text off the front of <title> over a naive split.
  if (h1 && pageTitle.toLowerCase().startsWith(h1.toLowerCase())) {
    const rest = normalize(pageTitle.slice(h1.length));
    const company = rest.replace(/^[\s\-|—·•]+/, "").trim();
    return { title: h1, company: company || undefined };
  }

  for (const sep of TITLE_SEPARATORS) {
    if (!pageTitle.includes(sep)) continue;
    const parts = pageTitle.split(sep).map(normalize).filter(Boolean);
    if (parts.length < 2) continue;
    const company = parts[parts.length - 1];
    const title = parts.slice(0, -1).join(sep);
    return { title, company };
  }

  return { title: h1 || pageTitle };
}

export function extractFromHtml(html: string, url: string): { text: string; title?: string; company?: string } {
  const $ = cheerio.load(html);
  const titleCompany = extractTitleCompany($);

  $(NOISE_SELECTORS).remove();
  const cleanedHtml = $.html();

  let text = "";
  try {
    const dom = new JSDOM(cleanedHtml, { url });
    const article = new Readability(dom.window.document).parse();
    text = normalize(article?.textContent ?? "");
  } catch {
    text = "";
  }

  if (text.length < MIN_LENGTH) {
    for (const sel of CONTAINER_SELECTORS) {
      const candidate = normalize($(sel).first().text());
      if (candidate.length >= MIN_LENGTH) {
        text = candidate;
        break;
      }
    }
  }

  if (text.length < MIN_LENGTH) {
    text = normalize($("body").text());
  }

  return { text, ...titleCompany };
}

async function tryCheerio(url: string): Promise<{ text: string; title?: string; company?: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; JobAgent/1.0)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return { text: "" };
  const html = await res.text();
  return extractFromHtml(html, url);
}

async function tryPlaywright(url: string): Promise<{ text: string; title?: string; company?: string }> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT_MS });
    const html = await page.content();
    return extractFromHtml(html, url);
  } finally {
    await browser.close();
  }
}

export async function fetchJd(url: string): Promise<FetchJdResult> {
  validateUrl(url); // throws on invalid scheme or private IP

  try {
    const r = await tryCheerio(url);
    if (r.text.length >= MIN_LENGTH) {
      return { text: r.text, method: "cheerio", title: r.title, company: r.company };
    }
  } catch {
    // fall through to Playwright
  }

  try {
    const r = await tryPlaywright(url);
    if (r.text.length >= MIN_LENGTH) {
      return { text: r.text, method: "playwright", title: r.title, company: r.company };
    }
  } catch {
    // fall through to failed
  }

  return { text: "", method: "failed" };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/agent && npx tsx src/scraper/test-fetch-jd.ts`
Expected:
```
title: Global Technology Summer Analyst 2027 - Software Engineer and Mainframe Analyst
company: Bank of America
text length: 7300
✓ fetch-jd extraction test PASSED
```
(exit code 0)

- [ ] **Step 6: Add the npm test script**

In `packages/agent/package.json`, add to `"scripts"` (next to `"test:critic"`):

```json
    "test:fetch-jd": "tsx src/scraper/test-fetch-jd.ts",
```

- [ ] **Step 7: Run the full existing test suite to confirm no regressions**

Run: `cd packages/agent && npm run test:grounding && npm run test:format && npm run test:critic && npm run test:fetch-jd`
Expected: all four print a `✓ ... PASSED` line and the command exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/scraper/fetch-jd.ts packages/agent/src/scraper/test-fetch-jd.ts packages/agent/src/scraper/test-fixtures/bofa-job.html packages/agent/package.json
git commit -m "feat: extract JD text via Readability, guess title/company from page"
```

---

### Task 3: Return title/company from the fetch-jd API and use them as tailor fallbacks

**Files:**
- Modify: `packages/agent/src/api/routes/tailor.ts`

**Interfaces:**
- Consumes: `FetchJdResult` (now `{ text, method, title?, company? }`) from Task 2.
- Produces: `POST /tailor/fetch-jd` JSON response gains `title`/`company` fields, consumed by Task 4's `TailorForm.tsx`.

- [ ] **Step 1: Update the main `POST /` handler to fall back to fetched title/company**

In `packages/agent/src/api/routes/tailor.ts`, replace:

```ts
  let jd = jdText?.trim() ?? "";
  let fetchMethod: string | undefined;

  if (!jd && jobUrl) {
    try {
      const fetched = await fetchJd(jobUrl);
      jd = fetched.text;
      fetchMethod = fetched.method;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid URL";
      res.status(400).json({ error: message });
      return;
    }
  }
```

with:

```ts
  let jd = jdText?.trim() ?? "";
  let fetchMethod: string | undefined;
  let resolvedTitle = jobTitle;
  let resolvedCompany = company;

  if (!jd && jobUrl) {
    try {
      const fetched = await fetchJd(jobUrl);
      jd = fetched.text;
      fetchMethod = fetched.method;
      resolvedTitle = resolvedTitle || fetched.title;
      resolvedCompany = resolvedCompany || fetched.company;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid URL";
      res.status(400).json({ error: message });
      return;
    }
  }
```

- [ ] **Step 2: Use `resolvedTitle`/`resolvedCompany` instead of `jobTitle`/`company` for the pipeline call and DB save**

Replace:

```ts
  let result;
  try {
    result = await generateBestResume(jd, { jobTitle, company });
  } catch (err) {
    console.error("[tailor] pipeline error:", err);
    res.status(500).json({ error: "Tailoring failed — check OPENAI_API_KEY and try again." });
    return;
  }

  let row;
  try {
    row = await createTailoredResume({
      jobTitle,
      company,
      jobUrl,
      jdText: jd,
      markdown: result.markdown,
      criticScore: result.critic.finalScore,
    });
```

with:

```ts
  let result;
  try {
    result = await generateBestResume(jd, { jobTitle: resolvedTitle, company: resolvedCompany });
  } catch (err) {
    console.error("[tailor] pipeline error:", err);
    res.status(500).json({ error: "Tailoring failed — check OPENAI_API_KEY and try again." });
    return;
  }

  let row;
  try {
    row = await createTailoredResume({
      jobTitle: resolvedTitle,
      company: resolvedCompany,
      jobUrl,
      jdText: jd,
      markdown: result.markdown,
      criticScore: result.critic.finalScore,
    });
```

- [ ] **Step 3: Return title/company from `/fetch-jd`**

Replace:

```ts
  if (result.method === "failed") {
    res.status(400).json({ error: "Could not fetch job description from this URL", method: "failed" });
    return;
  }
  res.json({ text: result.text, method: result.method });
```

with:

```ts
  if (result.method === "failed") {
    res.status(400).json({ error: "Could not fetch job description from this URL", method: "failed" });
    return;
  }
  res.json({ text: result.text, method: result.method, title: result.title, company: result.company });
```

- [ ] **Step 4: Type-check**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/api/routes/tailor.ts
git commit -m "feat: fall back to fetched title/company in tailor API routes"
```

---

### Task 4: Auto-fill Job Title / Company in the web form

**Files:**
- Modify: `packages/web/lib/api.ts:134-135`
- Modify: `packages/web/components/TailorForm.tsx:24-37`

**Interfaces:**
- Consumes: `POST /tailor/fetch-jd` response `{ text, method, title?, company? }` from Task 3.

- [ ] **Step 1: Update the `fetchJd` client wrapper's return type**

In `packages/web/lib/api.ts`, replace:

```ts
  fetchJd: (url: string) =>
    request<{ text: string; method: string }>("POST", "/tailor/fetch-jd", { url }),
```

with:

```ts
  fetchJd: (url: string) =>
    request<{ text: string; method: string; title?: string; company?: string }>(
      "POST",
      "/tailor/fetch-jd",
      { url }
    ),
```

- [ ] **Step 2: Auto-fill only-if-empty in `TailorForm.tsx`**

In `packages/web/components/TailorForm.tsx`, replace:

```ts
  async function handleFetchJd() {
    const trimmed = jobUrl.trim();
    if (!trimmed) return;
    setFetchStatus("fetching");
    setError(null);
    try {
      const { text } = await api.fetchJd(trimmed);
      setJdText(text);
      setFetchStatus("done");
    } catch {
      setFetchStatus("failed");
      setError("Couldn't fetch this page — paste the job description below.");
    }
  }
```

with:

```ts
  async function handleFetchJd() {
    const trimmed = jobUrl.trim();
    if (!trimmed) return;
    setFetchStatus("fetching");
    setError(null);
    try {
      const { text, title: fetchedTitle, company: fetchedCompany } = await api.fetchJd(trimmed);
      setJdText(text);
      setTitle((current) => current.trim() ? current : fetchedTitle ?? current);
      setCompany((current) => current.trim() ? current : fetchedCompany ?? current);
      setFetchStatus("done");
    } catch {
      setFetchStatus("failed");
      setError("Couldn't fetch this page — paste the job description below.");
    }
  }
```

- [ ] **Step 3: Type-check**

Run: `cd packages/web && npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/lib/api.ts packages/web/components/TailorForm.tsx
git commit -m "feat: auto-fill job title/company from fetched JD page when empty"
```

---

### Task 5: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start local infra and both dev servers**

Run: `docker-compose up -d` (Postgres + Redis), then in separate terminals: `cd packages/agent && npm run dev` and `cd packages/web && npm run dev`.

- [ ] **Step 2: Exercise the real-world case that motivated this work**

Open the web app's `/tailor` page in a browser. Paste this URL into Job URL and click "Fetch JD":

```
https://bankcampuscareers.tal.net/vx/lang-en-GB/mobile-0/brand-4/user-5282441/candidate/so/pm/1/pl/1/opp/14418-Global-Technology-Summer-Analyst-2027-Software-Engineer-and-Mainframe-Analyst/en-GB
```

Expected: "Job description fetched successfully" appears; the Job Description textarea contains the program description/responsibilities text with **no** cookie-policy banner text, no `googletagmanager` references, and no footer legal boilerplate; Job Title auto-fills to "Global Technology Summer Analyst 2027 - Software Engineer and Mainframe Analyst"; Company auto-fills to "Bank of America".

- [ ] **Step 3: Confirm auto-fill doesn't clobber manual input**

Reload `/tailor`, type "Custom Title" into Job Title, then paste the same URL and click "Fetch JD" again.
Expected: Job Title still reads "Custom Title" (unchanged); Company still auto-fills since it was empty.

- [ ] **Step 4: Confirm the full generate flow still works end-to-end**

Click "Generate Tailored Resume". Expected: redirects to `/resume/[id]`, the saved resume shows the correct job title/company (visible in the `/` history dashboard), and the markdown/PDF reflect the tailored content as before.
