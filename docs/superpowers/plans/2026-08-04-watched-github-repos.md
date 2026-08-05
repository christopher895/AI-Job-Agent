# Watched GitHub Repos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Christopher watch GitHub repos (starting with `vanshb03/Summer2027-Internships`) for new internship postings and get emailed about them, separately from the company-career-page digest.

**Architecture:** A new scraper adapter fetches each watched repo's `.github/scripts/listings.json` feed (a structured JSON feed these community internship-tracker repos publish alongside their README), filters to active/visible entries, and feeds the result through the existing per-company snapshot-diff pipeline (reusing the `companies`/`snapshots` tables with `scrape_type: 'github-repo'`). New jobs are emailed via the existing `sendJobEmail()` helper, but in a separate call from the company digest — no title/location filtering, no cap. Runs on the existing 15-minute cron tick.

**Tech Stack:** TypeScript, Express, PostgreSQL (existing `companies`/`snapshots`/`preferences` tables — no schema changes), native `fetch`, GitHub REST Contents API (unauthenticated).

## Global Constraints

- No new database tables or columns — reuse `companies`, `snapshots`, `preferences` (JSONB) exactly as-is.
- No live network calls in automated tests (spec requirement) — network-touching code must be factored so its pure logic (URL parsing, JSON filtering/mapping) is unit-testable in isolation.
- Watched-repo jobs bypass `matchesFilters`/`matchesLocation`/`scoreJob` entirely — every `active` entry gets emailed, no title/location/keyword filtering.
- No email cap for watched-repo jobs — every newly-detected job goes out, however many that is.
- Existing DB rows written before this change won't have a `watchedRepos` key in their `preferences.data` JSONB — every read site must default missing/undefined `watchedRepos` to `[]`, not assume the type guarantee holds at runtime.
- GitHub's unauthenticated Contents API requires a `User-Agent` header or it returns 403.

---

### Task 1: Preferences plumbing — `watchedRepos` field end-to-end

**Files:**
- Modify: `packages/agent/src/config.ts`
- Modify: `packages/agent/src/api/routes/preferences.ts`
- Modify: `packages/web/lib/api.ts`
- Modify: `packages/web/components/PreferencesForm.tsx`

**Interfaces:**
- Produces: `Preferences.watchedRepos: string[]` (agent-side `config.ts` and web-side `lib/api.ts`) — consumed by Task 3's `runWatchedRepoScrapes()`.

