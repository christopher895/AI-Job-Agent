import { appliedAtTimestamp, todayDateInputValue } from "./appliedAt";

function main() {
  // These cases only mean anything west of UTC, where a late-evening local time has
  // already rolled over into tomorrow's UTC date. Run under TZ=America/New_York.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const eveningEt = new Date("2026-08-16T01:30:00Z"); // 9:30pm ET on Aug 15
  const morningEt = new Date("2026-08-15T14:00:00Z"); // 10:00am ET on Aug 15
  const today = todayDateInputValue();

  const results: Record<string, boolean> = {
    runningInEasternTime: tz === "America/New_York",

    // The regression: toISOString() would say "2026-08-16" here — tomorrow — which
    // defaults the picker to the wrong day and dates the row into the future.
    eveningUsesLocalDayNotUtcDay: todayDateInputValue(eveningEt) === "2026-08-15",
    utcDateWouldHaveBeenWrong: eveningEt.toISOString().split("T")[0] === "2026-08-16",
    morningUsesLocalDay: todayDateInputValue(morningEt) === "2026-08-15",

    // An evening application logged against the picker's default is stamped at that
    // moment, so it stays on the local day it belongs to rather than jumping ahead.
    eveningRoundTripsToItsLocalDay: (() => {
      const stamped = appliedAtTimestamp(todayDateInputValue(eveningEt), eveningEt);
      const local = new Date(stamped);
      return local.getFullYear() === 2026 && local.getMonth() === 7 && local.getDate() === 15;
    })(),

    // The bug this whole change exists to prevent: a bare date-input value parses as UTC
    // midnight, so everything logged on one day ties and the log can't sort newest-first.
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
