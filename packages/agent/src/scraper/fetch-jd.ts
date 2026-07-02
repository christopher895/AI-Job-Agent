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
