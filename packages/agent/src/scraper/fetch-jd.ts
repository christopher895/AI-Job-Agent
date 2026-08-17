import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { closeBrowserSafely } from "./browser-utils";
import { assertSafeUrl, fetchFollowingSafeRedirects } from "./ssrf";

export type FetchJdResult = {
  text: string;
  method: "cheerio" | "playwright" | "failed";
  title?: string;
  company?: string;
  location?: string;
};

const MIN_LENGTH = 200;
const TIMEOUT_MS = 15_000;

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

const TITLE_SEPARATORS = [" | ", " — ", " - ", " · ", " • ", " @ "];

// Third-party ATS/job-board hosts — their domain isn't the employer's name,
// so never guess a company from these (e.g. "tal.net" is not the company).
const ATS_HOST_FRAGMENTS = [
  "greenhouse.io", "lever.co", "ashbyhq.com", "myworkdayjobs.com",
  "icims.com", "tal.net", "smartrecruiters.com", "workable.com",
  "bamboohr.com", "jobvite.com", "taleo.net", "successfactors.com",
  "breezy.hr", "recruitee.com", "personio.com", "wd1.myworkdaysite.com",
  "jobright.ai", "linkedin.com", "indeed.com", "ziprecruiter.com",
  "glassdoor.com", "simplyhired.com",
];

// Job aggregator/discovery platforms append their own brand to <title>
// (e.g. Jobright.ai renders "{Job Title} @ {Employer} | Jobright.ai"). That
// brand is the platform surfacing the job, not the employer, so it must be
// stripped before title/company parsing — otherwise it gets mistaken for
// either the job title or the company.
const JOB_BOARD_BRANDS: Record<string, string> = {
  "jobright.ai": "Jobright.ai",
  "linkedin.com": "LinkedIn",
  "indeed.com": "Indeed",
  "ziprecruiter.com": "ZipRecruiter",
  "glassdoor.com": "Glassdoor",
  "simplyhired.com": "SimplyHired",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripJobBoardBrand(text: string, url: string): string {
  if (!text) return text;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return text;
  }
  const brand = Object.entries(JOB_BOARD_BRANDS).find(([frag]) => host.includes(frag))?.[1];
  if (!brand) return text;
  const suffix = new RegExp(`[\\s\\-|—·•@]+${escapeRegExp(brand)}\\s*$`, "i");
  return text.replace(suffix, "").trim();
}

const HOST_SUBDOMAIN_PREFIXES = ["www", "jobs", "careers", "apply", "join", "join-us", "hiring"];

// Company-microsite domains often fuse a prefix into the registrable label
// itself rather than using a subdomain, e.g. "lifeattiktok.com" or
// "lifeatspotify.com" -> strip "lifeat" so the guess is "Tiktok"/"Spotify"
// instead of "Lifeattiktok".
const SLD_PREFIX_PATTERNS = [/^lifeat/i, /^careersat/i, /^workat/i];

// Segments like "2027 Summer" or "Class of 2027" are cohort/program labels,
// not company names — a title of the form "{Job Title} - 2027 Summer" has no
// company signal in it at all, so the trailing-segment heuristic must not
// mistake the cohort label for one.
const COHORT_LABEL_RE =
  /^(?:(?:spring|summer|fall|autumn|winter)\s+)?(?:19|20)\d{2}(?:\s+(?:spring|summer|fall|autumn|winter))?$|^(?:class|cohort)\s+of\s+(?:19|20)\d{2}$/i;

// Last-resort company guess from the URL's registrable domain, e.g.
// "www.optiver.com" -> "Optiver". Used when the page has no title/og/JSON-LD
// signal to extract a company name from at all.
function companyFromHost(url: string): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (ATS_HOST_FRAGMENTS.some((frag) => host.includes(frag))) return undefined;

  const labels = host.split(".").filter(Boolean);
  while (labels.length > 2 && HOST_SUBDOMAIN_PREFIXES.includes(labels[0])) {
    labels.shift();
  }
  if (labels.length < 2) return undefined;

  let sld = labels[labels.length - 2];
  if (!sld) return undefined;
  for (const prefix of SLD_PREFIX_PATTERNS) {
    const stripped = sld.replace(prefix, "");
    if (stripped && stripped !== sld) {
      sld = stripped;
      break;
    }
  }
  return sld.charAt(0).toUpperCase() + sld.slice(1);
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// companyFromHost only knows how to capitalize the first letter ("tiktok" ->
// "Tiktok"), which is wrong for camel-cased brand names. If the page's own
// title/h1/og:title spells the guessed word out with different casing (e.g.
// "TikTok"), prefer that — it's straight from the source.
function improveCasing(guess: string, $: CheerioAPI): string {
  const sources = [
    $("title").first().text(),
    $("h1").first().text(),
    $('meta[property="og:title"]').attr("content") ?? "",
  ];
  const re = new RegExp(`\\b${escapeRegExp(guess)}\\b`, "i");
  for (const src of sources) {
    const m = src.match(re);
    if (m) return m[0];
  }
  return guess;
}

