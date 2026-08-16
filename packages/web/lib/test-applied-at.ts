import { appliedAtTimestamp } from "./appliedAt";

function dateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function main() {
  const today = dateInputValue(new Date());

  const results: Record<string, boolean> = {
    // The bug this exists to prevent: a bare date-input value parses as UTC midnight, so
    // everything logged on one day is an exact tie and the log can't sort newest-first.
    todayIsNotUtcMidnight: !appliedAtTimestamp(today).endsWith("T00:00:00.000Z"),

    todayIsDistinctPerCall: (() => {
      const a = appliedAtTimestamp(today);
      // Busy-wait past the millisecond boundary so the two calls can't share a timestamp.
      const start = Date.now();
      while (Date.now() === start) { /* spin */ }
      return appliedAtTimestamp(today) > a;
    })(),

    todayIsRoughlyNow: (() => {
      const parsed = new Date(appliedAtTimestamp(today)).getTime();
      return Math.abs(parsed - Date.now()) < 5_000;
    })(),

    // A backdated pick keeps its calendar day rather than sliding to the day before.
    backdatedKeepsItsLocalDay: (() => {
      const parsed = new Date(appliedAtTimestamp("2026-03-09"));
      return (
        parsed.getFullYear() === 2026 && parsed.getMonth() === 2 && parsed.getDate() === 9
      );
    })(),

    // Midday, so the instant lands on the intended day in every timezone, not just this one.
    backdatedIsMidday: new Date(appliedAtTimestamp("2026-03-09")).getHours() === 12,

    backdatedIsStableAcrossCalls:
      appliedAtTimestamp("2026-03-09") === appliedAtTimestamp("2026-03-09"),

    // Ordering: an older application must sort before a newer one as plain ISO strings,
    // which is how Postgres will compare the stored timestamps.
    olderSortsBeforeNewer:
      appliedAtTimestamp("2026-03-09") < appliedAtTimestamp("2026-03-10"),

    malformedFallsBackToNow: (() => {
      const parsed = new Date(appliedAtTimestamp("")).getTime();
      return !Number.isNaN(parsed) && Math.abs(parsed - Date.now()) < 5_000;
    })(),
  };

  const pass = Object.values(results).every(Boolean);
  console.log(Object.entries(results).map(([k, v]) => `${k}:${v}`).join(" "));
  console.log(pass ? "\n✓ appliedAt timestamp test PASSED" : "\n✗ appliedAt timestamp test FAILED");
  process.exit(pass ? 0 : 1);
}

main();
