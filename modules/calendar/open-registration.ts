import type { CalendarItem } from "@/modules/calendar/domain";

/**
 * The "Open for registration" list (#1217): the public calendar's own items, narrowed to events people can still
 * register for or will soon. Pure, so it needs no database. The calendar query already leaves out drafts, private
 * (unpublished or hidden) and archived events; this only decides which of those items count as "open or opening".
 */

export const openRegistrationFilters = ["all", "clubs", "everyone"] as const;
export type OpenRegistrationFilter = (typeof openRegistrationFilters)[number];

/** How far ahead the list looks: about 18 months. */
export const openRegistrationWindowDays = 548;

/** Statuses that belong on the list: dates open (open, waitlist, full), or opening later. Closed and draft never do. */
const listedStatuses = new Set(["OPEN", "WAITLIST", "FULL", "OPENING_SOON", "UPCOMING"]);

/** An unknown or missing `?for=` value is All. */
export function parseOpenRegistrationFilter(value: string | string[] | undefined): OpenRegistrationFilter {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "clubs" || first === "everyone" ? first : "all";
}

export function openRegistrationHref(filter: OpenRegistrationFilter) {
  return filter === "all" ? "/events" : `/events?for=${filter}`;
}

export function selectOpenRegistrationItems(items: CalendarItem[], filter: OpenRegistrationFilter = "all"): CalendarItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => item.kind === "EVENT"
      && !item.isClosure
      && item.status !== "CANCELLED"
      && !!item.href
      && !!item.registrationStatus
      && listedStatuses.has(item.registrationStatus))
    // Several linked items can point at one event (#1086): keep the earliest.
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.endsOn.localeCompare(b.endsOn) || a.title.localeCompare(b.title))
    .filter((item) => {
      if (seen.has(item.href!)) return false;
      seen.add(item.href!);
      return true;
    })
    .filter((item) => (filter === "clubs" ? item.clubEvent === true : filter === "everyone" ? item.clubEvent !== true : true));
}
