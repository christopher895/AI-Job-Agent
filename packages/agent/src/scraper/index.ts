import { scrapeJobright, JobListing } from "./playwright";
import { hashJob, diffSnapshots } from "./diff";
import { getOrCreateCompany, getLatestSnapshot, saveSnapshot, upsertJob } from "../db/queries";
import { sendJobEmail } from "../notifications/email";

export async function runJobrightScrape(): Promise<JobListing[]> {
  const source = await getOrCreateCompany(
    "Jobright",
    "https://jobright.ai/jobs/recommend",
    "playwright"
  );

  const currentJobs = await scrapeJobright();
  const currentHashes = currentJobs.map((j) => hashJob(j.url));

  const prevSnapshot = await getLatestSnapshot(source.id);
  const prevHashes: string[] = prevSnapshot?.job_hashes ?? [];

  const newHashSet = new Set(diffSnapshots(prevHashes, currentHashes));

  const hashToJob = new Map(currentJobs.map((j, i) => [currentHashes[i], j]));
  const newJobs = [...newHashSet]
    .map((h) => hashToJob.get(h)!)
    .filter(Boolean);

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
