import { z } from "zod";
import { completeJSON } from "./llm";
import { MasterResume, TailoredResume } from "./types";
import { checkGrounding, GroundingReport } from "./grounding";
import { lintFormat, keywordCoverage, renderMarkdown, FormatReport, KeywordCoverage } from "./format";
import { HIRING_AGENT_RUBRIC } from "./knowledge/best-practices";

/**
 * The critic scores a tailored résumé. It is deliberately NOT a lone LLM number:
 *   - It judges the RENDERED résumé (the artifact a grader sees), never the
 *     tailorer's own reasoning.
 *   - It is anchored to the real hiring-agent rubric, structured + Zod-validated.
 *   - Deterministic signals (grounding, format lint, JD keyword coverage) are
 *     blended in and act as HARD GATES the LLM cannot override — a grounding
 *     failure caps the score no matter how the model scores it.
 */

const BucketScoreSchema = z.object({
  name: z.string(),
  score: z.number(),
  max: z.number(),
  reasons: z.array(z.string()).default([]),
});

export const CritiqueSchema = z.object({
  buckets: z.array(BucketScoreSchema),
  jdMatch: z.object({
    score: z.number(),
    max: z.number().default(100),
    missingKeywords: z.array(z.string()).default([]),
  }),
  /** Holistic 0–100 from the LLM, before deterministic blending. */
  overall: z.number(),
  /** Ordered, actionable fixes. */
  topFixes: z.array(z.string()).default([]),
});
export type Critique = z.infer<typeof CritiqueSchema>;

export type Signals = {
  grounding: GroundingReport;
  format: FormatReport;
  coverage: KeywordCoverage;
};

export type CriticResult = {
  critique: Critique;
  signals: Signals;
  /** Blended, gated 0–100. This is the loop's stopping signal. */
  finalScore: number;
  /** True when grounding failed — the score is hard-capped and the draft is unusable as-is. */
  gated: boolean;
  /** Merged deterministic + LLM fixes, fed back to the tailorer on the next pass. */
  fixes: string[];
};

/** Pure, offline-testable: everything the critic knows without calling the LLM. */
export function gatherSignals(master: MasterResume, tailored: TailoredResume, jd: string): Signals {
  return {
    grounding: checkGrounding(master, tailored),
    format: lintFormat(master, tailored),
    coverage: keywordCoverage(master, tailored, jd),
  };
}

const SYSTEM_PROMPT = `You are a rigorous technical recruiter scoring a software-engineering résumé
against a specific hiring rubric. Be critical and concrete — reward evidence, penalize fluff.

RUBRIC (max points per bucket):
${HIRING_AGENT_RUBRIC.buckets.map((b) => `- ${b.name} (${b.weight}): ${b.rewards}`).join("\n")}
Penalties: ${HIRING_AGENT_RUBRIC.penalties.join(" ")}
Explicitly IGNORE (do not let these affect score): ${HIRING_AGENT_RUBRIC.ignored.join(", ")}.

You are given DETERMINISTIC signals already computed (grounding, formatting, keyword
coverage). Treat them as ground truth; do not contradict them.

Return ONLY JSON:
{
  "buckets": [{ "name": string, "score": number, "max": number, "reasons": string[] }],
  "jdMatch": { "score": number, "max": 100, "missingKeywords": string[] },
  "overall": number,            // 0-100 holistic
  "topFixes": string[]          // concrete, ordered, e.g. "Add a live link to Travel Planner"
}`;

function signalSummary(s: Signals): string {
  return [
    `GROUNDING: ${s.grounding.ok ? "ok" : "FAILED — " + s.grounding.violations.map((v) => v.detail).join("; ")}`,
    `FORMAT: score ${s.format.score}/100; issues: ${s.format.issues.map((i) => `${i.level}:${i.rule}`).join(", ") || "none"}`,
    `KEYWORD COVERAGE: ${(s.coverage.ratio * 100).toFixed(0)}% of JD-relevant skills surfaced; missing: ${s.coverage.missing.join(", ") || "none"}`,
  ].join("\n");
}

export async function evaluate(
  master: MasterResume,
  tailored: TailoredResume,
  jd: string,
  opts: { model?: string } = {}
): Promise<CriticResult> {
  const signals = gatherSignals(master, tailored, jd);

  const critique = await completeJSON(CritiqueSchema, {
    system: SYSTEM_PROMPT,
    model: opts.model,
    temperature: 0.1, // low temp → consistent, repeatable scoring
    user: [
      "=== JOB DESCRIPTION ===",
      jd.trim(),
      "=== DETERMINISTIC SIGNALS (ground truth) ===",
      signalSummary(signals),
      "=== RENDERED RÉSUMÉ (score this) ===",
      renderMarkdown(master, tailored),
    ].join("\n\n"),
  });

  // Merge actionable fixes: deterministic gaps first (they're certain), then the LLM's.
  // Errors always; plus a curated set of warnings the tailorer can act on truthfully.
  const ACTIONABLE_WARNINGS = new Set(["no-metric", "keyword-overuse"]);
  const fixes = [
    ...signals.grounding.violations.map((v) => `Remove fabrication: ${v.detail}`),
    ...signals.coverage.missing.map((k) => `Surface JD-relevant skill you have: ${k}`),
    ...signals.format.issues
      .filter((i) => i.level === "error" || ACTIONABLE_WARNINGS.has(i.rule))
      .map((i) => `Fix ${i.rule}: ${i.detail}`),
    ...critique.topFixes,
  ];

  // Blend, then gate. Grounding failure is disqualifying — cap hard.
  const blended = Math.round(0.6 * critique.overall + 0.25 * signals.format.score + 0.15 * signals.coverage.ratio * 100);
  const gated = !signals.grounding.ok;
  const finalScore = gated ? Math.min(blended, 25) : blended;

  return { critique, signals, finalScore, gated, fixes };
}
