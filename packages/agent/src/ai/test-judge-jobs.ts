import { judgeJobs, JUDGE_BATCH, buildJudgePrompt } from "./judge-jobs";
import { JobListing } from "../scraper/types";

let pass = true;
function check(label: string, cond: boolean, detail?: string) {
  if (!cond) { pass = false; console.error("✗", label, detail ?? ""); } else { console.log("✓", label); }
}

const job = (i: number, extra: Partial<JobListing> = {}): JobListing =>
  ({ title: `SWE Intern ${i}`, company: `Co${i}`, location: "New York, NY", url: `https://x/${i}`, ...extra });
const BAR = "Better than a Wells Fargo software engineering internship in Charlotte, NC";

type Call = { system: string; user: string };

async function main() {
  // Batching + index mapping
  {
    const calls: Call[] = [];
    const jobs = Array.from({ length: 85 }, (_, i) => job(i));
    const verdicts = await judgeJobs(jobs, BAR, {
      complete: (async (_schema: unknown, opts: Call) => {
        calls.push(opts);
        const n = (opts.user.match(/^\d+\./gm) ?? []).length;
        // skip even indexes within each batch, send odd
        return { verdicts: Array.from({ length: n }, (_, i) => ({ index: i, send: i % 2 === 1, reason: `r${i}` })) };
      }) as never,
    });
    check("batches of 40", calls.length === 3 && JUDGE_BATCH === 40, `${calls.length}`);
    check("every job has a verdict", verdicts.size === 85);
    check("index maps within the first batch", verdicts.get("https://x/0")?.send === false && verdicts.get("https://x/1")?.send === true);
    check("index maps within a later batch", verdicts.get("https://x/41")?.send === true && verdicts.get("https://x/41")?.reason === "r1");
    check("system prompt carries the bar", calls[0].system.includes(BAR));
    check("system prompt says send when unsure", /when (you are )?unsure/i.test(calls[0].system));
    check("user message lists title, company, location", calls[0].user.includes("SWE Intern 0") && calls[0].user.includes("Co0") && calls[0].user.includes("New York, NY"));
  }

  // Terms appear for repo listings
  {
    let seen = "";
    await judgeJobs([job(1, { terms: ["Summer 2027"] })], BAR, {
      complete: (async (_s: unknown, o: Call) => { seen = o.user; return { verdicts: [] }; }) as never,
    });
    check("user message includes season tags", seen.includes("Summer 2027"));
  }

  // Missing and out-of-range indexes
  {
    const v = await judgeJobs([job(1), job(2)], BAR, {
      complete: (async () => ({ verdicts: [{ index: 0, send: false, reason: "weak" }, { index: 7, send: false, reason: "bogus" }] })) as never,
    });
    check("judged job keeps its verdict", v.get("https://x/1")?.send === false && v.get("https://x/1")?.reason === "weak");
    check("missing index fails open (send)", v.get("https://x/2")?.send === true && v.get("https://x/2")?.reason === "");
    check("out-of-range index ignored", v.size === 2);
  }

  // Failure → everything sent
  {
    const v = await judgeJobs([job(1), job(2)], BAR, {
      complete: (async () => { throw new Error("claude exited 1"); }) as never,
    });
    check("thrown error fails open", [...v.values()].every((x) => x.send && x.reason === "") && v.size === 2);
  }

  // A failure in one batch doesn't affect another
  {
    let n = 0;
    const jobs = Array.from({ length: 45 }, (_, i) => job(i));
    const v = await judgeJobs(jobs, BAR, {
      complete: (async (_s: unknown, o: Call) => {
        n++;
        if (n === 1) throw new Error("boom");
        const k = (o.user.match(/^\d+\./gm) ?? []).length;
        return { verdicts: Array.from({ length: k }, (_, i) => ({ index: i, send: false, reason: "no" })) };
      }) as never,
    });
    check("failed batch sends, other batch keeps its skips", v.get("https://x/0")?.send === true && v.get("https://x/44")?.send === false);
  }

  // Empty bar → no call
  {
    let called = false;
    const v = await judgeJobs([job(1)], "   ", { complete: (async () => { called = true; return { verdicts: [] }; }) as never });
    check("empty bar skips the judge and sends", !called && v.get("https://x/1")?.send === true);
  }

  // No jobs → no call
  {
    let called = false;
    const v = await judgeJobs([], BAR, { complete: (async () => { called = true; return { verdicts: [] }; }) as never });
    check("no jobs makes no call", !called && v.size === 0);
  }

  // Deadline: once it passes, remaining batches are sent unjudged
  {
    let clock = 0;
    let calls = 0;
    const jobs = Array.from({ length: 90 }, (_, i) => job(i));
    const v = await judgeJobs(jobs, BAR, {
      now: () => clock,
      deadlineMs: 1000,
      complete: (async (_s: unknown, o: Call) => {
        calls++;
        clock += 1500; // first batch alone overruns the deadline
        const k = (o.user.match(/^\d+\./gm) ?? []).length;
        return { verdicts: Array.from({ length: k }, (_, i) => ({ index: i, send: false, reason: "no" })) };
      }) as never,
    });
    check("stops calling after the deadline", calls === 1, String(calls));
    check("judged batch keeps its verdicts", v.get("https://x/0")?.send === false);
    check("unjudged batches are sent", v.get("https://x/40")?.send === true && v.get("https://x/89")?.send === true);
  }

  // Call options: one retry, faster model
  {
    let opts: Record<string, unknown> = {};
    await judgeJobs([job(1)], BAR, { complete: (async (_s: unknown, o: Record<string, unknown>) => { opts = o; return { verdicts: [] }; }) as never });
    check("judge allows a single retry", opts.maxRetries === 1);
    check("judge uses sonnet", opts.model === "sonnet");
  }

  // The prompt follows the bar, not a hardcoded city
  {
    const { system } = buildJudgePrompt([job(1)], "Better than a Capital One SWE internship in New York");
    check("prompt doesn't assume Charlotte when the bar doesn't", !/charlotte/i.test(system));
  }

  // SWE only: quant, research, data science and the like are other roles, not "unsure"
  {
    const { system } = buildJudgePrompt([job(1)], BAR);
    check("prompt restricts to software engineering roles", /only software engineering/i.test(system));
    for (const role of ["quant", "research", "data scien", "product manage"]) {
      check(`prompt names ${role} as a non-SWE role to skip`, system.toLowerCase().includes(role));
    }
  }

  // US only: a posting outside the United States is skip, however good the company
  {
    const { system } = buildJudgePrompt([job(1)], BAR);
    check("prompt requires the United States", /only in the United States/i.test(system));
    check("prompt names a non-US example to skip", /London|Toronto|Canada/.test(system));
  }

  // Location and company trade off: NYC/SF lower the company bar, weaker markets raise it
  {
    const { system } = buildJudgePrompt([job(1)], BAR);
    check("prompt has a lower company bar for NYC and SF", /lower company bar/i.test(system) && /New York/.test(system) && /San Francisco/.test(system));
    check("prompt demands a clearly stronger company in weaker locations", /clearly stronger company/i.test(system));
  }

  console.log(pass ? "\n✓ judge-jobs test PASSED" : "\n✗ judge-jobs test FAILED");
  process.exit(pass ? 0 : 1);
}
main();
