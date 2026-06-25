import { JobListing } from "../playwright";
import { matchesFilters } from "../filters";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  departments: { name: string }[];
  location: { name: string };
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

export async function scrapeGreenhouse(companyName: string, slug: string): Promise<JobListing[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[greenhouse] ${companyName}: HTTP ${res.status}`);
    return [];
  }

  const data = (await res.json()) as GreenhouseResponse;

  return data.jobs
    .filter((job) => matchesFilters(job.title))
    .map((job) => ({
      title: job.title,
      company: companyName,
      url: job.absolute_url,
      location: job.location?.name ?? "",
    }));
}
