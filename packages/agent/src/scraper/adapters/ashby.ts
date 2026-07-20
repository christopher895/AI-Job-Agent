import { JobListing } from "../types";
import { matchesFilters } from "../filters";

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  isListed: boolean;
  locationName?: string;
}

interface AshbyResponse {
  jobs: AshbyJob[];
}

export async function scrapeAshby(companyName: string, slug: string): Promise<JobListing[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    console.warn(`[ashby] ${companyName}: HTTP ${res.status}`);
    return [];
  }

  const data = (await res.json()) as AshbyResponse;

  return data.jobs
    .filter((job) => job.isListed && matchesFilters(job.title))
    .map((job) => ({
      title: job.title,
      company: companyName,
      url: job.jobUrl,
      location: job.locationName ?? "",
    }));
}