This task has no non-trivial pure logic to unit-test (it's field plumbing + JSX), so verification is via typecheck rather than a dedicated test file, consistent with how the existing `priorityCompanies`/`maxPerEmail` fields are handled in this codebase (no dedicated tests for those either).

- [ ] **Step 1: Add `watchedRepos` to the agent-side `Preferences` type and default `FILTERS`**

In `packages/agent/src/config.ts`, add the field to the type and seed a default pointing at the repo Christopher asked about:

```ts
export type Preferences = {
  titleKeywords: string[];
  requiredKeywords: string[];
  termFilter: string | null;
  targetLocations: string[];
  maxPerEmail: number;
  priorityCompanies: string[];
  watchedRepos: string[];
};

export const FILTERS: Preferences = {
  titleKeywords: [
    "software",
    "engineer",
    "developer",
    "swe",
    "sde",
    "ai",
    "backend",
    "frontend",
    "fullstack",
    "full stack",
  ],
  requiredKeywords: ["intern"],
  termFilter: null,
  targetLocations: [
    "new york",
    "seattle",
    "san francisco",
    "chicago",
    "los angeles",
    "remote",
  ],
  maxPerEmail: 5,
  priorityCompanies: [
    "Amazon",
    "Google",
    "Meta",
    "Apple",
    "Microsoft",
    "OpenAI",
    "Anthropic",
    "xAI",
    "Perplexity",
    "Cursor",
  ],
  watchedRepos: ["https://github.com/vanshb03/Summer2027-Internships"],
};
```

- [ ] **Step 2: Extend PUT validation in the preferences route**

In `packages/agent/src/api/routes/preferences.ts`, add `watchedRepos` to the shape check:

```ts
router.put("/", async (req, res) => {
  try {
    const body = req.body as Preferences;
    if (
      !Array.isArray(body.titleKeywords) ||
      !Array.isArray(body.requiredKeywords) ||
      !Array.isArray(body.targetLocations) ||
      !Array.isArray(body.priorityCompanies) ||
      !Array.isArray(body.watchedRepos) ||
      typeof body.maxPerEmail !== "number"
    ) {
      res.status(400).json({ error: "Invalid preferences shape" });
      return;
    }
    await updatePreferences(body);
    res.json({ updated: true });
  } catch (err) {
    console.error("[preferences] PUT failed:", err);
    res.status(500).json({ error: "Failed to save preferences" });
  }
});
```

- [ ] **Step 3: Verify the agent package typechecks**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Add `watchedRepos` to the web-side `Preferences` type**

In `packages/web/lib/api.ts`, find the existing type:

```ts
export type Preferences = {
  titleKeywords: string[];
  requiredKeywords: string[];
  termFilter: string | null;
  targetLocations: string[];
  maxPerEmail: number;
  priorityCompanies: string[];
};
```

Add the field:

```ts
export type Preferences = {
  titleKeywords: string[];
  requiredKeywords: string[];
  termFilter: string | null;
  targetLocations: string[];
  maxPerEmail: number;
  priorityCompanies: string[];
  watchedRepos: string[];
};
```

- [ ] **Step 5: Add the "Watched GitHub Repos" section to `PreferencesForm.tsx`**

In `packages/web/components/PreferencesForm.tsx`, the existing "Email settings" card ends around this point (search for `Priority companies (get a score bonus`):

```tsx
            <div>
              <Label>Priority companies (get a score bonus — appear first)</Label>
              <TagInput
                tags={prefs.priorityCompanies}
                onChange={(v) => set("priorityCompanies", v)}
                placeholder="Google, Anthropic, OpenAI..."
              />
            </div>
          </div>
        </div>
      </div>
```

Insert a new card between the closing `</div>` of the "Email settings" card and the closing `</div>` of the `flex flex-col gap-6` wrapper (i.e. right after the "Email settings" `</div>`, still inside the `gap-6` wrapper):

```tsx
            <div>
              <Label>Priority companies (get a score bonus — appear first)</Label>
              <TagInput
                tags={prefs.priorityCompanies}
                onChange={(v) => set("priorityCompanies", v)}
                placeholder="Google, Anthropic, OpenAI..."
              />
            </div>
          </div>
        </div>

        {/* Watched GitHub repos */}
        <div className="border border-paper-border rounded-xl p-5 bg-paper">
          <SectionHeader
            title="Watched GitHub Repos"
            description="Community internship-tracker repos to poll for new postings. Checked on the same 15-minute cycle as company pages, but jobs found here aren't filtered by title/location and are emailed separately, uncapped."
          />
          <Label>Repo URLs</Label>
          <TagInput
            tags={prefs.watchedRepos ?? []}
            onChange={(v) => set("watchedRepos", v)}
            placeholder="https://github.com/owner/repo"
          />
        </div>
      </div>
```

Note the `prefs.watchedRepos ?? []` guard — existing preferences rows saved before this change won't have this key, so `prefs.watchedRepos` can be `undefined` at runtime even though the type says `string[]`.

- [ ] **Step 6: Verify the web package typechecks and builds**

Run: `cd packages/web && npx tsc --noEmit && npx next build`
Expected: no type errors, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/config.ts packages/agent/src/api/routes/preferences.ts packages/web/lib/api.ts packages/web/components/PreferencesForm.tsx
git commit -m "feat: add watchedRepos preference for GitHub repo job notifications"
```

---

### Task 2: GitHub repo adapter — fetch, parse, and filter `listings.json`

**Files:**
- Create: `packages/agent/src/scraper/adapters/github-repo.ts`
- Create: `packages/agent/src/scraper/test-fixtures/listings-sample.json`
- Create: `packages/agent/src/scraper/test-github-repo.ts`
- Modify: `packages/agent/package.json` (add test script)

**Interfaces:**
- Consumes: `JobListing` type from `packages/agent/src/scraper/types.ts` (`{ title: string; company: string; location: string; url: string }`).
- Produces:
  - `parseRepoUrl(input: string): { owner: string; repo: string } | null` — used by Task 3.
  - `parseListingsJson(raw: string): JobListing[]` — pure, tested here.
  - `scrapeGithubRepo(repoUrl: string): Promise<JobListing[]>` — used by Task 3, same shape as the existing adapters (`scrapeGreenhouse`, `scrapeAshby`, etc.), never throws.

- [ ] **Step 1: Write the test fixture**

Create `packages/agent/src/scraper/test-fixtures/listings-sample.json`:

```json
[
  {
    "id": "aaa",
    "company_name": "Rippling",
    "title": "Software Engineer Intern",
    "locations": ["New York, NY", "San Francisco, CA"],
    "url": "https://ats.rippling.com/jobs/abc123",
    "active": true,
    "is_visible": true
  },
  {
    "id": "bbb",
    "company_name": "Acme Corp",
    "title": "Backend Intern",
    "locations": ["Remote"],
    "url": "https://acme.example.com/jobs/xyz",
    "active": true
  },
  {
    "id": "ccc",
    "company_name": "Closed Co",
    "title": "Closed Role",
    "locations": ["Chicago, IL"],
    "url": "https://closedco.example.com/jobs/1",
    "active": false,
    "is_visible": true
  },
  {
    "id": "ddd",
    "company_name": "Hidden Co",
    "title": "Hidden Role",
    "locations": ["Austin, TX"],
    "url": "https://hiddenco.example.com/jobs/2",
    "active": true,
    "is_visible": false
  }
]
```

This covers: a normal active+visible entry with multiple locations (Rippling), an active entry with `is_visible` entirely missing — must default to visible (Acme), an inactive entry that must be dropped (Closed Co), and an explicitly-hidden entry that must be dropped (Hidden Co).

- [ ] **Step 2: Write the failing test**

Create `packages/agent/src/scraper/test-github-repo.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseListingsJson, parseRepoUrl } from "./adapters/github-repo";

