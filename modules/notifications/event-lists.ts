import "server-only";

import { getPrisma } from "@/lib/prisma";

export type EventStaffListSummary = {
  eventId: string;
  eventName: string;
  /** How many addresses the event's staff notification list holds. Never the addresses themselves. */
  addressCount: number;
};

/** The most events the page lists; an administrator with more reaches the rest from the event's own Communications page. */
const MAX_EVENTS = 60;

/**
 * Each active event with the size of its staff notification list, for the
 * Notifications page. The list itself is edited on that event's Communications
 * page; this only shows how many addresses it has, so the page is a map and not
 * a second editor.
 */
export async function listEventStaffListSummaries(): Promise<EventStaffListSummary[]> {
  const events = await getPrisma().event.findMany({
    where: { archivedAt: null },
    orderBy: [{ startsAt: "desc" }, { name: "asc" }],
    take: MAX_EVENTS,
    select: { id: true, name: true, messageSettings: { select: { internalNotificationEmails: true } } },
  });
  return events.map((event) => {
    const list = event.messageSettings?.internalNotificationEmails;
    return {
      eventId: event.id,
      eventName: event.name,
      addressCount: Array.isArray(list) ? list.length : 0,
    };
  });
}