function extractTitleCompany($: CheerioAPI, url: string): { title?: string; company?: string } {
  const h1 = stripJobBoardBrand(normalize($("h1").first().text()), url);
  const pageTitle = stripJobBoardBrand(normalize($("title").first().text()), url);
  if (!pageTitle) return {};

  // Job titles often contain " - " themselves (e.g. "X 2027 - Software Engineer"),
  // so prefer stripping the h1's own text off the front of <title> over a naive split.
  if (h1 && pageTitle.toLowerCase().startsWith(h1.toLowerCase())) {
    const rest = normalize(pageTitle.slice(h1.length));
    const company = rest.replace(/^[\s\-|—·•@]+/, "").trim();
    return { title: h1, company: company || undefined };
  }

  for (const sep of TITLE_SEPARATORS) {
    if (!pageTitle.includes(sep)) continue;
    const parts = pageTitle.split(sep).map(normalize).filter(Boolean);
    if (parts.length < 2) continue;
    const trailing = parts[parts.length - 1];
    const title = parts.slice(0, -1).join(sep);
    // A trailing "2027 Summer" or "Class of 2027" is a cohort/program label,
    // not a company — strip it from the title but don't return it as company
    // (let extractFromHtml fall back to companyFromHost instead).
    if (COHORT_LABEL_RE.test(trailing)) return { title };
    return { title, company: trailing };
  }

  return { title: h1 || pageTitle };
}

// Greenhouse, Lever, Ashby, and Workday all embed a schema.org JobPosting
// block for SEO — it's the most reliable source for structured location and
// company data, since scraping visible page text is brittle across ATS
// themes. Extracted together in one scan since both live on the same node.
function extractJsonLdJobPosting($: CheerioAPI): { location?: string; company?: string } {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse($(scripts[i]).contents().text());
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of candidates) {
      const obj = item as Record<string, unknown>;
      const graph = obj["@graph"];
      const jobPosting = Array.isArray(graph)
        ? graph.find((g) => (g as Record<string, unknown>)["@type"] === "JobPosting")
        : obj["@type"] === "JobPosting"
        ? obj
        : undefined;
      if (!jobPosting) continue;

      const jp = jobPosting as Record<string, unknown>;
      const result: { location?: string; company?: string } = {};

      const org = jp.hiringOrganization as Record<string, unknown> | undefined;
      if (org && typeof org.name === "string" && org.name.trim()) {
        result.company = org.name.trim();
      }

      if (jp.jobLocationType === "TELECOMMUTE") {
        result.location = "Remote";
      } else {
        const jobLocation = Array.isArray(jp.jobLocation) ? jp.jobLocation[0] : jp.jobLocation;
        const address = (jobLocation as Record<string, unknown> | undefined)?.address as
          | Record<string, unknown>
          | undefined;
        const parts = address
          ? [address.addressLocality, address.addressRegion, address.addressCountry].filter(
              (p): p is string => typeof p === "string" && p.length > 0
            )
          : [];
        if (parts.length) result.location = parts.join(", ");
      }

      if (result.location || result.company) return result;
    }
  }
  return {};
}

const LOCATION_LABEL_RE = /^location:?$/i;

