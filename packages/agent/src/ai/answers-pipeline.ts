import { generateAnswers } from "./generate-answers";
import { LLM_PROVIDER } from "./llm";
import { registerRun, clearRun, isCancelledError, CancelledError } from "./cancellation";
import {
  answersRunId,
  completeApplicationAnswers,
  failApplicationAnswers,
  getMasterResume,
} from "../db/queries";

export async function runAnswersPipeline(
  id: string,
  pasted: string,
  row: { jd_text: string | null; company: string | null; job_title: string | null }
) {
  const runId = answersRunId(id);
  const signal = registerRun(runId);
  try {
    const master = await getMasterResume();
    const items = await generateAnswers({
      pasted,
      jd: row.jd_text ?? "",
      company: row.company,
      jobTitle: row.job_title,
      master,
      signal,
    });
    if (signal.aborted) throw new CancelledError();
    await completeApplicationAnswers(id, {
      status: "ready",
      prompt: pasted,
      items,
      error: null,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    if (isCancelledError(err) || signal.aborted) {
      console.log(`[resume] generate-answers cancelled for ${id}`);
      await failApplicationAnswers(id, "Generation was cancelled.");
      return;
    }
    console.error("[resume] generate-answers pipeline error:", err);
    const credentialHint =
      LLM_PROVIDER === "openai" ? "check OPENAI_API_KEY" : "check CLAUDE_CODE_OAUTH_TOKEN";
    await failApplicationAnswers(id, `Drafting answers failed — ${credentialHint} and try again.`);
  } finally {
    clearRun(runId);
  }
}
