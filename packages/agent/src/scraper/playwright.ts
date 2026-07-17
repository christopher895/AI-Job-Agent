import { chromium, Browser } from "playwright";
import fs from "fs";
import path from "path";
import { FILTERS } from "../config";
import { closeBrowserSafely } from "./browser-utils";

const FEED_URL = "https://jobright.ai/jobs/recommend?from=homepage";
const AUTH_PATH = path.resolve(process.cwd(), "auth.json");
const SCROLL_PASSES = 8;

// page.evaluate() and browser.newContext()/newPage() have no built-in timeout
// the way page.goto()/waitForSelector() do — if the browser is left in a half
// -crashed state (renderer OOM-killed but process still limping along), those
// calls can hang forever with nothing to bound them, wedging the scheduler's
// tick mutex permanently. This caps the whole scrape so it always settles.
const SCRAPE_TIMEOUT_MS = 90_000;

// On Railway (or any ephemeral host) auth.json isn't checked into git, so there's
// nothing on disk after a fresh deploy. JOBRIGHT_AUTH_JSON_B64 lets the session be
// supplied via an env var instead; written to disk once per container start.
function ensureAuthFile() {
  if (fs.existsSync(AUTH_PATH)) return;
  const b64 = process.env.JOBRIGHT_AUTH_JSON_B64;
  if (!b64) return;
  fs.writeFileSync(AUTH_PATH, Buffer.from(b64, "base64"));
}

const BADGE_PATTERNS = [
  /^\d+ (school alumni|new applicants)/i,
  /^be an early applicant$/i,
  /^reposted/i,
  /^\d+ (hour|day|minute|second)s? ago$/i,
  /^just now$/i,
];

export interface JobListing {
  title: string;
  company: string;
  location: string;
  url: string;
}

function parseCard(rawText: string): { title: string; company: string; location: string } {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1)
    .filter((l) => !BADGE_PATTERNS.some((p) => p.test(l)));

  let title = "Unknown";
  let company = "Unknown";
  let location = "Unknown";

  if (lines[0]) {
    // Cards sometimes render as "Title — Company" or "Badge — Title"
    const parts = lines[0].split(" — "); // em dash
    if (parts.length === 2) {
      title = parts[0].trim();
      company = parts[1].trim();
    } else {
      title = lines[0];
      company = lines[1] ?? "Unknown";
    }
  }

  location = lines[2] ?? lines[1] ?? "Unknown";

  return { title, company, location };
}

function warnIfUnknownsAreHigh(jobs: JobListing[]) {
  if (jobs.length === 0) return;
  const unknownCount = jobs.filter((j) => j.title === "Unknown" || j.company === "Unknown").length;
  if (unknownCount / jobs.length > 0.5) {
    console.warn(`[jobright] ${unknownCount}/${jobs.length} cards parsed as Unknown — Jobright UI may have changed`);
  }
}

async function scrapeWithBrowser(browser: Browser): Promise<JobListing[]> {
  const context = await browser.newContext({ storageState: AUTH_PATH });
  const page = await context.newPage();

  await page.goto(FEED_URL, { waitUntil: "load", timeout: 30000 });

  // An expired session doesn't always land on /login — Jobright sometimes redirects
  // straight to the logged-out marketing homepage instead. Checking for "not the feed
  // URL we asked for" catches both, rather than assuming one specific redirect target.
  if (!page.url().startsWith(FEED_URL.split("?")[0])) {
    throw new Error(
      `Jobright session expired — landed on ${page.url()} instead of the jobs feed. ` +
      "Re-run: npx playwright open https://jobright.ai --save-storage=packages/agent/auth.json, " +
      "then update JOBRIGHT_AUTH_JSON_B64 with the new file's base64 contents."
    );
  }

  try {
    await page.waitForSelector('[data-tut="jobs-card-match-score"]', { timeout: 30000 });
  } catch (err) {
    // Timeout alone doesn't say whether this is a slow render or Jobright serving
    // something else entirely (rate-limit/bot-check page) to a datacenter IP —
    // log enough of the page to tell the two apart next time this fires.
    const preview = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? "");
    console.error(
      `[jobright] job cards never appeared — url=${page.url()} title=${await page.title()} bodyPreview=${JSON.stringify(preview)}`
    );
    throw err;
  }

  for (let i = 0; i < SCROLL_PASSES; i++) {
    await page.evaluate(() => {
      const el = document.getElementById("jobs-page-main-content");
      if (el) el.scrollTop += 1200;
    });
    await page.waitForTimeout(600);
  }

  const raw = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-tut="jobs-card-match-score"]');
    const results: { text: string; url: string }[] = [];

    cards.forEach((card) => {
      const link = card.querySelector('a[href^="/jobs/info/"]');
      if (!link) return;
      const href = link.getAttribute("href") ?? "";
      results.push({
        text: (card as HTMLElement).innerText,
        url: `https://jobright.ai${href}`,
      });
    });

    return results;
  });

  // Deduplicate by URL
  const seen = new Set<string>();
  const jobs: JobListing[] = [];

  for (const { text, url } of raw) {
    if (seen.has(url)) continue;
    seen.add(url);

    const { title, company, location } = parseCard(text);

    // Must be an internship
    if (!/intern/i.test(title)) continue;

    // Must match at least one keyword from config
    const titleLower = title.toLowerCase();
    const matchesKeyword = FILTERS.titleKeywords.some((kw) =>
      titleLower.includes(kw.toLowerCase())
    );
    if (!matchesKeyword) continue;

    // Optional term filter
    if (FILTERS.termFilter && !title.includes(FILTERS.termFilter)) continue;

    jobs.push({ title, company, location, url });
  }

  warnIfUnknownsAreHigh(jobs);
  return jobs;
}

export async function scrapeJobright(): Promise<JobListing[]> {
  ensureAuthFile();
  if (!fs.existsSync(AUTH_PATH)) {
    throw new Error(
      "No Jobright session found — run locally: npx playwright open https://jobright.ai --save-storage=packages/agent/auth.json, " +
      "then set JOBRIGHT_AUTH_JSON_B64 (base64 of that file) wherever this is deployed."
    );
  }

  // Docker containers default /dev/shm to 64MB, which Chromium's renderer can
  // exhaust on a JS-heavy infinite-scroll page like Jobright — surfaces as a bare
  // "Page crashed" error. --disable-dev-shm-usage makes it fall back to /tmp instead.
  // Doesn't reproduce locally since the host's shared memory isn't constrained the same way.
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      scrapeWithBrowser(browser),
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(
          () => reject(new Error(`Jobright scrape exceeded ${SCRAPE_TIMEOUT_MS}ms — aborting`)),
          SCRAPE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    clearTimeout(watchdog);
    // Runs whether scrapeWithBrowser finished, threw, or the watchdog fired.
    // Closing (and, if needed, force-killing per closeBrowserSafely) the shared
    // browser here means a losing/abandoned scrapeWithBrowser call fails fast on
    // its next Playwright call instead of lingering and racing the next tick.
    await closeBrowserSafely(browser);
  }
}