// Custom-built career microsites (React/Next.js in-house career portals
// without a schema.org JobPosting block) commonly render location as a bare
// "Location:" label next to its value rather than semantic markup, e.g.
// <p>Location:</p><p>San Jose</p> or <dt>Location</dt><dd>San Jose</dd>.
function extractLabelLocation($: CheerioAPI): string | undefined {
  const leaves = $("*").filter((_, el) => $(el).children().length === 0);
  for (let i = 0; i < leaves.length; i++) {
    const $el = $(leaves[i]);
    if (!LOCATION_LABEL_RE.test(normalize($el.text()))) continue;

    const sibling = $el.next();
    const siblingText = normalize(sibling.text());
    if (siblingText && sibling.children().length === 0) return siblingText;

    const parent = $el.parent();
    const parentText = normalize(parent.text());
    const remainder = normalize(parentText.replace(/^location:?/i, ""));
    if (remainder && remainder !== parentText) return remainder;
  }
  return undefined;
}

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
  // "Diversity", "Diversity & Inclusion", "Diversity, Equity & Inclusion",
  // "Diversity, Equity, and Inclusion" — the original pattern required
  // "Equity" between "Diversity" and "Inclusion", missing the very common
  // "Diversity & Inclusion" (no Equity) phrasing.
  /^diversity(,?\s*equity)?(,?\s*(&|and)?\s*inclusion)?$/i,
  /^accessibility$/i,
  // Matches "Accommodation(s)" alone or brand-prefixed ("TikTok Accommodation").
  /(^|\s)accommodations?$/i,
  // Compensation/legal disclosure wrapper section on some ATS templates
  // (pay transparency, background-check jurisdiction notices, etc.).
  /^job\s+information$/i,
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
  // Fair Chance Act / "ban the box" criminal-history disclosures, common on
  // California/LA/NYC job postings.
  /fair chance act/i,
  /arrest or conviction records?/i,
  /criminal history/i,
];

const BOILERPLATE_PARAGRAPH_MIN_LENGTH = 120;
const PSEUDO_HEADING_MAX_LENGTH = 60;
const BLOCK_SELECTOR = "h1, h2, h3, h4, h5, h6, p, li";

// Real JD section headings that legitimately appear as bare, unstyled short
// <p> tags on some templates (no <strong>/<b> child) — used to widen
// pseudo-heading detection just enough to catch these specific known-good
// headings, without treating every short line of prose as a heading (which
// misclassifies short lead-in labels like "For Los Angeles County
// (unincorporated) Candidates:" as a new section boundary and prematurely
// ends an active boilerplate drop right before the real disclosure text).
const JD_POSITIVE_HEADINGS: RegExp[] = [
  /^responsibilit(?:y|ies)$/i,
  /^(minimum |preferred |basic |required )?qualifications$/i,
  /^requirements$/i,
  /^duties$/i,
  /^about the (role|team|job|position)$/i,
  /^what you.?ll do$/i,
  /^who you are$/i,
];
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

    // Many ATS templates render section titles as <p><strong>Benefits</strong></p>,
    // or — on custom-built career microsites with no semantic heading tags at
    // all — as a bare short <p>Benefits</p> styled bold purely via CSS class.
    // Treating *any* short standalone <p> as heading-like is unsafe: a short
    // lead-in label mid-section (e.g. "For Los Angeles County (unincorporated)
    // Candidates:") would also qualify, and since it matches neither the
    // boilerplate blacklist nor a real JD heading, it would reset `dropping`
    // to false and let the disclosure text right after it leak through. So a
    // bare (non-bold) short <p> only counts as a heading when its text is
    // already known — either blacklisted or a real JD section name.
    const shortText = tag === "p" && text.length > 0 && text.length <= PSEUDO_HEADING_MAX_LENGTH;
    const boldChild = shortText && normalize($el.children("strong, b").text()) === text;
    const knownHeadingText =
      shortText &&
      (isBoilerplateHeading(text, company) ||
        JD_POSITIVE_HEADINGS.some((re) => re.test(text.replace(/:+\s*$/, "").trim())));
    const isPseudoHeading = boldChild || knownHeadingText;

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

// Common JD section headers/phrases. Used as a sanity check that extracted
// text is actually the job description and not page furniture (nav menus,
// unrelated marketing copy) that merely happened to clear MIN_LENGTH — e.g.
// on client-rendered career microsites, the raw (pre-JS) HTML body is often
// all nav/footer text with no JD content anywhere in the DOM yet.
// Deliberately excludes a bare `duties` — it false-positives inside legal
// boilerplate ("...criminal history may affect the following job duties...")
// which would otherwise make a wrong, boilerplate-only Readability pick look
// like it already has real JD content and block the full-body fallback below.
const JD_SIGNAL_RE =
  /\bresponsibilit(?:y|ies)\b|\brequirements?\b|\bqualifications?\b|\bwhat you.?ll do\b|\bwho you are\b|\bwhat we.?re looking for\b|\bminimum qualifications\b/i;

function hasJdSignal(text: string): boolean {
  return JD_SIGNAL_RE.test(text);
}

type ExtractResult = {
  text: string;
  title?: string;
  company?: string;
  location?: string;
  // False when `text` had to fall back to raw, unfiltered body text with no
  // JD-signal confirmation anywhere — i.e. we're not confident this is
  // actually the job description. Callers should treat this as a failed
  // extraction rather than a low-quality success.
  confident: boolean;
};