let failed = false;

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`✗ ${label}\n  expected: ${e}\n  actual:   ${a}`);
    failed = true;
  } else {
    console.log(`✓ ${label}`);
  }
}

assertEqual(
  parseRepoUrl("https://github.com/vanshb03/Summer2027-Internships"),
  { owner: "vanshb03", repo: "Summer2027-Internships" },
  "parseRepoUrl: full https URL"
);
assertEqual(
  parseRepoUrl("https://github.com/vanshb03/Summer2027-Internships/"),
  { owner: "vanshb03", repo: "Summer2027-Internships" },
  "parseRepoUrl: trailing slash"
);
assertEqual(
  parseRepoUrl("vanshb03/Summer2027-Internships"),
  { owner: "vanshb03", repo: "Summer2027-Internships" },
  "parseRepoUrl: owner/repo shorthand"
);
assertEqual(parseRepoUrl("not a url"), null, "parseRepoUrl: malformed input returns null");

const fixture = readFileSync(join(__dirname, "test-fixtures", "listings-sample.json"), "utf-8");
const jobs = parseListingsJson(fixture);

assertEqual(jobs.length, 2, "parseListingsJson: keeps only active + visible entries");
assertEqual(
  jobs[0],
  {
    title: "Software Engineer Intern",
    company: "Rippling",
    location: "New York, NY, San Francisco, CA",
    url: "https://ats.rippling.com/jobs/abc123",
  },
  "parseListingsJson: maps fields correctly, joins multiple locations"
);
assertEqual(
  jobs[1],
  {
    title: "Backend Intern",
    company: "Acme Corp",
    location: "Remote",
    url: "https://acme.example.com/jobs/xyz",
  },
  "parseListingsJson: is_visible defaults to visible when the field is missing"
);
assertEqual(parseListingsJson("not json"), [], "parseListingsJson: malformed JSON returns empty array");
assertEqual(parseListingsJson("{}"), [], "parseListingsJson: non-array JSON returns empty array");

if (failed) {
  console.error("\n✗ github-repo adapter test FAILED");
  process.exit(1);
} else {
  console.log("\n✓ github-repo adapter test PASSED");
}
```

- [ ] **Step 3: Add the test script and run it to confirm it fails**

In `packages/agent/package.json`, add to `"scripts"`:

```json
"test:github-repo": "tsx src/scraper/test-github-repo.ts",
```

Run: `cd packages/agent && npm run test:github-repo`
Expected: FAIL — `Cannot find module './adapters/github-repo'` (the file doesn't exist yet).

- [ ] **Step 4: Implement the adapter**

Create `packages/agent/src/scraper/adapters/github-repo.ts`:

```ts
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

  const raw = await res.text();
  return parseListingsJson(raw);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/agent && npm run test:github-repo`
Expected: all lines print `✓`, ending with `✓ github-repo adapter test PASSED`, exit code 0.

- [ ] **Step 6: Verify the agent package still typechecks**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/scraper/adapters/github-repo.ts packages/agent/src/scraper/test-fixtures/listings-sample.json packages/agent/src/scraper/test-github-repo.ts packages/agent/package.json
git commit -m "feat: add GitHub repo listings.json adapter with unit tests"
```

---

### Task 3: Orchestration + cron wiring

**Files:**
- Create: `packages/agent/src/scraper/github-repos.ts`
- Modify: `packages/agent/src/cron/scheduler.ts`

**Interfaces:**
- Consumes: `scrapeGithubRepo`, `parseRepoUrl` from `./adapters/github-repo` (Task 2); `hashJob`, `diffSnapshots` from `./diff`; `getOrCreateCompany`, `getLatestSnapshot`, `saveSnapshot`, `getPreferences` from `../db/queries`; `sendJobEmail` from `../notifications/email`; `Preferences.watchedRepos` (Task 1).
- Produces: `runWatchedRepoScrapes(): Promise<void>` — called from the cron tick in `scheduler.ts`.

