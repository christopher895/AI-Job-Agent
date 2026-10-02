import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fetchFollowingSafeRedirects } from "./ssrf";

// Jobright job pages are a dead end for JD fetching on two counts: Railway's
// datacenter IP is served a "One quick security check" interstitial instead of
// the page, and even the real logged-out page carries only a two-sentence
// summary. Logged in, though, the page's __NEXT_DATA__ exposes the employer's
// own posting (`originalUrl` / `applyLink`, usually Ashby/Greenhouse/Lever),
// which fetches fine from anywhere. So for a pasted Jobright link we use a
// saved Jobright session to resolve it to that posting and fetch that instead.
//
// The session is a Playwright storageState file, minted locally with:
//   npx playwright open https://jobright.ai --save-storage=packages/agent/auth.json
// and supplied on Railway as JOBRIGHT_AUTH_JSON_B64 (base64 of that file).
// Its SESSION_ID cookie lasts ~2 months; once it expires the resolve step just
// fails and fetchJd falls back to its normal path (and the paste box).

const TIMEOUT_MS = 10_000;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export function isJobrightUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "jobright.ai" || host.endsWith(".jobright.ai");
  } catch {
    return false;
  }
}

type StorageState = { cookies?: { name: string; value: string; domain: string }[] };

// Cookie header for jobright.ai built from a Playwright storageState JSON
// string. Returns undefined when the state holds no Jobright session cookie,
// so a stale/empty file is treated the same as no file at all.
export function jobrightCookieHeader(storageStateJson: string): string | undefined {
  let state: StorageState;
  try {
    state = JSON.parse(storageStateJson);
  } catch {
    return undefined;
  }
  const cookies = (state.cookies ?? []).filter((c) => c.domain.replace(/^\./, "").endsWith("jobright.ai"));
  if (!cookies.some((c) => c.name === "SESSION_ID")) return undefined;
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function loadStorageState(): string | undefined {
  const b64 = process.env.JOBRIGHT_AUTH_JSON_B64;
  if (b64) return Buffer.from(b64, "base64").toString("utf-8");
  const local = path.resolve(process.cwd(), "auth.json");
  return existsSync(local) ? readFileSync(local, "utf-8") : undefined;
}

// Apply links point at the application form; the JD lives on the posting
// itself. Ashby's form is a client-rendered SPA with no description, and
// Lever's /apply page omits most of it.
export function postingUrlFromApplyLink(link: string): string {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith("ashbyhq.com") || u.hostname.endsWith("lever.co")) {
      u.pathname = u.pathname.replace(/\/(application|apply)\/?$/, "");
    }
    return u.toString();
  } catch {
    return link;
  }
}

export type JobrightJob = {
  originalUrl?: string;
  title?: string;
  company?: string;
  location?: string;
};

// Pulls the job out of a Jobright job page's __NEXT_DATA__. `originalUrl` is
// only present when the page was fetched logged in.
export function parseJobrightPage(html: string): JobrightJob | undefined {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return undefined;
  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return undefined;
  }
  const ds = data?.props?.pageProps?.dataSource;
  const job = ds?.jobResult;
  if (!job) return undefined;
  const link: unknown = job.originalUrl || job.applyLink;
  const originalUrl =
    typeof link === "string" && /^https?:\/\//i.test(link) && !isJobrightUrl(link)
      ? postingUrlFromApplyLink(link)
      : undefined;
  return {
    originalUrl,
    title: job.jobTitle || undefined,
    company: ds.companyResult?.companyName || undefined,
    location: job.jobLocation || undefined,
  };
}

// Resolves a Jobright job link to the employer's posting using the saved
// session. Returns undefined (never throws) when there's no session, the page
// is a bot challenge, or the session has expired — the caller falls back.
export async function resolveJobright(url: string): Promise<JobrightJob | undefined> {
  const state = loadStorageState();
  const cookie = state ? jobrightCookieHeader(state) : undefined;
  if (!cookie) return undefined;
  try {
    const res = await fetchFollowingSafeRedirects(url, {
      headers: { "User-Agent": BROWSER_UA, Cookie: cookie, Accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[jobright] ${url} returned HTTP ${res.status}`);
      return undefined;
    }
    const job = parseJobrightPage(await res.text());
    if (!job?.originalUrl) {
      console.warn(`[jobright] no employer link on ${url} — session expired or page challenged`);
    }
    return job;
  } catch (err) {
    console.warn(`[jobright] resolve failed for ${url}:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}
