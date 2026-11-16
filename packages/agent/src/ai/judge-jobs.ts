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
    "You screen new internship postings for Christopher, a computer science student at Brown looking ONLY for a Summer 2027 software engineering internship.",
    "Role first: he wants only software engineering roles — software engineer/developer, SWE/SDE, backend, frontend, full-stack, mobile, infrastructure, platform, and ML/AI engineering roles that build software. Every other role is skip, however prestigious the company: quant/quantitative strategist/strats/trading, research scientist or research internships (including PhD), data science and data analyst, product manager, business/finance analyst, hardware, mechanical, electrical, design, sales, operations, marketing.",
    "Hardware-adjacent roles are skip too, even when the title says \"software\": firmware, embedded software/systems, FPGA, ASIC, silicon/chip design, RTL, hardware or silicon verification/validation, device drivers, board bring-up, hardware test, and roles at semiconductor companies whose work is building or testing chips. Compilers, robotics/autonomy software and backend or ML software at a hardware company still count as software engineering.",
    `His bar: "${bar.trim()}".`,
    "Location: he wants roles only in the United States. A posting located outside the US (e.g. London, Toronto, Canada, India, Europe), or remote only outside the US, is skip however strong the company. A posting listing several locations passes if any is in the US; a missing location counts as unsure.",
    "The bar is HIGH. He already has the offer the bar describes, so a posting is worth his time only if it beats that offer. He applies to few of the alerts he gets; when in doubt about the company, skip.",
    "Pay: estimate the company's typical software engineering intern hourly pay for that city from what you know (Levels.fyi-style figures). If the bar names a pay figure, pay and company trade off against it:",
    "- Pays at or above the bar's figure: the company must be at least comparable to the bar's — an established, reputable company or a well-funded startup with a strong name, not an obscure one.",
    "- Pays less than the bar's figure (or you have no pay data for it): the company must be a clearly stronger company than the bar's — Big Tech, a top AI lab, a well-known tech company or a top startup whose name is worth the pay cut. Anything less is skip.",
    "Banks' and insurers' technology programs, consulting firms, non-tech Fortune 500 companies and government contractors are at most comparable to a big-bank offer, so send them only when they are known to pay at or above the bar's figure.",
    "Location: the United States hubs (New York City, the San Francisco Bay Area incl. San Jose/Palo Alto/Mountain View, Seattle, Boston, Los Angeles, Austin, Chicago, Washington DC) and remote in the US follow the pay/company rule above. Weaker locations (smaller markets, including the bar's own city if it is one) need both: pay at or above the bar's figure AND a clearly stronger company — Big Tech, a top AI lab, a top trading firm.",
    "send = true only when a software engineering posting clears the pay/company and location rules above. A generic title at a company that clears the bar (e.g. \"Technology Intern\" at a top trading firm) may well be software engineering, so send it; a missing location at such a company also counts as send.",
    "send = false when the role is not software engineering (see above), when it is outside the United States, when it pays less than the bar's figure and the company is not clearly stronger, when it pays more but the company is weaker than the bar's, when you do not recognize the company, not an internship, or clearly not for summer.",
    "reason: at most 12 words, concrete, naming the pay estimate when it decided (e.g. \"Top AI lab, SF, ~$60/hr\" or \"Regional bank, ~$35/hr, not stronger\").",
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
