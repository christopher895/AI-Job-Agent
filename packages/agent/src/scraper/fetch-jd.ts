import * as cheerio from "cheerio";

export type FetchJdResult = {
  text: string;
  method: "cheerio" | "playwright" | "failed";
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

async function tryCheerio(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; JobAgent/1.0)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return "";
  const html = await res.text();
  const $ = cheerio.load(html);
  $("nav, header, footer, script, style, aside, [role=navigation]").remove();
  for (const sel of CONTAINER_SELECTORS) {
    const text = $(sel).first().text().replace(/\s+/g, " ").trim();
    if (text.length >= MIN_LENGTH) return text;
  }
  return $("body").text().replace(/\s+/g, " ").trim();
}

async function tryPlaywright(url: string): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT_MS });
    return await page.evaluate(() => {
      document
        .querySelectorAll("nav, header, footer, script, style, aside")
        .forEach((el) => el.remove());
      return (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
    });
  } finally {
    await browser.close();
  }
}

export async function fetchJd(url: string): Promise<FetchJdResult> {
  validateUrl(url); // throws on invalid scheme or private IP

  try {
    const cheerioText = await tryCheerio(url);
    if (cheerioText.length >= MIN_LENGTH) return { text: cheerioText, method: "cheerio" };
  } catch {
    // fall through to Playwright
  }

  try {
    const playwrightText = await tryPlaywright(url);
    if (playwrightText.length >= MIN_LENGTH) return { text: playwrightText, method: "playwright" };
  } catch {
    // fall through to failed
  }

  return { text: "", method: "failed" };
}
