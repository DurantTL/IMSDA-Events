/**
 * The numbers shown by the staff Home modules (#1705 part 2): pure, no database access, no authorization. The caller reads
 * only what the person's roles allow (see `home-modules-repository.ts`) and passes it in. Every number reuses a rule the
 * app already keeps; none of these views holds money, and a read that failed is `null`, shown as "Unavailable", never 0.
 */
import { buildSystemAdminDashboard, type SystemAdminEventSource } from "@/modules/system-admin/dashboard";
import type { AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import { monthlyStatusTotals } from "@/modules/club-reports/area-summary-domain";
import { chooseReportMonth } from "@/modules/club-reports/club-directory-domain";
import { reportMonthLabel } from "@/modules/club-reports/domain";

export const EVENTS_FILLING_UP_MAX = 5;
export const TREND_DAYS = 30;

/** Event pages open on the event's overview, the same link Coming up uses. */
const eventOverviewHref = (eventId: string) => `/overview?event=${encodeURIComponent(eventId)}`;

export type EventsFillingUpRow = {
  id: string;
  name: string;
  href: string;
  /** Attendees on active registrations (SUBMITTED or CONFIRMED), the unit the dashboard's capacity compares. */
  registered: number;
  capacity: number | null;
  /** "40 of 100 spots taken", or "40 registered, no limit". */
  takenText: string;
  /** Whole percent taken (capped at 100), or null when there is no limit. */
  percentTaken: number | null;
  /** Only when the event has a waitlist. */
  waitlist: number | null;
  daysText: string;
};

export type EventsFillingUpView = {
  rows: EventsFillingUpRow[];
  footerLink: { href: string; label: string };
};

export function daysToGoText(timing: "UPCOMING" | "IN_PROGRESS" | "PAST", daysUntilStart: number | null): string {
  if (timing === "IN_PROGRESS") return "Happening now";
  if (daysUntilStart === null || daysUntilStart <= 0) return "Starts today";
  return daysUntilStart === 1 ? "1 day to go" : `${daysUntilStart} days to go`;
}

/** The next events that have not ended, from the rows the dashboard read returns. Same timing, sort and counts as the dashboards. */
export function buildEventsFillingUp(sources: readonly SystemAdminEventSource[], now: Date, isSystemAdmin: boolean): EventsFillingUpView {
  const dashboard = buildSystemAdminDashboard({
    events: sources.filter((source) => source.archivedAt === null),
    activeUserCount: 0,
    pendingUserCount: 0,
    systemAdminCount: 0,
    unresolvedAlertCount: 0,
  }, now);
  const rows = dashboard.events
    .filter((event) => event.timing !== "PAST")
    .slice(0, EVENTS_FILLING_UP_MAX)
    .map((event): EventsFillingUpRow => ({
      id: event.id,
      name: event.name,
      href: eventOverviewHref(event.id),
      registered: event.attendeeCount,
      capacity: event.capacity,
      takenText: event.capacity === null ? `${event.attendeeCount} registered, no limit` : `${event.attendeeCount} of ${event.capacity} spots taken`,
      percentTaken: event.capacity && event.capacity > 0 ? Math.min(100, Math.round((event.attendeeCount / event.capacity) * 100)) : null,
      waitlist: event.waitlistEnabled ? event.waitingCount : null,
      daysText: daysToGoText(event.timing, event.daysUntilStart),
    }));
  return {
    rows,
    footerLink: isSystemAdmin ? { href: "/admin/events", label: "Open all events" } : { href: "/events-admin", label: "Open the Events Administrator dashboard" },
  };
}

/** New items per day for the last `days` days, oldest first, ending with the day of `now` (UTC days). */
export function dailyCounts(dates: readonly Date[], now: Date, days = TREND_DAYS): number[] {
  const counts = new Array<number>(days).fill(0);
  const day = 86_400_000;
  const todayStart = Math.floor(now.getTime() / day) * day;
  for (const date of dates) {
    const back = Math.floor((todayStart - Math.floor(date.getTime() / day) * day) / day);
    if (back < 0 || back >= days) continue;
    counts[days - 1 - back] += 1;
  }
  return counts;
}

export type SeasonTile = { key: "registrations" | "people" | "clubs"; label: string; value: number | null; href: string };

export type SeasonNumbersView = {
  clubYear: string;
  tiles: SeasonTile[];
  /** Daily new registrations, oldest first; null when the read failed or the person sees no events. */
  trend: { days: number[]; total: number; text: string } | null;
  /** True when the trend read failed (shown as Unavailable), as opposed to a person with no event data. */
  trendUnavailable: boolean;
};

export type SeasonInput = {
  clubYear: string;
  /** Null when the person sees no events at all; a number or null (read failed) otherwise. */
  events: { registrations: number | null; people: number | null; trend: number[] | null; href: string } | null;
  /** Null when the person sees no clubs; `{ count: null }` when the read failed. */
  clubs: { count: number | null } | null;
};

export function trendText(total: number): string {
  return total === 1 ? "1 new registration in the last 30 days" : `${total} new registrations in the last 30 days`;
}

export function buildSeasonNumbers(input: SeasonInput): SeasonNumbersView {
  const tiles: SeasonTile[] = [];
  if (input.events) {
    tiles.push({ key: "registrations", label: "Registrations", value: input.events.registrations, href: input.events.href });
    tiles.push({ key: "people", label: "People registered", value: input.events.people, href: input.events.href });
  }
  if (input.clubs) tiles.push({ key: "clubs", label: "Active clubs", value: input.clubs.count, href: "/admin/clubs" });
  const trendDays = input.events?.trend ?? null;
  const total = trendDays ? trendDays.reduce((sum, count) => sum + count, 0) : 0;
  return {
    clubYear: input.clubYear,
    tiles,
    trend: trendDays ? { days: trendDays, total, text: trendText(total) } : null,
    trendUnavailable: input.events !== null && trendDays === null,
  };
}

export type MonthlyRecordsView = {
  monthLabel: string;
  /** Conference-wide for now: club areas do not exist yet, so one "All clubs" row. A later issue splits it by area. */
  rows: Array<{ label: string; clubs: number; submitted: number; started: number; notStarted: number }>;
  href: string;
};

/**
 * The report month's records for all active clubs. Submitted counts submitted and late records (the area summary's rule),
 * Started is drafts, and Not started is every other club (missing, due, or not yet due), so the three add up to the clubs.
 */
export function buildMonthlyRecords(clubs: readonly AreaClubSummary[], clubYear: string, now: Date): MonthlyRecordsView {
  const month = chooseReportMonth(clubYear, now);
  const totals = monthlyStatusTotals(clubs, clubYear).find((entry) => entry.month === month);
  if (!totals) throw new Error("The report month is not in the club year.");
  return {
    monthLabel: reportMonthLabel(month),
    rows: [{ label: "All clubs", clubs: totals.clubs, submitted: totals.submitted, started: totals.drafts, notStarted: totals.clubs - totals.submitted - totals.drafts }],
    href: "/admin/clubs/reports",
  };
}
