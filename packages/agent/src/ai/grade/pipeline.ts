import { clearRun, registerRun } from "../cancellation";
import { LLM_PROVIDER } from "../llm";
import { assembleReport } from "./assemble";
import { Limiter, graderLimit } from "./limit";
import { SPECIALISTS, SPECIALIST_LABELS, SpecialistName, SpecialistResult } from "./rubric";
import { runSpecialist } from "./specialists";
import type { GradeRow } from "../../db/queries";
import type { GradeReport, SpecialistState } from "./rubric";

export type PipelineDeps = {
  getGrade: (id: string) => Promise<GradeRow | null>;
  setGradeSpecialist: (id: string, name: SpecialistName, state: SpecialistState) => Promise<void>;
  completeGrade: (id: string, report: GradeReport) => Promise<boolean>;
  failGrade: (id: string, message: string) => Promise<boolean>;
  runSpecialist: typeof runSpecialist;
  limiter: Limiter;
};

// Imported lazily so the fast test can inject fakes without opening a DB pool.
async function defaultDeps(): Promise<PipelineDeps> {
  const q = await import("../../db/queries");
  return {
    getGrade: q.getGrade,
    setGradeSpecialist: q.setGradeSpecialist,
    completeGrade: q.completeGrade,
    failGrade: q.failGrade,
    runSpecialist,
    limiter: graderLimit,
  };
}

/**
 * Background grade run, started by POST /api/grades after the 202.
 * Five specialists run through the shared limiter; each result is written as
 * it lands so the pending screen ticks off. One failure aborts the rest and
 * fails the whole grade — a score missing a category would mislead.
 */
export async function runGradePipeline(id: string, injected?: PipelineDeps): Promise<void> {
  const deps = injected ?? (await defaultDeps());
  const runKey = `grade:${id}`;
  const signal = registerRun(runKey);
  // `local` also fires when a sibling fails; `signal` only on a user cancel,
  // which is how the catch below tells the two apart.
  const local = new AbortController();
  const forwardAbort = () => local.abort();
  signal.addEventListener("abort", forwardAbort, { once: true });
  // An object, not a `let`: TS narrows a `let` assigned only inside a callback
  // to `null` in the catch below, which makes the failure branch type `never`.
  const failure: { name: SpecialistName | null; cause: unknown } = { name: null, cause: null };

  try {
    const row = await deps.getGrade(id);
    if (!row || row.status !== "pending") return;
    const input = { resumeText: row.resume_text, targetRole: row.target_role, level: row.level, jdText: row.jd_text };

    const entries = await Promise.all(
      SPECIALISTS.map(async (name) => {
        try {
          const result = await deps.limiter.run(() => deps.runSpecialist(name, input, local.signal), local.signal);
          await deps.setGradeSpecialist(id, name, { status: "done", result });
          return [name, result] as const;
        } catch (err) {
          if (!local.signal.aborted) {
            failure.name = name;
            failure.cause = err;
            local.abort();
            await deps.setGradeSpecialist(id, name, { status: "failed" }).catch(() => {});
          }
          throw err;
        }
      })
    );

    const results = Object.fromEntries(entries) as Record<SpecialistName, SpecialistResult>;
    await deps.completeGrade(id, assembleReport(results, row.resume_text));
  } catch (err) {
    // POST /api/grades/:id/cancel already wrote 'cancelled'.
    if (signal.aborted) {
      console.log(`[grade] ${id} cancelled`);
      return;
    }
    console.error(`[grade] ${id} failed:`, err);
    // The error Promise.all surfaces may be a sibling's abort, so report the
    // failing reviewer's own error. Credentials are only one possible cause —
    // an invalid reply after every retry is likelier — so they're a fallback hint.
    const hint = LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    const describe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
    const message = failure.name
      ? `The ${SPECIALIST_LABELS[failure.name]} reviewer failed: ${describe(failure.cause)}. Re-run to try again; if it keeps failing, ${hint}.`
      : `Grading failed: ${describe(err)}. Re-run to try again.`;
    await deps.failGrade(id, message).catch((e) => console.error(`[grade] ${id} could not record failure:`, e));
  } finally {
    signal.removeEventListener("abort", forwardAbort);
    clearRun(runKey);
  }
}
