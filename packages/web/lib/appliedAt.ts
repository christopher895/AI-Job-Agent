/**
 * Today's date as an `<input type="date">` value, in the *viewer's* timezone.
 *
 * `new Date().toISOString().split("T")[0]` looks equivalent and isn't: it yields the UTC
 * date, which is already tomorrow for an evening application anywhere west of UTC. That
 * defaults the date picker to the wrong day and lands the row a day in the future.
 */
export function todayDateInputValue(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Turns an `<input type="date">` value ("2026-08-16") into a real instant to log against.
 *
 * The raw value can't be sent as-is: it parses as UTC midnight, so every application
 * logged on one day gets a byte-identical applied_at and the log has no way to sort the
 * most recent to the top. Today — the overwhelmingly common case, since you log an
 * application right after sending it — becomes the current moment, so same-day entries
 * order by when they were actually logged. A backdated pick becomes local midday, which
 * falls on the intended calendar day in every timezone.
 */
export function appliedAtTimestamp(dateInputValue: string, now: Date = new Date()): string {
  const [year, month, day] = dateInputValue.split("-").map(Number);
  if (!year || !month || !day) return now.toISOString();

  const isToday =
    year === now.getFullYear() && month === now.getMonth() + 1 && day === now.getDate();

  return isToday ? now.toISOString() : new Date(year, month - 1, day, 12).toISOString();
}
