import { JobListing } from "./types";
import { hashJob, diffSnapshots } from "./diff";
import { getOrCreateCompany, getLatestSnapshot, saveSnapshot, getPreferences, upsertJob } from "../db/queries";
import { sendJobEmail } from "../notifications/email";
import { scrapeGithubRepo, parseRepoUrl } from "./adapters/github-repo";

function repoLabel(repoUrl: string): string {
  const parsed = parseRepoUrl(repoUrl);
  return parsed ? `${parsed.owner}/${parsed.repo}` : repoUrl;
}

async function processWatchedRepo(repoUrl: string): Promise<JobListing[]> {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    console.warn(`[github-repo] Skipping unparseable repo URL: ${repoUrl}`);
    return [];
  }
  const name = `${parsed.owner}/${parsed.repo}`;

  const record = await getOrCreateCompany(name, repoUrl, "github-repo");

  const currentJobs = await scrapeGithubRepo(repoUrl);
  if (currentJobs === null) {
    console.warn(`[github-repo] ${name}: scrape failed this cycle, leaving prior snapshot intact`);
    return [];
  }

  const currentHashes = currentJobs.map((j) => hashJob(j.url));

  const prevSnapshot = await getLatestSnapshot(record.id);

  if (!prevSnapshot) {
    await saveSnapshot(record.id, currentHashes);
    console.log(`[github-repo] ${name}: seeded ${currentHashes.length} listing(s), no email on first run`);
    return [];
  }

  const prevHashes: string[] = prevSnapshot.job_hashes ?? [];

  const newHashSet = new Set(diffSnapshots(prevHashes, currentHashes));
  const hashToJob = new Map(currentJobs.map((j, i) => [currentHashes[i], j]));
  const candidateJobs = [...newHashSet].map((h) => hashToJob.get(h)!).filter(Boolean);

  await saveSnapshot(record.id, currentHashes);

  // The snapshot diff above isn't atomic across concurrent processes (e.g. a
  // rolling deploy briefly running old + new containers): both could read the
  // same prior snapshot and compute the same "new" jobs. `jobs.url` is UNIQUE,
  // so upsertJob's ON CONFLICT DO NOTHING is the real, race-safe gate — only
  // a job this call actually inserted gets emailed, so at most one process
  // wins per job and duplicate alert emails can't go out.
  const newJobs: JobListing[] = [];
  for (const job of candidateJobs) {
    const inserted = await upsertJob(record.id, job.title, job.company, job.url);
    if (inserted) newJobs.push(job);
  }

  if (newJobs.length > 0) {
    console.log(`[github-repo] ${name}: ${newJobs.length} new job(s)`);
  }

  return newJobs;
}

export async function runWatchedRepoScrapes(): Promise<void> {
  const prefs = await getPreferences();
  const rawWatchedRepos = prefs.watchedRepos ?? [];

  const seenRepoLabels = new Set<string>();
  const watchedRepos = rawWatchedRepos.filter((url) => {
    const label = repoLabel(url);
    if (seenRepoLabels.has(label)) return false;
    seenRepoLabels.add(label);
    return true;
  });

  if (watchedRepos.length === 0) return;

  console.log(`[github-repo] Scanning ${watchedRepos.length} watched repo(s)...`);

  const results = await Promise.allSettled(watchedRepos.map(processWatchedRepo));

  const allNewJobs: JobListing[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") allNewJobs.push(...result.value);
    else console.error("[github-repo] Watched repo scrape failed:", result.reason);
  }

  if (allNewJobs.length === 0) {
    console.log("[github-repo] No new jobs found.");
    return;
  }

  const source =
    watchedRepos.length === 1 ? repoLabel(watchedRepos[0]) : `${watchedRepos.length} watched GitHub repos`;

  console.log(`[github-repo] ${allNewJobs.length} new job(s) found — emailing all (no cap)`);

  await sendJobEmail(allNewJobs, source);
}
