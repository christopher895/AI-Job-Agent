import { JobListing } from "../playwright";
import { matchesFilters, matchesLocation } from "../filters";

interface AmazonJob {
  title: string;
  job_path: string;
  location: string;
  posted_date?: string;
}

interface AmazonResponse {
  hits: number;
  jobs: AmazonJob[];
}

const BASE_URL = "https://www.amazon.jobs";

export async function scrapeAmazon(): Promise<JobListing[]> {
  const url = new URL(`${BASE_URL}/en/search.json`);
  url.searchParams.set("base_query", "intern");
  url.searchParams.set("result_limit", "100");
  url.searchParams.set("sort", "recent");
  url.searchParams.set("category[]", "software-development");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!res.ok) {
    console.warn(`[amazon] HTTP ${res.status}`);
    return [];
  }

  const data = (await res.json()) as AmazonResponse;

  return (data.jobs ?? [])
    .filter((job) => matchesFilters(job.title) && matchesLocation(job.location))
    .map((job) => ({
      title: job.title,
      company: "Amazon",
      url: `${BASE_URL}${job.job_path}`,
      location: job.location ?? "",
    }));
}
