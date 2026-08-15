import { JobListing } from "../types";
import { matchesFilters, matchesLocation } from "../filters";

// Goldman's careers site (higher.gs.com) is a client-rendered SPA backed by a
// private GraphQL gateway, and its own /results listing is disallowed by
// robots.txt. The requisitions behind it come from a stock Oracle Fusion
// recruiting pod whose public search endpoint needs no auth, so we read that
// and rebuild the public role URL — /roles/ is the one path robots.txt allows.
const POD_URL =
  "https://hdpc.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions";
const SITE_NUMBER = "CX_2";
const PAGE_SIZE = 200;
// ~1,450 open requisitions as of Aug 2026; the cap just bounds a runaway loop.
const MAX_PAGES = 12;

interface OracleRequisition {
  Id: string;
  Title: string;
  PrimaryLocation?: string;
}

interface OracleResponse {
  items: {
    TotalJobsCount: number;
    requisitionList?: OracleRequisition[];
  }[];
}

export async function scrapeGoldman(): Promise<JobListing[]> {
  const jobs: JobListing[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${POD_URL}?onlyData=true&expand=requisitionList` +
      `&finder=findReqs;siteNumber=${SITE_NUMBER},limit=${PAGE_SIZE},offset=${page * PAGE_SIZE},sortBy=POSTING_DATES_DESC`;

    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) {
      console.warn(`[goldman] HTTP ${res.status} on page ${page}`);
      break;
    }

    const data = (await res.json()) as OracleResponse;
    const batch = data.items?.[0]?.requisitionList ?? [];
    if (batch.length === 0) break;

    for (const req of batch) {
      const location = req.PrimaryLocation ?? "";
      if (!matchesFilters(req.Title) || !matchesLocation(location)) continue;
      jobs.push({
        title: req.Title,
        company: "Goldman Sachs",
        url: `https://higher.gs.com/roles/${req.Id}`,
        location,
      });
    }

    if (batch.length < PAGE_SIZE) break;
  }

  return jobs;
}