No dedicated automated test for this task: it's DB- and network-dependent orchestration wiring with no non-trivial pure logic beyond what Task 2 already covers, matching this codebase's existing convention (`scraper/index.ts`'s `runAllCompanyScrapes` has no dedicated test either). Verified via typecheck plus a manual local run against the docker-compose Postgres.

- [ ] **Step 1: Implement the orchestration module**

Create `packages/agent/src/scraper/github-repos.ts`:

```ts
import { JobListing } from "./types";
import { hashJob, diffSnapshots } from "./diff";
import { getOrCreateCompany, getLatestSnapshot, saveSnapshot, getPreferences } from "../db/queries";
import { sendJobEmail } from "../notifications/email";
import { scrapeGithubRepo, parseRepoUrl } from "./adapters/github-repo";

function repoLabel(repoUrl: string): string {
  const parsed = parseRepoUrl(repoUrl);
  return parsed ? `${parsed.owner}/${parsed.repo}` : repoUrl;
}

async function processWatchedRepo(repoUrl: string): Promise<JobListing[]> {
  const name = repoLabel(repoUrl);
  const record = await getOrCreateCompany(name, repoUrl, "github-repo");

  const currentJobs = await scrapeGithubRepo(repoUrl);
  const currentHashes = currentJobs.map((j) => hashJob(j.url));

  const prevSnapshot = await getLatestSnapshot(record.id);
  const prevHashes: string[] = prevSnapshot?.job_hashes ?? [];

  const newHashSet = new Set(diffSnapshots(prevHashes, currentHashes));
  const hashToJob = new Map(currentJobs.map((j, i) => [currentHashes[i], j]));
  const newJobs = [...newHashSet].map((h) => hashToJob.get(h)!).filter(Boolean);

  await saveSnapshot(record.id, currentHashes);

  if (newJobs.length > 0) {
    console.log(`[github-repo] ${name}: ${newJobs.length} new job(s)`);
  }

  return newJobs;
}

export async function runWatchedRepoScrapes(): Promise<void> {
  const prefs = await getPreferences();
  const watchedRepos = prefs.watchedRepos ?? [];

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
```

Note `prefs.watchedRepos ?? []`: existing `preferences` rows saved before Task 1 won't have this key, so the field can be `undefined` at runtime even though the type says `string[]`.

- [ ] **Step 2: Wire it into the cron scheduler**

In `packages/agent/src/cron/scheduler.ts`, the current tick runs only the company scrape:

```ts
import cron from "node-cron";
import { runAllCompanyScrapes } from "../scraper/index";

let tickInFlight = false;

async function runTick() {
  if (tickInFlight) {
    console.warn("[scheduler] Previous tick still running — skipping this tick");
    return;
  }
  tickInFlight = true;
  try {
    await runAllCompanyScrapes().catch((err) => console.error("[scheduler] Run failed:", err));
  } finally {
    tickInFlight = false;
  }
}
```

Replace with:

```ts
import cron from "node-cron";
import { runAllCompanyScrapes } from "../scraper/index";
import { runWatchedRepoScrapes } from "../scraper/github-repos";

let tickInFlight = false;

async function runTick() {
  if (tickInFlight) {
    console.warn("[scheduler] Previous tick still running — skipping this tick");
    return;
  }
  tickInFlight = true;
  try {
    await runAllCompanyScrapes().catch((err) => console.error("[scheduler] Company scrape run failed:", err));
    await runWatchedRepoScrapes().catch((err) => console.error("[scheduler] Watched repo scrape run failed:", err));
  } finally {
    tickInFlight = false;
  }
}
```

The rest of `scheduler.ts` (the `cron.schedule("*/15 * * * *", ...)` block and `startScheduler()`) is unchanged — both scrapes now run sequentially on the same tick, each independently caught so one failing doesn't block the other or leave `tickInFlight` stuck.

- [ ] **Step 3: Verify the agent package typechecks**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test against local Postgres**

This requires `docker-compose up` running locally with `DATABASE_URL` pointing at it, and `RESEND_API_KEY`/`YOUR_EMAIL` set (or expect the email send to throw, which is caught and logged — the diff/snapshot logic is what's being checked here, not email delivery).

Run:
```bash
cd packages/agent
npx tsx -e "
import { runWatchedRepoScrapes } from './src/scraper/github-repos';
runWatchedRepoScrapes().then(() => process.exit(0));
"
```

Expected: logs `[github-repo] Scanning 1 watched repo(s)...`, then either `[github-repo] vanshb03/Summer2027-Internships: N new job(s)` (first run — everything is "new" against an empty snapshot) or `[github-repo] No new jobs found.` Run it a second time immediately after: expected `[github-repo] No new jobs found.` since the snapshot now matches current listings.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/scraper/github-repos.ts packages/agent/src/cron/scheduler.ts
git commit -m "feat: poll watched GitHub repos on the scraper cron tick and email new jobs separately"
```
