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
export function appliedAtTimestamp(dateInputValue: string): string {
  const now = new Date();
  const [year, month, day] = dateInputValue.split("-").map(Number);
  if (!year || !month || !day) return now.toISOString();

  const isToday =
    year === now.getFullYear() && month === now.getMonth() + 1 && day === now.getDate();

  return isToday ? now.toISOString() : new Date(year, month - 1, day, 12).toISOString();
}
