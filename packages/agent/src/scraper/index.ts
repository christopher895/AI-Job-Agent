import { JobListing, scrapeJobright } from "./playwright";
import { hashJob, diffSnapshots } from "./diff";
import { getOrCreateCompany, getLatestSnapshot, saveSnapshot, upsertJob } from "../db/queries";
import { sendJobEmail } from "../notifications/email";
import { COMPANIES, Company } from "./companies";
import { scrapeGreenhouse } from "./adapters/greenhouse";
import { scrapeAshby } from "./adapters/ashby";
import { scrapeLever } from "./adapters/lever";
import { scrapeAmazon } from "./adapters/amazon";
import { matchesLocation, scoreJob, applyPreferences } from "./filters";
import { getPreferences } from "../db/queries";

async function scrapeCompany(company: Company): Promise<JobListing[]> {
  switch (company.platform) {
    case "greenhouse": return scrapeGreenhouse(company.name, company.slug);
    case "ashby":      return scrapeAshby(company.name, company.slug);
    case "lever":      return scrapeLever(company.name, company.slug);
    case "amazon":     return scrapeAmazon();
    default:
      console.warn(`[scraper] No adapter for platform "${company.platform}" (${company.name})`);
      return [];
  }
}

function getCareerUrl(company: Company): string {
  switch (company.platform) {
    case "greenhouse": return `https://boards.greenhouse.io/${company.slug}`;
    case "ashby":      return `https://jobs.ashbyhq.com/${company.slug}`;
    case "lever":      return `https://jobs.lever.co/${company.slug}`;
    case "amazon":     return "https://www.amazon.jobs/";
    default:           return `https://${company.platform}/${company.slug}`;
  }
}

async function processCompany(company: Company): Promise<JobListing[]> {
  const record = await getOrCreateCompany(company.name, getCareerUrl(company), company.platform);

  const currentJobs = await scrapeCompany(company);

  // Filter by location before hashing/diffing
  const locationFiltered = currentJobs.filter((j) => matchesLocation(j.location));
  const currentHashes = locationFiltered.map((j) => hashJob(j.url));

  const prevSnapshot = await getLatestSnapshot(record.id);
  const prevHashes: string[] = prevSnapshot?.job_hashes ?? [];

  const newHashSet = new Set(diffSnapshots(prevHashes, currentHashes));
  const hashToJob = new Map(locationFiltered.map((j, i) => [currentHashes[i], j]));
  const newJobs = [...newHashSet].map((h) => hashToJob.get(h)!).filter(Boolean);

  for (const job of newJobs) {
    await upsertJob(record.id, job.title, job.company, job.url);
  }
  await saveSnapshot(record.id, currentHashes);

  if (newJobs.length > 0) {
    console.log(`[${company.name}] ${newJobs.length} new job(s)`);
  }

  return newJobs;
}

export async function runAllCompanyScrapes(): Promise<void> {
  const prefs = await getPreferences();
  applyPreferences(prefs);

  console.log(`[scraper] Scanning ${COMPANIES.length} companies...`);

  const results = await Promise.allSettled(COMPANIES.map(processCompany));

  const allNewJobs: JobListing[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") allNewJobs.push(...result.value);
    else console.error("[scraper] Company failed:", result.reason);
  }

  if (allNewJobs.length === 0) {
    console.log("[scraper] No new jobs found.");
    return;
  }

  // Score, sort, and cap
  const scored = allNewJobs
    .map((job) => ({ job, score: scoreJob(job) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, prefs.maxPerEmail);

  const topJobs = scored.map((s) => s.job);

  console.log(
    `[scraper] ${allNewJobs.length} new job(s) found — emailing top ${topJobs.length}:\n` +
    scored.map((s) => `  [${s.score}] ${s.job.title} @ ${s.job.company}`).join("\n")
  );

  await sendJobEmail(topJobs);
}

export async function runJobrightScrape(): Promise<JobListing[]> {
  const source = await getOrCreateCompany("Jobright", "https://jobright.ai/jobs/recommend", "playwright");

  const currentJobs = await scrapeJobright();
  const locationFiltered = currentJobs.filter((j) => matchesLocation(j.location));
  const currentHashes = locationFiltered.map((j) => hashJob(j.url));

  const prevSnapshot = await getLatestSnapshot(source.id);
  const prevHashes: string[] = prevSnapshot?.job_hashes ?? [];

  const newHashSet = new Set(diffSnapshots(prevHashes, currentHashes));
  const hashToJob = new Map(locationFiltered.map((j, i) => [currentHashes[i], j]));
  const newJobs = [...newHashSet].map((h) => hashToJob.get(h)!).filter(Boolean);

  for (const job of newJobs) {
    await upsertJob(source.id, job.title, job.company, job.url);
  }
  await saveSnapshot(source.id, currentHashes);

  if (newJobs.length > 0) {
    await sendJobEmail(newJobs);
    console.log(`Sent email for ${newJobs.length} new job(s).`);
  }

  return newJobs;
}
