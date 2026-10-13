import "server-only";

import { getPrisma } from "@/lib/prisma";
import { calendarDateIn } from "@/modules/calendar/domain";
import { deadlineWindow, sortDeadlineItems, toDeadlineListItem, type DeadlineListItem } from "@/modules/calendar/deadlines";
import { expandOccurrences, parseRepeatRule } from "@/modules/calendar/recurrence";

/**
 * The "Upcoming deadlines" list for the club portal and the Area Coordinator
 * view (#910): published, visible Deadline entries due in the next 90 days,
 * plus those that passed in the last 7 shown as overdue, in date order. Dates
 * are conference-time-zone calendar dates. A cancelled deadline is not listed.
 * Read-only and the same for every viewer: a deadline names no club or person.
 */
export async function listUpcomingDeadlines(now = new Date()): Promise<DeadlineListItem[]> {
  const today = calendarDateIn(now);
  const { from, to } = deadlineWindow(today);
  const entries = await getPrisma().calendarEntry.findMany({
    where: {
      entryType: "DEADLINE",
      isPublished: true,
      isHiddenLocally: false,
      sourceRemovedAt: null,
      status: { not: "CANCELLED" },
      startsOn: { lte: to },
      // A repeating deadline can start long before the window; its occurrences are cut below.
      OR: [{ endsOn: { gte: from } }, { repeatRule: { not: null } }],
    },
    select: { id: true, title: true, startsOn: true, endsOn: true, linkUrl: true, status: true, repeatRule: true, repeatExceptions: true },
    // Soonest first, and bounded: 500 entries is far more than a 97-day window of conference deadlines.
    orderBy: [{ endsOn: "asc" }, { id: "asc" }],
    take: 500,
  });
  const items: DeadlineListItem[] = [];
  for (const entry of entries) {
    const rule = parseRepeatRule(entry.repeatRule);
    for (const occurrence of expandOccurrences(entry, rule, entry.repeatExceptions, from, to)) {
      // The due date is the last day of the item.
      if (occurrence.endsOn < from || occurrence.endsOn > to) continue;
      items.push(toDeadlineListItem({
        key: rule ? `${entry.id}:${occurrence.startsOn}` : entry.id,
        title: entry.title,
        dueOn: occurrence.endsOn,
        linkUrl: entry.linkUrl,
        status: entry.status,
      }, today));
    }
  }
  return sortDeadlineItems(items);
}
