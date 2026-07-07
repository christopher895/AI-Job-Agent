import { tailorResume, TailorOptions } from "./tailor";
import { evaluate, CriticResult } from "./critic";
import { getMasterResume } from "../db/queries";
import { TailoredResume } from "./types";
import { renderMarkdown } from "./format";

/**
 * The generate → critique → revise loop. Each pass tailors, scores with the
 * critic, and feeds the critic's fixes back into the next tailoring pass. Stops
 * when the score clears the target or iterations run out, and always returns the
 * BEST-scoring draft seen (never a regression).
 */

export type GenerateOptions = TailorOptions & {
  /** Max tailoring passes (default 3). */
  maxIterations?: number;
  /** Stop early once a non-gated draft reaches this score (default 80). */
  targetScore?: number;
};

export type GenerateResult = {
  tailored: TailoredResume;
  critic: CriticResult;
  /** ATS-safe rendered résumé for the best draft. */
  markdown: string;
  iterations: number;
  history: { iteration: number; finalScore: number; gated: boolean }[];
};

export async function generateBestResume(jd: string, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const master = opts.master ?? await getMasterResume();
  const maxIterations = opts.maxIterations ?? 3;
  const targetScore = opts.targetScore ?? 80;

  let best: { tailored: TailoredResume; critic: CriticResult } | null = null;
  let feedback: string[] = [];
  const history: GenerateResult["history"] = [];

  for (let i = 1; i <= maxIterations; i++) {
    let tailored: TailoredResume;
    try {
      ({ tailored } = await tailorResume(jd, { ...opts, master, feedback }));
    } catch (err) {
      console.error(`[chain] iteration ${i} tailor step failed:`, err);
      throw err;
    }

    let critic: CriticResult;
    try {
      critic = await evaluate(master, tailored, jd, { model: opts.model });
    } catch (err) {
      console.error(`[chain] iteration ${i} critic step failed:`, err);
      throw err;
    }

    history.push({ iteration: i, finalScore: critic.finalScore, gated: critic.gated });

    if (!best || critic.finalScore > best.critic.finalScore) best = { tailored, critic };

    if (!critic.gated && critic.finalScore >= targetScore) break;
    feedback = critic.fixes; // drive the next revision
  }

  return {
    tailored: best!.tailored,
    critic: best!.critic,
    markdown: renderMarkdown(master, best!.tailored),
    iterations: history.length,
    history,
  };
}
