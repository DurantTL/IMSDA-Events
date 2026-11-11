import "server-only";

import { cache } from "react";
import { getPrisma } from "@/lib/prisma";
import { calendarDateIn } from "@/modules/calendar/domain";
import type { AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import type { findDashboardEvents } from "@/modules/system-admin/repository";

/**
 * Heavy reads that Home asks for from more than one place (Needs you and the Home modules, #1705) run once per request.
 * The store is React `cache`, so it lives for one server render and is never shared between people or requests. What is
 * read is unchanged; a second caller with the same scope gets the first caller's promise (a failure too, which each caller handles).
 */
type DashboardRows = Awaited<ReturnType<typeof findDashboardEvents>>;
const requestStore = cache(() => ({
  events: new Map<string, Promise<DashboardRows>>(),
  clubs: new Map<string, Promise<AreaClubSummary[]>>(),
}));

/**
 * `findDashboardEvents` for events that have not ended, once per request and scope. `undefined` is every event (system
 * administrators only); a list is that person's own events, and is served from the every-event read when one is already
 * under way, so a system administrator with assignments reads once. Callers must start the wider read first.
 */
export function dashboardEventsOnce(eventIds: readonly string[] | undefined, now: Date): Promise<DashboardRows> {
  const store = requestStore().events;
  if (eventIds !== undefined && eventIds.length === 0) return Promise.resolve([]);
  const wider = store.get("all");
  if (eventIds !== undefined && wider) {
    const wanted = new Set(eventIds);
    return wider.then((rows) => rows.filter((row) => wanted.has(row.id)));
  }
  const key = eventIds === undefined ? "all" : [...eventIds].sort().join(",");
  let read = store.get(key);
  if (!read) {
    // Loaded on first use so pages that only read the club summary do not pull in the dashboard read.
    read = import("@/modules/system-admin/repository").then((module) => module.findDashboardEvents(getPrisma(), { eventIds, endsOnOrAfter: now }));
    store.set(key, read);
  }
  return read;
}

/** `getAreaClubsSummary` with `backgroundChecks: false` (the Admin hub's read), once per request, club year and conference day. */
export function clubsSummaryOnce(clubYear: string, now: Date): Promise<AreaClubSummary[]> {
  const store = requestStore().clubs;
  const key = `${clubYear}|${calendarDateIn(now)}`;
  let read = store.get(key);
  if (!read) {
    read = getAreaClubsSummary(clubYear, now, { backgroundChecks: false });
    store.set(key, read);
  }
  return read;
}
