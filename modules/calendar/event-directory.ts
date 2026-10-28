import type { CalendarItem } from "@/modules/calendar/domain";
import { parseOpenRegistrationFilter, type OpenRegistrationFilter } from "@/modules/calendar/open-registration";

/**
 * Search and filters for the public events list (#106): text, date range, category, location and audience, all read
 * from the URL so a filtered list can be shared. Pure and server-side; it only narrows items the public calendar
 * already returned, so it never widens what a visitor can see.
 */

export type EventDirectoryFilters = {
  q: string;
  from: string;
  to: string;
  category: string;
  location: string;
  audience: OpenRegistrationFilter;
};

type Param = string | string[] | undefined;
export type EventDirectorySearchParams = Record<string, Param>;

export const eventDirectoryQueryMaxLength = 100;

const firstValue = (value: Param) => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

/** A real calendar date written YYYY-MM-DD, or "". */
function parseDate(value: Param) {
  const text = firstValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : "";
}

export function parseEventDirectoryFilters(params: EventDirectorySearchParams): EventDirectoryFilters {
  let from = parseDate(params.from);
  let to = parseDate(params.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    q: firstValue(params.q).slice(0, eventDirectoryQueryMaxLength).trim(),
    from,
    to,
    category: firstValue(params.category),
    location: firstValue(params.location),
    audience: parseOpenRegistrationFilter(params.for),
  };
}

/** Whether any filter other than the audience chips is set (the audience has its own chips). */
export function hasActiveDirectoryFilters(filters: EventDirectoryFilters) {
  return !!(filters.q || filters.from || filters.to || filters.category || filters.location);
}

const eventStart = (item: CalendarItem) => item.eventStartsOn ?? item.startsOn;
const eventEnd = (item: CalendarItem) => item.eventEndsOn ?? item.endsOn;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function applyEventDirectoryFilters(items: CalendarItem[], filters: EventDirectoryFilters): CalendarItem[] {
  const words = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (words.length) {
      const haystack = [item.title, item.eventTitle, item.description, item.location, item.category].join(" ").toLowerCase();
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    if (filters.from && eventEnd(item) < filters.from) return false;
    if (filters.to && eventStart(item) > filters.to) return false;
    if (filters.category && !same(item.category, filters.category)) return false;
    if (filters.location && !same(item.location, filters.location)) return false;
    return true;
  });
}

function distinct(values: string[], selected: string) {
  const byKey = new Map<string, string>();
  for (const value of [...values, selected]) {
    const text = value.trim();
    if (text && !byKey.has(text.toLowerCase())) byKey.set(text.toLowerCase(), text);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** Choices for the Category and Location selects: what the open events have, plus the value already chosen. */
export function eventDirectoryOptions(items: CalendarItem[], filters: Pick<EventDirectoryFilters, "category" | "location">) {
  return {
    categories: distinct(items.map((item) => item.category), filters.category),
    locations: distinct(items.map((item) => item.location), filters.location),
  };
}

/** A short, shareable `/events` link: empty filters and the default `for=all` are left out. */
export function eventDirectoryHref(filters: Partial<EventDirectoryFilters>) {
  const query = new URLSearchParams();
  if (filters.audience && filters.audience !== "all") query.set("for", filters.audience);
  for (const key of ["q", "from", "to", "category", "location"] as const) {
    const value = filters[key]?.trim();
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return text ? `/events?${text}` : "/events";
}
