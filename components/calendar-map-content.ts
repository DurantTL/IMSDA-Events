import type { CalendarItem } from "@/modules/calendar/domain";

/**
 * Pure helpers for the public calendar map (#1212), kept apart from the Leaflet
 * component so they can be tested without a browser.
 *
 * Site and event names are free text typed by staff, and Leaflet writes any
 * *string* it is handed for a popup, tooltip or icon straight into `innerHTML`.
 * So the map never hands Leaflet a string: the popup is built here as DOM nodes
 * whose text is set with `textContent`, which the browser never parses as markup.
 */

/** One upcoming event on the map: plain data the server page sends to the browser. */
export type CalendarMapEvent = {
  title: string;
  href: string;
  startsOn: string;
  endsOn: string;
  /** The event's own date range, worded for display (e.g. "Jun 12 – 14, 2027"). */
  dateLabel: string;
};

export type CalendarMapGroup = {
  /** The host site's id: one pin per site. */
  key: string;
  siteName: string;
  latitude: number;
  longitude: number;
  /** The site's upcoming events, soonest first. */
  events: CalendarMapEvent[];
};

export type CalendarMapData = {
  groups: CalendarMapGroup[];
  /** Upcoming events (each counted once) with a pin. */
  mappedEvents: number;
  /** Upcoming events (each counted once) with no pin. */
  unmappedEvents: number;
};

/**
 * Lays the shown calendar items out for the map. Only events count: calendar
 * entries never get a pin, and an event without a mapped site is only counted
 * as "not on the map". An event shown as several items (#1086) counts once,
 * keyed by its page. `formatDates` words an event's own dates.
 */
export function buildCalendarMapData(
  items: CalendarItem[],
  formatDates: (startsOn: string, endsOn: string) => string,
): CalendarMapData {
  const seen = new Set<string>();
  const groups = new Map<string, CalendarMapGroup>();
  let mappedEvents = 0;
  let unmappedEvents = 0;
  for (const item of items) {
    if (item.kind !== "EVENT") continue;
    const identity = item.href ?? item.key;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const point = item.mapPoint;
    if (!point || !item.href) {
      unmappedEvents += 1;
      continue;
    }
    mappedEvents += 1;
    const startsOn = item.eventStartsOn ?? item.startsOn;
    const endsOn = item.eventEndsOn ?? item.endsOn;
    const event: CalendarMapEvent = {
      title: item.eventTitle ?? item.title,
      href: item.href,
      startsOn,
      endsOn,
      dateLabel: formatDates(startsOn, endsOn),
    };
    const group = groups.get(point.siteId);
    if (group) group.events.push(event);
    else groups.set(point.siteId, { key: point.siteId, siteName: point.siteName, latitude: point.latitude, longitude: point.longitude, events: [event] });
  }
  for (const group of groups.values()) group.events.sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.title.localeCompare(b.title));
  return { groups: [...groups.values()], mappedEvents, unmappedEvents };
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** Which events a pin holds; a pin is rebuilt only when this changes. */
export function groupSignature(group: CalendarMapGroup) {
  return `${group.siteName}|${group.latitude},${group.longitude}|${group.events.map((event) => event.href).join(",")}`;
}

/** Plain-text accessible name for a pin (set with setAttribute, never parsed). */
export function markerLabel(group: CalendarMapGroup) {
  const count = group.events.length;
  const titles = group.events.map((event) => event.title).join(", ");
  return `${group.siteName}: ${count} upcoming ${plural(count, "event", "events")}, ${titles}`;
}

/** The plain-text note under the map: how many upcoming events are, and are not, on it. */
export function mapNoteText(mappedEvents: number, unmappedEvents: number) {
  const total = mappedEvents + unmappedEvents;
  const shown = `${mappedEvents} of ${total} upcoming ${plural(total, "event is", "events are")} on the map.`;
  if (unmappedEvents <= 0) return shown;
  return `${shown} ${unmappedEvents} ${plural(unmappedEvents, "event has", "events have")} no map location and ${plural(unmappedEvents, "is", "are")} listed below only.`;
}

/** How long each pin waits before it drops, so the set lands within about 0.4s whatever its size. */
export function dropDelayMs(index: number, count: number) {
  if (count <= 1) return 0;
  const step = Math.min(60, Math.floor(400 / (count - 1)));
  return index * step;
}

/**
 * The pin's popup: the site, then each event as a link to its page with its
 * dates. Built from nodes and `textContent` only, so a name like
 * `<img src=x onerror=alert(1)>` shows as those literal characters. Links are
 * only made for this site's own relative event paths.
 */
export function buildPopupContent(doc: Document, group: CalendarMapGroup): HTMLElement {
  const root = doc.createElement("div");
  root.className = "calendar-map-popup";

  const heading = doc.createElement("strong");
  heading.textContent = group.siteName;
  root.appendChild(heading);

  const list = doc.createElement("ul");
  for (const event of group.events) {
    const item = doc.createElement("li");
    const title = event.href.startsWith("/") && !event.href.startsWith("//")
      ? Object.assign(doc.createElement("a"), { href: event.href })
      : doc.createElement("span");
    title.textContent = event.title;
    item.appendChild(title);
    const dates = doc.createElement("small");
    dates.textContent = event.dateLabel;
    item.appendChild(dates);
    list.appendChild(item);
  }
  root.appendChild(list);
  return root;
}
