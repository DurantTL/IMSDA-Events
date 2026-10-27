import type { CalendarItem } from "@/modules/calendar/domain";
import { eventSlugFromHref } from "@/modules/events/view-transition";

/**
 * Featured events (#1218): the pure rules. Staff pin an event to the top of the homepage and the calendar's list view.
 * The query (`featured.ts`) only reads published, calendar-visible, non-archived events; these rules decide which of
 * those are still featured today and in what order, so an event drops out on its own and nobody has to unpin it.
 */

/** The homepage shows at most this many featured events. */
export const homeFeaturedLimit = 3;

export type FeaturedEventRow = {
  slug: string;
  featuredOrder: number | null;
  /** The last day it is featured (YYYY-MM-DD); empty means the event's start date. */
  featureUntil: string | null;
  /** The event's first day (YYYY-MM-DD), in its own time zone. */
  startsOn: string;
};

/** The last day an event is featured: the chosen date, else the day the event starts. */
export function featuredLastDay(row: Pick<FeaturedEventRow, "featureUntil" | "startsOn">) {
  return row.featureUntil || row.startsOn;
}

/** Featured through the last day, inclusive; `today` is a conference-calendar date. */
export function isFeaturedOn(row: Pick<FeaturedEventRow, "featureUntil" | "startsOn">, today: string) {
  return today <= featuredLastDay(row);
}

/** Order 1 first; events without an order after those with one; ties by earlier start, then slug (stable). */
export function sortFeaturedRows<T extends FeaturedEventRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const orderA = a.featuredOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.featuredOrder ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB || a.startsOn.localeCompare(b.startsOn) || a.slug.localeCompare(b.slug);
  });
}

/** The rows still featured today, in order, cut to `limit` when given. */
export function activeFeaturedRows<T extends FeaturedEventRow>(rows: readonly T[], today: string, limit?: number): T[] {
  const active = sortFeaturedRows(rows.filter((row) => isFeaturedOn(row, today)));
  return limit === undefined ? active : active.slice(0, limit);
}

/**
 * The calendar items for featured events, in featured order. Each is the event's own item from the public calendar, so
 * its status line comes from the same helper as every other list (#1201) and cannot disagree with the event page. An
 * event with no item in the window (or one the calendar left out) simply has no featured card.
 */
export function featuredItemsFor(items: readonly CalendarItem[], rows: readonly FeaturedEventRow[]): CalendarItem[] {
  const result: CalendarItem[] = [];
  for (const row of rows) {
    const item = items.find((candidate) => candidate.kind === "EVENT" && eventSlugFromHref(candidate.href) === row.slug);
    if (item) result.push(item);
  }
  return result;
}

/** Items that are not already shown as featured, so a card never appears twice on a page. */
export function withoutFeatured<T extends { key: string }>(items: readonly T[], featured: readonly { key: string }[]): T[] {
  const taken = new Set(featured.map((item) => item.key));
  return items.filter((item) => !taken.has(item.key));
}