export function extractFromHtml(html: string, url: string): ExtractResult {
  const $ = cheerio.load(html);
  const titleCompany = extractTitleCompany($, url);
  const jsonLd = extractJsonLdJobPosting($);
  const hostGuess = companyFromHost(url);
  const company = jsonLd.company ?? titleCompany.company ?? (hostGuess ? improveCasing(hostGuess, $) : undefined);
  const location = jsonLd.location ?? extractLabelLocation($);

  $(NOISE_SELECTORS).remove();
  const cleanedHtml = $.html();

  let text = "";
  let confident = false;

  try {
    const dom = new JSDOM(cleanedHtml, { url });
    const article = new Readability(dom.window.document).parse();
    if (article) {
      const stripped = stripBoilerplate(article.content ?? "", company);
      const candidate = stripped.length >= MIN_LENGTH ? stripped : normalize(article.textContent ?? "");
      if (candidate.length >= MIN_LENGTH) {
        text = candidate;
        confident = true;
      }
    }
  } catch {
    // fall through to other extraction strategies
  }

  // Readability's content-scoring can pick the wrong container on
  // custom-built career microsites with flat, non-semantic div layouts
  // (no <article>, generic Tailwind classes) — it may exclude the actual JD
  // section entirely while including marketing/benefits copy instead. Retry
  // by applying the same boilerplate-stripping walk to the whole cleaned
  // page rather than just Readability's chosen subset, and prefer it when
  // it clearly contains JD content Readability's pick is missing (longer,
  // and mentions Responsibilities/Requirements/etc. the original lacks).
  // Gated this way rather than always preferring it, since real JDs often
  // don't use any of those exact words and Readability's narrower pick is
  // usually the cleaner result.
  //
  // Strip <a> tags first: nav menus on these sites are rarely wrapped in a
  // <nav>/[role=navigation] element (so NOISE_SELECTORS misses them), but
  // are reliably just a wall of <a> links with no whitespace between them —
  // unlike JD prose, which essentially never depends on link text.
  const $bodyOnly = cheerio.load($("body").html() ?? cleanedHtml);
  $bodyOnly("a").remove();
  const fullBody = stripBoilerplate($bodyOnly("body").html() ?? "", company);
  if (
    fullBody.length >= MIN_LENGTH &&
    hasJdSignal(fullBody) &&
    (!confident || (!hasJdSignal(text) && fullBody.length > text.length * 1.3))
  ) {
    text = fullBody;
    confident = true;
  }

  if (!confident) {
    for (const sel of CONTAINER_SELECTORS) {
      const candidate = normalize($(sel).first().text());
      if (candidate.length >= MIN_LENGTH) {
        text = candidate;
        confident = true;
        break;
      }
    }
  }

  if (!confident) {
    text = normalize($("body").text());
  }

  return { text, ...titleCompany, company, location, confident };
}

async function tryCheerio(url: string): Promise<ExtractResult> {
  const res = await fetchFollowingSafeRedirects(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; JobAgent/1.0)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return { text: "", confident: false };
  const html = await res.text();
  const result = extractFromHtml(html, url);
  // Cheerio only sees pre-JS HTML. If extraction had to fall back to raw,
  // unconfirmed body text, that's a strong signal the real content is
  // client-rendered and absent from this HTML — don't accept it as success,
  // let fetchJd() escalate to the Playwright (JS-rendering) path instead.
  if (!result.confident) return { ...result, text: "" };
  return result;
}

async function tryPlaywright(url: string): Promise<ExtractResult> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const target = route.request().url();
      if (/^(about|data|blob):/i.test(target)) {
        await route.continue();
        return;
      }
      try {
        await assertSafeUrl(target);
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT_MS });
    const html = await page.content();
    return extractFromHtml(html, url);
  } finally {
    await closeBrowserSafely(browser);
  }
}

export async function fetchJd(url: string): Promise<FetchJdResult> {
  await assertSafeUrl(url);

  try {
    const r = await tryCheerio(url);
    if (r.text.length >= MIN_LENGTH) {
      return { text: r.text, method: "cheerio", title: r.title, company: r.company, location: r.location };
    }
  } catch (err) {
    if (err instanceof Error && /private or internal|Too many redirects|must use http|Could not resolve/.test(err.message)) throw err;
    // other fetch failures fall through to Playwright
  }

  try {
    const r = await tryPlaywright(url);
    if (r.text.length >= MIN_LENGTH) {
      return { text: r.text, method: "playwright", title: r.title, company: r.company, location: r.location };
    }
  } catch {
    // fall through to failed
  }

  return { text: "", method: "failed" };
}
