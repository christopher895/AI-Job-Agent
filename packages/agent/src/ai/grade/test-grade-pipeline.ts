import { runGradePipeline, PipelineDeps } from "./pipeline";
import { createLimiter } from "./limit";
import { abortRun } from "../cancellation";
import { SpecialistName, SpecialistResult, SpecialistState, categoryFor } from "./rubric";
import type { GradeRow } from "../../db/queries";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

function fakeRow(id: string): GradeRow {
  return {
    id, source: "master", resume_id: null, label: "Master resume", resume_text: "Did 40% better",
    target_role: "ml", level: "intern", jd_text: null, status: "pending", specialists: {},
    score: null, report: null, error: null, created_at: new Date(), updated_at: new Date(),
  };
}

function harness(run: PipelineDeps["runSpecialist"]) {
  const writes: { specialists: Record<string, SpecialistState>; completed: unknown; failed: string | null } =
    { specialists: {}, completed: null, failed: null };
  const deps: PipelineDeps = {
    getGrade: async (id) => fakeRow(id),
    setGradeSpecialist: async (_id, name, state) => { writes.specialists[name] = state; },
    completeGrade: async (_id, report) => { writes.completed = report; return true; },
    failGrade: async (_id, msg) => { writes.failed = msg; return true; },
    runSpecialist: run,
    limiter: createLimiter(2),
  };
  return { deps, writes };
}

const okResult = (name: SpecialistName): SpecialistResult =>
  ({ score: categoryFor(name).max - 1, summary: `${name} ok`, findings: [] });

async function main() {
  // Happy path
  {
    const { deps, writes } = harness(async (name) => okResult(name));
    await runGradePipeline("11111111-1111-1111-1111-111111111111", deps);
    check("all five specialists recorded done",
      Object.values(writes.specialists).filter((s) => s.status === "done").length === 5);
    check("report completed with score 95", (writes.completed as { score: number } | null)?.score === 95);
    check("nothing marked failed", writes.failed === null);
  }

  // One specialist fails → whole grade fails, siblings aborted, error names it
  {
    let sawAbort = false;
    const { deps, writes } = harness(async (name, _input, signal) => {
      // recruiter is first in SPECIALISTS, so it holds a slot: it fails while ats is
      // running and content/domain/storyteller are still queued in the limiter.
      if (name === "recruiter") throw new Error("schema mismatch");
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 200);
        signal?.addEventListener("abort", () => { clearTimeout(t); sawAbort = true; reject(new Error("aborted")); });
      });
      return okResult(name);
    });
    await runGradePipeline("22222222-2222-2222-2222-222222222222", deps);
    check("grade marked failed", writes.failed !== null);
    check("failure message names the Recruiter reviewer", (writes.failed ?? "").includes("Recruiter"));
    check("failure message carries the real cause", (writes.failed ?? "").includes("schema mismatch"));
    check("no report written", writes.completed === null);
    check("siblings were aborted", sawAbort);
    check("failing specialist recorded failed", writes.specialists.recruiter?.status === "failed");
    check("queued specialists never recorded done",
      !["content", "domain", "storyteller"].some((n) => writes.specialists[n]?.status === "done"));
  }

  // User cancel → neither failed nor completed is written
  {
    const id = "33333333-3333-3333-3333-333333333333";
    const { deps, writes } = harness((_name, _input, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("killed")));
      })
    );
    const run = runGradePipeline(id, deps);
    await new Promise((r) => setTimeout(r, 20));
    abortRun(`grade:${id}`);
    await run;
    check("cancel writes no failure", writes.failed === null);
    check("cancel writes no report", writes.completed === null);
  }

  // A grade that is no longer pending is left alone
  {
    let called = false;
    const { deps, writes } = harness(async (name) => { called = true; return okResult(name); });
    deps.getGrade = async (id) => ({ ...fakeRow(id), status: "cancelled" });
    await runGradePipeline("44444444-4444-4444-4444-444444444444", deps);
    check("non-pending grade runs no specialists", !called && writes.completed === null);
  }

  console.log(pass ? "\n✓ grade-pipeline test PASSED" : "\n✗ grade-pipeline test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
