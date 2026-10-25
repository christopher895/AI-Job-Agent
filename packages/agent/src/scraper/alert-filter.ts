import { JobListing } from "./types";
import { passesSeason } from "./season";
import { judgeJobs, Verdict } from "../ai/judge-jobs";
import { Preferences } from "../config";

export type AlertFilterResult = {
  kept: JobListing[];
  /** url → the judge's one-line reason, for jobs that were sent. */
  reasons: Map<string, string>;
  /** Applied-company drops + season drops + judge skips — shown as a count in the email footer. */
  skipped: number;
};

/**
 * Runs between the upsertJob gate and the alert email in both alert paths:
 * companies already applied to are dropped, then the season rule (cheap,
 * deterministic), then the AI judge on what's left. Every drop is logged with its reason so the bar can be audited.
 */
type FilterDeps = {
  judge?: (jobs: JobListing[], bar: string) => Promise<Map<string, Verdict>>;
  /** Company names from the application log (`applied_jobs.company`). */
  appliedCompanies?: () => Promise<string[]>;
};

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
  const notApplied: JobListing[] = [];
  for (const job of jobs) {
    if (!applied.has(companyKey(job.company))) notApplied.push(job);
    else {
      skipped++;
      console.log(`[alert-filter] applied skip: ${job.title} @ ${job.company}`);
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
