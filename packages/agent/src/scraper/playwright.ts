import { chromium } from "playwright";
import path from "path";

const FEED_URL = "https://jobright.ai/jobs/recommend?from=homepage";
const AUTH_PATH = path.resolve(process.cwd(), "auth.json");
const SCROLL_PASSES = 8;

export interface JobListing {
  title: string;
  company: string;
  location: string;
  url: string;
}

export async function scrapeJobright(): Promise<JobListing[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: AUTH_PATH });
  const page = await context.newPage();

  await page.goto(FEED_URL, { waitUntil: "load", timeout: 30000 });

  // Confirm we're logged in — jobright redirects to /login if session expired
  if (page.url().includes("/login")) {
    await browser.close();
    throw new Error("Jobright session expired — re-run: npx playwright open https://jobright.ai --save-storage=packages/agent/auth.json");
  }

  await page.waitForSelector('[data-tut="jobs-card-match-score"]', { timeout: 15000 });

  // Scroll the virtual list to load more cards
  for (let i = 0; i < SCROLL_PASSES; i++) {
    await page.evaluate(() => {
      const el = document.getElementById("jobs-page-main-content");
      if (el) el.scrollTop += 1200;
    });
    await page.waitForTimeout(600);
  }

  const jobs = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-tut="jobs-card-match-score"]');
    const results: { title: string; company: string; location: string; url: string }[] = [];

    cards.forEach((card) => {
      const link = card.querySelector('a[href^="/jobs/info/"]');
      if (!link) return;

      const href = link.getAttribute("href") ?? "";
      const url = `https://jobright.ai${href}`;

      // innerText preserves line breaks so we can split on them
      const lines = (card as HTMLElement).innerText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      results.push({
        title: lines[0] ?? "Unknown",
        company: lines[1] ?? "Unknown",
        location: lines[2] ?? "Unknown",
        url,
      });
    });

    return results;
  });

  await browser.close();

  // Deduplicate by URL (virtual scroll can yield duplicates)
  const seen = new Set<string>();
  return jobs.filter((j) => {
    if (seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });
}
