import { JobListing } from "../types";

interface ListingsJsonEntry {
  id: string;
  company_name: string;
  title: string;
  locations: string[];
  url: string;
  active: boolean;
  is_visible?: boolean;
}

/**
 * Accepts a full GitHub URL ("https://github.com/owner/repo", with or
 * without a trailing slash) or "owner/repo" shorthand.
 */
export function parseRepoUrl(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\/+$/, "");

  const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };

  const shorthandMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shorthandMatch) return { owner: shorthandMatch[1], repo: shorthandMatch[2] };

  return null;
}

/**
 * Filters to active, visible entries and maps to the shared JobListing
 * shape. `is_visible` missing is treated as visible — the field isn't
 * always present in these repos' feeds.
 */
export function parseListingsJson(raw: string): JobListing[] {
  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];

  return (entries as ListingsJsonEntry[])
    .filter((e) => e && e.active === true && e.is_visible !== false)
    .map((e) => ({
      title: e.title,
      company: e.company_name,
      location: Array.isArray(e.locations) ? e.locations.join(", ") : "",
      url: e.url,
    }));
}

/**
 * Fetches a watched repo's `.github/scripts/listings.json` feed via the
 * GitHub Contents API (which resolves the repo's default branch
 * automatically — no branch needs to be known or hardcoded) and returns
 * the active, visible listings. Never throws: any failure (bad URL, 404,
 * network error, GitHub rate limit) is logged and treated as "no jobs
 * this cycle" so one broken watched repo can't take down a scrape tick.
 */
export async function scrapeGithubRepo(repoUrl: string): Promise<JobListing[]> {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    console.warn(`[github-repo] Could not parse repo URL: ${repoUrl}`);
    return [];
  }
  const { owner, repo } = parsed;

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/.github/scripts/listings.json`;

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      headers: {
        // The raw media type returns the file's raw bytes directly instead
        // of a base64-wrapped JSON envelope. A User-Agent is required by
        // GitHub's API for unauthenticated requests or it 403s.
        Accept: "application/vnd.github.v3.raw",
        "User-Agent": "ai-job-agent",
      },
    });
  } catch (err) {
    console.warn(`[github-repo] ${owner}/${repo}: fetch failed — ${err instanceof Error ? err.message : err}`);
    return [];
  }

  if (!res.ok) {
    console.warn(`[github-repo] ${owner}/${repo}: HTTP ${res.status} fetching listings.json`);
    return [];
  }

  let raw: string;
  try {
    raw = await res.text();
  } catch (err) {
    console.warn(`[github-repo] ${owner}/${repo}: failed reading response body — ${err instanceof Error ? err.message : err}`);
    return [];
  }

  return parseListingsJson(raw);
}
