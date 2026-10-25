import { JobListing } from "./types";
import { passesSeason } from "./season";
import { judgeJobs, Verdict } from "../ai/judge-jobs";
import { Preferences } from "../config";

export type AlertFilterResult = {
  kept: JobListing[];
  /** url → the judge's one-line reason, for jobs that were sent. */
  reasons: Map<string, string>;
  /** Applied/duplicate drops + season drops + judge skips — shown as a count in the email footer. */
  skipped: number;
};

/**
 * Runs between the upsertJob gate and the alert email in both alert paths:
 * companies already applied to and repeats of an earlier posting are dropped,
 * then the season rule (cheap,
 * deterministic), then the AI judge on what's left. Every drop is logged with its reason so the bar can be audited.
 */
type FilterDeps = {
  judge?: (jobs: JobListing[], bar: string) => Promise<Map<string, Verdict>>;
  /** Company names from the application log (`applied_jobs.company`). */
  appliedCompanies?: () => Promise<string[]>;
  /** Company + title of recently recorded jobs, other than the given URLs (this batch's own rows). */
  seenBefore?: (excludeUrls: string[]) => Promise<{ company: string; title: string }[]>;
};

/** How far back a matching company + title counts as the same posting. */
export const SEEN_WINDOW_DAYS = 90;

/**
 * Normalizes a title for "same posting" matching: the season, years,
 * punctuation and Intern vs Internship don't count, nor does word order — so
 * "Summer 2027 Intern - Software Engineer" matches "Software Engineer Intern".
 */
export function titleKey(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !/^(19|20)\d\d$/.test(w) && !/^(summer|fall|autumn|winter|spring)$/.test(w))
    .map((w) => (w === "internship" ? "intern" : w));
  return [...new Set(words)].sort().join(" ");
}

const postingKey = (company: string, title: string) => `${companyKey(company)}|${titleKey(title)}`;

async function loadSeenBefore(excludeUrls: string[]) {
  const { listRecentJobKeys } = await import("../db/queries");
  return listRecentJobKeys(excludeUrls, SEEN_WINDOW_DAYS);
}

const LEGAL_SUFFIX = /\b(inc|llc|ltd|corp|corporation|co|company|plc|lp)\b\s*$/;

/**
 * Normalizes a company name for "already applied" matching: case, punctuation
 * and a trailing legal suffix don't count, so "Snap Inc." matches "Snap".
 */
export function companyKey(name: string): string {
  let s = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  while (LEGAL_SUFFIX.test(s)) s = s.replace(LEGAL_SUFFIX, "").trim();
  return s.replace(/ /g, "");
}

async function loadAppliedCompanies(): Promise<string[]> {
  // Lazy import keeps the DB pool out of the unit tests' import graph.
  const { listAppliedJobs } = await import("../db/queries");
  return (await listAppliedJobs()).map((r) => r.company).filter(Boolean);
}

export async function filterForAlert(
  jobs: JobListing[],
  prefs: Pick<Preferences, "targetSeason" | "alertBar">,
  deps: FilterDeps = {}
): Promise<AlertFilterResult> {
  // Jobs are already recorded by upsertJob and will never be considered again,
  // so a filter error must not swallow them — send everything instead.
  try {
    return await runFilter(jobs, prefs, deps);
  } catch (err) {
    console.error("[alert-filter] failed — sending all new jobs unfiltered:", err);
    return { kept: jobs, reasons: new Map(), skipped: 0 };
  }
}

async function runFilter(
  jobs: JobListing[],
  prefs: Pick<Preferences, "targetSeason" | "alertBar">,
  deps: FilterDeps
): Promise<AlertFilterResult> {
  const judge = deps.judge ?? judgeJobs;
  let skipped = 0;

  // Companies already applied to are never alerted on again. A failed lookup
  // filters nothing rather than taking the whole stage down.
  let applied = new Set<string>();
  try {
    applied = new Set((await (deps.appliedCompanies ?? loadAppliedCompanies)()).map(companyKey).filter(Boolean));
  } catch (err) {
    console.error("[alert-filter] applied-companies lookup failed — not filtering on it:", err);
  }
  // jobs.url is the only hard gate, but one posting often arrives under several
  // URLs (a repo's short link, a second Workday site, board vs repo), so an
  // earlier job — or one earlier in this batch — with the same company + title
  // counts as already sent. A failed lookup still de-dupes within the batch.
  const seen = new Set<string>();
  try {
    const earlier = await (deps.seenBefore ?? loadSeenBefore)(jobs.map((j) => j.url));
    for (const e of earlier) seen.add(postingKey(e.company, e.title));
  } catch (err) {
    console.error("[alert-filter] seen-before lookup failed — only de-duping within this batch:", err);
  }

  const notApplied: JobListing[] = [];
  for (const job of jobs) {
    const key = postingKey(job.company, job.title);
    if (applied.has(companyKey(job.company))) {
      skipped++;
      console.log(`[alert-filter] applied skip: ${job.title} @ ${job.company}`);
    } else if (seen.has(key)) {
      skipped++;
      console.log(`[alert-filter] duplicate skip: ${job.title} @ ${job.company} (${job.url})`);
    } else {
      seen.add(key);
      notApplied.push(job);
    }
  }

  const inSeason: JobListing[] = [];
  for (const job of notApplied) {
    if (passesSeason(job, prefs.targetSeason)) inSeason.push(job);
    else {
      skipped++;
      console.log(`[alert-filter] season skip: ${job.title} @ ${job.company} (${job.terms?.join(", ") || "title"})`);
    }
  }

  const reasons = new Map<string, string>();
  if (inSeason.length === 0) return { kept: [], reasons, skipped };

  const verdicts = await judge(inSeason, prefs.alertBar ?? "");
  const kept: JobListing[] = [];
  for (const job of inSeason) {
    const v = verdicts.get(job.url) ?? { send: true, reason: "" };
    if (v.send) {
      kept.push(job);
      if (v.reason) reasons.set(job.url, v.reason);
    } else {
      skipped++;
      console.log(`[alert-filter] judge skip: ${job.title} @ ${job.company} — ${v.reason}`);
    }
  }
  return { kept, reasons, skipped };
}
