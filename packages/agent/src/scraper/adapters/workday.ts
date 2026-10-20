import { JobListing } from "../types";
import { matchesFilters } from "../filters";

// Workday career sites are client-rendered, but each one is backed by a public,
// unauthenticated JSON endpoint: POST /wday/cxs/{tenant}/{site}/jobs. Its search
// is fuzzy and every page is capped at 20, so we search "intern" (all this agent
// alerts on) and let matchesFilters do the real title filtering.
const PAGE_SIZE = 20;
// Snap's "intern" search returns ~100; the cap just bounds a runaway loop.
const MAX_PAGES = 15;

export interface WorkdaySite {
  host: string;
  tenant: string;
  site: string;
}

export interface WorkdayPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
}

/** Slug format: "{tenant}.{wdN}/{site}", e.g. "snapchat.wd1/snap". */
export function parseWorkdaySlug(slug: string): WorkdaySite | null {
  const m = slug.match(/^([a-z0-9-]+)\.(wd\d+)\/([A-Za-z0-9_-]+)$/i);
  if (!m) return null;
  return { host: `${m[1]}.${m[2]}.myworkdayjobs.com`, tenant: m[1], site: m[3] };
}

export function toListings(companyName: string, site: WorkdaySite, postings: WorkdayPosting[]): JobListing[] {
  return postings
    .filter((p): p is Required<Pick<WorkdayPosting, "title" | "externalPath">> & WorkdayPosting =>
      typeof p.title === "string" && typeof p.externalPath === "string")
    .map((p) => ({
      title: p.title,
      company: companyName,
      url: `https://${site.host}/${site.site}${p.externalPath}`,
      // A multi-location posting reads "2 Locations" — that names no place, so
      // treat it as unknown (which passes the location filter) rather than drop it.
      location: /^\d+ Locations$/i.test(p.locationsText ?? "") ? "" : p.locationsText ?? "",
    }));
}

export async function scrapeWorkday(companyName: string, slug: string): Promise<JobListing[]> {
  const site = parseWorkdaySlug(slug);
  if (!site) {
    console.warn(`[workday] ${companyName}: bad slug "${slug}"`);
    return [];
  }
  const endpoint = `https://${site.host}/wday/cxs/${site.tenant}/${site.site}/jobs`;
  const jobs: JobListing[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, searchText: "intern", appliedFacets: {} }),
    });
    if (!res.ok) {
      console.warn(`[workday] ${companyName}: HTTP ${res.status} on page ${page}`);
      break;
    }
    const data = (await res.json()) as { jobPostings?: WorkdayPosting[] };
    const batch = data.jobPostings ?? [];
    jobs.push(...toListings(companyName, site, batch));
    if (batch.length < PAGE_SIZE) break;
  }

  return jobs.filter((j) => matchesFilters(j.title));
}
