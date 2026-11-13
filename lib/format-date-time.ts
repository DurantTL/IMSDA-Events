/** A stored instant as "Jun 1, 2026, 3:05 PM CDT" in the given time zone; "Not recorded" when empty, the raw text when unreadable. */
export function dateTimeInZone(value: string | null, timeZone: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(date);
}
