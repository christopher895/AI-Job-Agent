import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export type FetchJdResult = {
  text: string;
  method: "cheerio" | "playwright" | "failed";
  title?: string;
  company?: string;
  location?: string;
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

  const sld = labels[labels.length - 2];
  if (!sld) return undefined;
  return sld.charAt(0).toUpperCase() + sld.slice(1);
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
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
    const company = parts[parts.length - 1];
    const title = parts.slice(0, -1).join(sep);
    return { title, company };
  }

  return { title: h1 || pageTitle };
}

// Greenhouse, Lever, Ashby, and Workday all embed a schema.org JobPosting
// block for SEO — it's the most reliable source for structured location data,
// since scraping visible page text for "location" is brittle across ATS themes.
function extractJsonLdLocation($: CheerioAPI): string | undefined {
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
      if (jp.jobLocationType === "TELECOMMUTE") return "Remote";

      const jobLocation = Array.isArray(jp.jobLocation) ? jp.jobLocation[0] : jp.jobLocation;
      const address = (jobLocation as Record<string, unknown> | undefined)?.address as
        | Record<string, unknown>
        | undefined;
      if (!address) continue;

      const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
        .filter((p): p is string => typeof p === "string" && p.length > 0);
      if (parts.length) return parts.join(", ");
    }
  }
  return undefined;
}

export function extractFromHtml(
  html: string,
  url: string
): { text: string; title?: string; company?: string; location?: string } {
  const $ = cheerio.load(html);
  const titleCompany = extractTitleCompany($, url);
  if (!titleCompany.company) {
    titleCompany.company = companyFromHost(url);
  }
  const location = extractJsonLdLocation($);

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

  return { text, ...titleCompany, location };
}

async function tryCheerio(
  url: string
): Promise<{ text: string; title?: string; company?: string; location?: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; JobAgent/1.0)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return { text: "" };
  const html = await res.text();
  return extractFromHtml(html, url);
}

async function tryPlaywright(
  url: string
): Promise<{ text: string; title?: string; company?: string; location?: string }> {
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
      return { text: r.text, method: "cheerio", title: r.title, company: r.company, location: r.location };
    }
  } catch {
    // fall through to Playwright
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
