import { JobListing } from "../types";
import { matchesFilters } from "../filters";

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  categories: {
    location?: string;
    team?: string;
  };
}

export async function scrapeLever(companyName: string, slug: string): Promise<JobListing[]> {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[lever] ${companyName}: HTTP ${res.status}`);
    return [];
  }

  const data = (await res.json()) as LeverJob[];

  return data
    .filter((job) => matchesFilters(job.text))
    .map((job) => ({
      title: job.text,
      company: companyName,
      url: job.hostedUrl,
      location: job.categories?.location ?? "",
    }));
}
