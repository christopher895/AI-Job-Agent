import { numbers } from "../grounding";
import { CATEGORIES, Finding, GradeReport, SpecialistName, SpecialistResult } from "./rubric";

/**
 * Turns the five specialist results into the stored report. Deterministic and
 * pure — no sixth LLM call — so the score is always the sum of what the UI
 * shows and the ordering is testable.
 */

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const PLACEHOLDER = /\[[^\]\n]+\]/;

/**
 * A rewrite is only "grounded" when every number in it already appears in the
 * resume and it has no [placeholder] left to fill. Same idea as the tailoring
 * flow's labelGroundedness, reusing grounding.ts's number normalisation.
 */
export function labelRewrite(rewrite: string | null, resumeText: string): Finding["groundedness"] {
  if (!rewrite) return "grounded";
  if (PLACEHOLDER.test(rewrite)) return "needs-your-input";
  const known = numbers(resumeText);
  for (const n of numbers(rewrite)) {
    if (!known.has(n)) return "needs-your-input";
  }
  return "grounded";
}

export function assembleReport(
  results: Record<SpecialistName, SpecialistResult>,
  resumeText: string
): GradeReport {
  const categories = CATEGORIES.map((c) => {
    const r = results[c.specialist];
    // Zod already bounds the score; clamp anyway so a schema change can never
    // push the total past 100.
    const score = Math.min(c.max, Math.max(0, Math.round(r.score)));
    return { key: c.key, label: c.label, score, max: c.max, summary: r.summary };
  });

  const ranked = CATEGORIES.flatMap((c, ci) =>
    results[c.specialist].findings.map((f, fi) => ({
      finding: {
        ...f,
        id: `${c.key}-${fi + 1}`,
        category: c.key,
        groundedness: labelRewrite(f.rewrite, resumeText),
      } as Finding,
      order: ci * 1000 + fi,
    }))
  );
  ranked.sort(
    (a, b) => SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] || a.order - b.order
  );

  return {
    score: categories.reduce((sum, c) => sum + c.score, 0),
    categories,
    findings: ranked.map((r) => r.finding),
  };
}
