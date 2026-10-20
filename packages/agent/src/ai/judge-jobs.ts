import { z } from "zod";
import { completeJSON } from "./llm";
import { JobListing } from "../scraper/types";

/**
 * The AI half of the alert filter (docs/superpowers/specs/2026-10-18-smart-
 * alerts-design.md): decides which new postings clear Christopher's bar.
 * Fail-open by design — a broken judge must never hide jobs, so a thrown
 * call or a job the model skipped over is always sent.
 */

export const JUDGE_BATCH = 40;

/**
 * Past this, remaining batches are sent unjudged. The judge runs inside the
 * 15-min scrape tick and the scheduler skips ticks while one is in flight, so
 * a slow model must cost at most a few minutes of alert latency, not an hour.
 */
export const JUDGE_DEADLINE_MS = 5 * 60 * 1000;

export type Verdict = { send: boolean; reason: string };

const VerdictsSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int(),
      send: z.boolean(),
      reason: z.string(),
    })
  ),
});

type CompleteFn = typeof completeJSON;

export function buildJudgePrompt(jobs: JobListing[], bar: string): { system: string; user: string } {
  const system = [
    "You screen new internship postings for Christopher, a computer science student at Brown looking for a Summer 2027 software engineering or AI/ML internship.",
    `His bar: "${bar.trim()}".`,
    "For each posting decide whether it clears that bar. Weigh the company (engineering reputation, AI relevance, brand), the role, and the location.",
    "Judge location against the bar's own location: major tech hubs (New York City, the San Francisco Bay Area, Seattle, Boston, Los Angeles) and remote generally beat smaller markets.",
    "send = true when the posting is better than or comparable to the bar, or when you are unsure.",
    "send = false ONLY when it is clearly worse: e.g. a little-known company in a weaker location than the bar, a non-software role (hardware, mechanical, electrical, sales, operations, marketing), not an internship, or clearly not for summer.",
    "reason: at most 12 words, concrete (e.g. \"Top AI lab, San Francisco\" or \"Hardware role, not software\").",
    "Return ONLY JSON: {\"verdicts\": [{\"index\": number, \"send\": boolean, \"reason\": string}]} with one entry per posting, using the posting's index.",
  ].join("\n");

  const user = jobs
    .map((j, i) => {
      const terms = j.terms?.length ? ` | ${j.terms.join(", ")}` : "";
      return `${i}. ${j.title} | ${j.company} | ${j.location || "location not listed"}${terms}`;
    })
    .join("\n");

  return { system, user };
}

export async function judgeJobs(
  jobs: JobListing[],
  bar: string,
  deps: { complete?: CompleteFn; now?: () => number; deadlineMs?: number } = {}
): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  const sendAll = (batch: JobListing[]) => batch.forEach((j) => out.set(j.url, { send: true, reason: "" }));

  if (!bar.trim()) {
    sendAll(jobs);
    return out;
  }
  const complete = deps.complete ?? completeJSON;
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.deadlineMs ?? JUDGE_DEADLINE_MS);

  // Sequential on purpose: one `claude` subprocess at a time keeps the
  // scraper tick inside Railway's memory budget.
  for (let start = 0; start < jobs.length; start += JUDGE_BATCH) {
    const batch = jobs.slice(start, start + JUDGE_BATCH);
    if (now() >= deadline) {
      console.warn(`[judge] past the ${Math.round((deps.deadlineMs ?? JUDGE_DEADLINE_MS) / 1000)}s deadline — sending ${jobs.length - start} job(s) unjudged`);
      sendAll(jobs.slice(start));
      break;
    }
    try {
      const { system, user } = buildJudgePrompt(batch, bar);
      // Sonnet, one retry: a 40-row classification doesn't need opus, and
      // every attempt can take up to the CLI's 240s timeout.
      const { verdicts } = await complete(VerdictsSchema, { system, user, temperature: 0, model: "sonnet", maxRetries: 1 });
      for (const v of verdicts) {
        const job = batch[v.index];
        if (job) out.set(job.url, { send: v.send, reason: v.reason.trim() });
      }
    } catch (err) {
      console.error(`[judge] batch of ${batch.length} failed — sending all of it unjudged:`, err instanceof Error ? err.message : err);
    }
    for (const j of batch) if (!out.has(j.url)) out.set(j.url, { send: true, reason: "" });
  }
  return out;
}
