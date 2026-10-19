import type { EventCount } from "@/modules/system-admin/attention-model";

/** Totals the rows and names the event holding the most. Rows with no event count toward the total only. */
export function eventCountFromGroups(rows: Array<{ eventId: string | null; count: number }>): EventCount {
  let total = 0;
  let top: { eventId: string; count: number } | null = null;
  for (const row of rows) {
    total += row.count;
    if (row.eventId && (!top || row.count > top.count)) top = { eventId: row.eventId, count: row.count };
  }
  return { total, topEventId: top?.eventId ?? null };
}
