// Forward-only ladder for the "in progress" states. rejected/no_response are
// terminal outcomes accepted from any state; offer sits at the top of the ladder.
const RANK: Record<string, number> = { applied: 0, assessment: 1, interviewing: 2, offer: 3 };

export function canAdvance(current: string | null, next: string): boolean {
  if (next === current) return false;
  // Terminal outcomes can be entered from any state but never left.
  if (current === "rejected" || current === "no_response") return false;
  if (next === "rejected" || next === "no_response") return true;
  const c = current == null ? -1 : (RANK[current] ?? -1);
  const n = RANK[next] ?? -1;
  return n > c;
}
