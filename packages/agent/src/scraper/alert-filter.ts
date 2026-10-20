import { JobListing } from "./types";
import { passesSeason } from "./season";
import { judgeJobs, Verdict } from "../ai/judge-jobs";
import { Preferences } from "../config";

export type AlertFilterResult = {
  kept: JobListing[];
  /** url → the judge's one-line reason, for jobs that were sent. */
  reasons: Map<string, string>;
  /** Season drops + judge skips — shown as a count in the email footer. */
  skipped: number;
};

/**
 * Runs between the upsertJob gate and the alert email in both alert paths:
 * the season rule first (cheap, deterministic), then the AI judge on what's
 * left. Every drop is logged with its reason so the bar can be audited.
 */
type FilterDeps = { judge?: (jobs: JobListing[], bar: string) => Promise<Map<string, Verdict>> };

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

  const inSeason: JobListing[] = [];
  let skipped = 0;
  for (const job of jobs) {
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
