/**
 * Public calendar URLs (#1249), shared by the Month, Upcoming and Year views (#1250): one place builds a calendar link
 * and reads the view and filter params, so every view keeps the same shareable query.
 */

import { defaultCalendarFilter } from "@/modules/calendar/filter-groups";

export type CalendarHrefParams = { view?: string; month?: string; year?: string; filter?: string; category?: string; date?: string };

/** The views the page knows. Month is the default and never appears in the URL. */
export const calendarViews = ["month", "list", "year"] as const;
export type CalendarView = (typeof calendarViews)[number];

/** `?view=` to a known view; anything else is Month. */
export function parseCalendarView(value: string | undefined): CalendarView {
  return (calendarViews as readonly string[]).includes(value ?? "") && value !== "month" ? (value as CalendarView) : "month";
}

/** `?filter=` is left out for the default group, so the plain /calendar link is Main events. `category` only carries an old link's unmatched name. */
export function calendarHref(params: CalendarHrefParams, hash?: string) {
  const search = new URLSearchParams();
  if (params.view && params.view !== "month") search.set("view", params.view);
  if (params.month) search.set("month", params.month);
  if (params.year) search.set("year", params.year);
  if (params.filter && params.filter !== defaultCalendarFilter) search.set("filter", params.filter);
  if (params.category) search.set("category", params.category);
  if (params.date) search.set("date", params.date);
  const query = search.toString();
  return `${query ? `/calendar?${query}` : "/calendar"}${hash ? `#${hash}` : ""}`;
}
