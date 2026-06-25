import { JobListing, scrapeJobright } from "./playwright";
import { hashJob, diffSnapshots } from "./diff";
import { getOrCreateCompany, getLatestSnapshot, saveSnapshot, upsertJob } from "../db/queries";
import { sendJobEmail } from "../notifications/email";
import { COMPANIES, Company } from "./companies";
import { scrapeGreenhouse } from "./adapters/greenhouse";
import { scrapeAshby } from "./adapters/ashby";
import { scrapeLever } from "./adapters/lever";

async function scrapeCompany(company: Company): Promise<JobListing[]> {
  switch (company.platform) {
    case "greenhouse": return scrapeGreenhouse(company.name, company.slug);
    case "ashby":      return scrapeAshby(company.name, company.slug);
    case "lever":      return scrapeLever(company.name, company.slug);
    default:
      console.warn(`[scraper] No adapter for platform "${company.platform}" (${company.name})`);
      return [];
  }
}

async function processCompany(company: Company): Promise<JobListing[]> {
  const record = await getOrCreateCompany(company.name, `https://${company.platform}/${company.slug}`, company.platform);

  const currentJobs = await scrapeCompany(company);
  const currentHashes = currentJobs.map((j) => hashJob(j.url));

  const prevSnapshot = await getLatestSnapshot(record.id);
  const prevHashes: string[] = prevSnapshot?.job_hashes ?? [];

  const newHashSet = new Set(diffSnapshots(prevHashes, currentHashes));
  const hashToJob = new Map(currentJobs.map((j, i) => [currentHashes[i], j]));
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
  console.log(`[scraper] Scanning ${COMPANIES.length} companies...`);

  const results = await Promise.allSettled(COMPANIES.map(processCompany));

  const allNewJobs: JobListing[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") allNewJobs.push(...result.value);
    else console.error("[scraper] Company failed:", result.reason);
  }

  if (allNewJobs.length > 0) {
    await sendJobEmail(allNewJobs);
    console.log(`[scraper] Emailed ${allNewJobs.length} new job(s) across all companies.`);
  } else {
    console.log("[scraper] No new jobs found across all companies.");
  }
}

export async function runJobrightScrape(): Promise<JobListing[]> {
  const source = await getOrCreateCompany("Jobright", "https://jobright.ai/jobs/recommend", "playwright");

  const currentJobs = await scrapeJobright();
  const currentHashes = currentJobs.map((j) => hashJob(j.url));

  const prevSnapshot = await getLatestSnapshot(source.id);
  const prevHashes: string[] = prevSnapshot?.job_hashes ?? [];

  const newHashSet = new Set(diffSnapshots(prevHashes, currentHashes));
  const hashToJob = new Map(currentJobs.map((j, i) => [currentHashes[i], j]));
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
