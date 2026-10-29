/**
 * The embeddable upcoming-events widget (#107). Pure selection and embed-code helpers; the items themselves always come
 * from `listPublicCalendarItems`, so the widget shows exactly what the public calendar shows.
 */

import { escapeHtmlAttribute } from "@/modules/forms/embed";
import { filterByCategory, firstPerSeries, sortCalendarItems, type CalendarItem } from "@/modules/calendar/domain";
import { filterByGroup, resolveCalendarFilter } from "@/modules/calendar/filter-groups";

export const defaultWidgetLimit = 5;
export const minWidgetLimit = 1;
export const maxWidgetLimit = 12;
const maxCategoryLength = 40;

/** `?limit=` as a whole number from 1 to 12; anything missing or unreadable is 5. */
export function parseWidgetLimit(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\s*-?\d+\s*$/.test(raw)) return defaultWidgetLimit;
  return Math.min(maxWidgetLimit, Math.max(minWidgetLimit, Number(raw)));
}

export type WidgetOptions = {
  /** Today's conference date, YYYY-MM-DD. */
  today: string;
  filter?: string;
  category?: string;
  limit?: number;
};

/** The resolved filter the widget uses and the "View full calendar" link keeps. */
export function resolveWidgetFilter(filter: string | undefined, category: string | undefined) {
  return resolveCalendarFilter(filter, category?.slice(0, maxCategoryLength) || undefined);
}

/**
 * The next items for the widget: in the chosen filter, not yet over, in date order, a repeating series once, at most
 * `limit`. An item already under way (a multi-day event that started yesterday) stays until its last day.
 */
export function selectWidgetItems(items: CalendarItem[], options: WidgetOptions) {
  const { slug, category } = resolveWidgetFilter(options.filter, options.category);
  const limit = Math.min(maxWidgetLimit, Math.max(minWidgetLimit, options.limit ?? defaultWidgetLimit));
  const upcoming = items.filter((item) => item.endsOn >= options.today);
  const filtered = filterByCategory(filterByGroup(upcoming, slug), category);
  return firstPerSeries(sortCalendarItems(filtered)).slice(0, limit);
}

export type CalendarWidgetEmbedInput = {
  origin: string;
  filter?: string;
  category?: string;
  limit?: number;
};

/** The query string for the widget page and its "View full calendar" link's own params (limit excluded there). */
export function widgetQuery(input: { filter?: string; category?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (input.filter) params.set("filter", input.filter);
  if (input.category) params.set("category", input.category.slice(0, maxCategoryLength));
  if (input.limit !== undefined) params.set("limit", String(parseWidgetLimit(String(input.limit))));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function buildCalendarWidgetEmbedCode(input: CalendarWidgetEmbedInput) {
  const origin = new URL(input.origin).origin;
  const embedUrl = new URL(`/embed/calendar${widgetQuery(input)}`, origin).toString();
  const hostScriptUrl = new URL("/embed/embed-host.js", origin).toString();
  return [
    '<iframe class="imsda-embed"',
    `        src="${escapeHtmlAttribute(embedUrl)}"`,
    '        title="IMSDA upcoming events"',
    '        width="100%" height="480" style="border:0;display:block"></iframe>',
    `<script src="${escapeHtmlAttribute(hostScriptUrl)}" async></script>`,
  ].join("\n");
}
