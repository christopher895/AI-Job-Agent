import { FILTERS } from "../config";

export function matchesFilters(title: string): boolean {
  const lower = title.toLowerCase();

  // All requiredKeywords must appear as whole words
  if (FILTERS.requiredKeywords.some((kw) => !new RegExp(`\\b${kw}\\b`, "i").test(title))) return false;

  // termFilter must appear if set
  if (FILTERS.termFilter && !lower.includes(FILTERS.termFilter.toLowerCase())) return false;

  // At least one titleKeyword must appear
  return FILTERS.titleKeywords.some((kw) => lower.includes(kw.toLowerCase()));
}
