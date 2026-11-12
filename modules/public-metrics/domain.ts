/**
 * Privacy-safe public analytics (#111): the rules, all pure. A metric is a daily count with one allowlisted dimension.
 * Nothing about a person, a device, a search, an address or a page address is ever a dimension; anything outside the
 * allowlists is dropped, never stored. See docs/PUBLIC-ANALYTICS.md.
 */

import { z } from "zod";
import { addDays } from "@/modules/calendar/domain";

export const publicMetrics = [
  "EVENT_PAGE_VIEW", "DIRECTORY_SEARCH", "DIRECTORY_FILTER", "REGISTRATION_START", "REGISTRATION_COMPLETE",
  "LOGIN_SUCCESS", "LOGIN_FAILURE", "NOT_FOUND", "IMAGE_ERROR", "WEB_VITAL",
] as const;
export type PublicMetricName = (typeof publicMetrics)[number];

/** What the browser beacon may report. Sign-ins and completed registrations are recorded on the server only. */
export const beaconMetrics = ["EVENT_PAGE_VIEW", "REGISTRATION_START", "DIRECTORY_SEARCH", "DIRECTORY_FILTER", "NOT_FOUND", "IMAGE_ERROR", "WEB_VITAL"] as const satisfies readonly PublicMetricName[];
export type BeaconMetric = (typeof beaconMetrics)[number];

export const eventMetrics = ["EVENT_PAGE_VIEW", "REGISTRATION_START", "REGISTRATION_COMPLETE"] as const satisfies readonly PublicMetricName[];
export const directoryFilters = ["category", "audience", "location", "date"] as const;
export const loginSurfaces = ["staff-password", "staff-mfa", "staff-passkey", "attendee-password", "attendee-passkey", "unified-password", "unified-passkey"] as const;
export type LoginSurface = (typeof loginSurfaces)[number];
export const publicSections = [
  "events", "calendar", "clubs", "account", "register", "manage", "forms", "embed", "club-forms", "pay",
  "health-records", "recover-registration", "staff-invite", "unsubscribe", "sign-in", "login",
] as const;
export const imageOrigins = ["same-origin", "external"] as const;
export const vitalNames = ["LCP", "CLS", "INP", "FCP", "TTFB"] as const;
export const vitalRatings = ["good", "needs-improvement", "poor"] as const;

const slugPattern = /^[a-z0-9][a-z0-9-]{0,99}$/;

export type DimensionDecision =
  | { kind: "ok"; dimension: string }
  /** Valid in shape; the server must confirm the event is public and published before it is counted. */
  | { kind: "event"; slug: string }
  | { kind: "drop" };

/**
 * Turns what a client sent into a stored dimension, or drops it. Only values from fixed lists (or a well-formed event
 * slug, checked against the database) get through, so free text can never reach the table.
 */
export function decideDimension(metric: PublicMetricName, raw: unknown): DimensionDecision {
  const value = typeof raw === "string" ? raw : "";
  switch (metric) {
    case "EVENT_PAGE_VIEW":
    case "REGISTRATION_START":
    case "REGISTRATION_COMPLETE":
      return slugPattern.test(value) ? { kind: "event", slug: value } : { kind: "drop" };
    case "DIRECTORY_SEARCH":
      return { kind: "ok", dimension: "" };
    case "DIRECTORY_FILTER":
      return (directoryFilters as readonly string[]).includes(value) ? { kind: "ok", dimension: value } : { kind: "drop" };
    case "LOGIN_SUCCESS":
    case "LOGIN_FAILURE":
      return (loginSurfaces as readonly string[]).includes(value) ? { kind: "ok", dimension: value } : { kind: "drop" };
    case "NOT_FOUND":
      // The first path segment only, and only a known public section; anything else is "other".
      return { kind: "ok", dimension: (publicSections as readonly string[]).includes(value) ? value : "other" };
    case "IMAGE_ERROR":
      return (imageOrigins as readonly string[]).includes(value) ? { kind: "ok", dimension: value } : { kind: "drop" };
    case "WEB_VITAL": {
      const [name, rating, ...rest] = value.split(":");
      return rest.length === 0 && (vitalNames as readonly string[]).includes(name) && (vitalRatings as readonly string[]).includes(rating)
        ? { kind: "ok", dimension: `${name}:${rating}` }
        : { kind: "drop" };
    }
  }
}

/** The beacon's request body: exactly a metric and an optional dimension, nothing else. */
export const beaconBodySchema = z.object({
  metric: z.enum(beaconMetrics),
  dimension: z.string().max(100).optional(),
}).strict();

export const beaconMaxBytes = 1024;

/** The first path segment of a path, lower case, for the 404 metric. Never the rest of the address. */
export function firstPathSegment(pathname: string): string {
  return (pathname.split("?")[0].split("#")[0].split("/").filter(Boolean)[0] ?? "").toLowerCase().slice(0, 40);
}

/**
 * First path segments of the staff workspace. Pages there are never measured: not their speed, not their 404s. Public
 * analytics are about the public site only.
 */
export const staffWorkspaceSections = [
  "admin", "admin-role", "community", "overview", "people", "finance", "check-in", "communications", "more", "imports", "registration-builder",
  "event-setup", "events-admin", "archived-events", "staff", "profile", "help", "information-forms", "select-event", "no-access", "api", "home",
] as const;

export function isStaffWorkspacePath(pathname: string): boolean {
  return (staffWorkspaceSections as readonly string[]).includes(firstPathSegment(pathname));
}

/** Whether the visitor asked not to be measured (Global Privacy Control or Do Not Track), from request headers. */
export function optedOutByHeaders(headers: { get(name: string): string | null }): boolean {
  return headers.get("sec-gpc") === "1" || headers.get("dnt") === "1";
}

/** The filters in use on the events list, by name only: never their values. */
export function directoryFiltersInUse(filters: { q: string; from: string; to: string; category: string; location: string; audience: string }) {
  const used: string[] = [];
  if (filters.category) used.push("category");
  if (filters.audience && filters.audience !== "all") used.push("audience");
  if (filters.location) used.push("location");
  if (filters.from || filters.to) used.push("date");
  return { search: Boolean(filters.q), filters: used };
}

export const retentionDays = 400;

/** The periods the analytics page can show, in days. Retention is 400 days, so 12 months is always covered. */
export const analyticsPeriods = [30, 90, 365] as const;
export type AnalyticsPeriod = (typeof analyticsPeriods)[number];
export const defaultAnalyticsPeriod: AnalyticsPeriod = 30;

/** Reads the `days` address value: only 30, 90 or 365 are accepted; anything else is the default. */
export function parseAnalyticsPeriod(raw: string | string[] | undefined): AnalyticsPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return analyticsPeriods.find((period) => String(period) === value) ?? defaultAnalyticsPeriod;
}

export type EventFunnelRow = { slug: string; views: number; started: number; completed: number };

/**
 * Joins views, starts and completions per event slug. An event with views but no starts still gets a row. Ordered by
 * completed registrations (most first), then views, then slug, so the order is the same every time.
 */
export function buildEventFunnel(views: ReadonlyMap<string, number>, started: ReadonlyMap<string, number>, completed: ReadonlyMap<string, number>): EventFunnelRow[] {
  const slugs = new Set([...views.keys(), ...started.keys(), ...completed.keys()]);
  return [...slugs]
    .map((slug) => ({ slug, views: views.get(slug) ?? 0, started: started.get(slug) ?? 0, completed: completed.get(slug) ?? 0 }))
    .sort((a, b) => b.completed - a.completed || b.views - a.views || a.slug.localeCompare(b.slug));
}

/** part / whole, or null when there is nothing to divide by. Not capped: separate days and direct links can pass 1. */
export const funnelRate = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

/* ------------------------------------------------------------------ Headline tiles and charts (#1961) */

export type FunnelCounts = { views: number; started: number; completed: number };
export type DateRange = { from: string; to: string };

/** The `days` days immediately before the period that starts on `from`: the same length, ending the day before. */
export function previousPeriodRange(from: string, days: number): DateRange {
  const to = addDays(from, -1);
  return { from: addDays(to, -(days - 1)), to };
}

/**
 * Whether the whole previous period is still stored. Rows older than the retention window (400 days, counted back from
 * `today`) are deleted, so a half-kept period would make a change look bigger than it is. Rule: the previous period is
 * compared only when every one of its days is inside the window; otherwise there is no comparison at all. In practice
 * 30 and 90 days compare, and 12 months (730 days back) never does.
 */
export function previousPeriodAvailable(today: string, days: number): boolean {
  const from = addDays(today, -(days - 1));
  return previousPeriodRange(from, days).from >= addDays(today, -retentionDays);
}

export type ChangeDirection = "up" | "down" | "same";
export type Change = {
  direction: ChangeDirection;
  /** Whole percent of the previous count, always 0 or more (the direction carries the sign); null when the previous count was 0. */
  percent: number | null;
};

/** Current against previous. A previous count of 0 has no percent (never a made-up +100%); it is still "up" when something was counted. */
export function changeVersusPrevious(current: number, previous: number): Change {
  if (current === previous) return { direction: "same", percent: previous === 0 ? null : 0 };
  const direction: ChangeDirection = current > previous ? "up" : "down";
  if (previous === 0) return { direction, percent: null };
  const percent = Math.round((Math.abs(current - previous) / previous) * 100);
  // A change that rounds to 0% reads as "same", so the arrow and the words agree.
  return percent === 0 ? { direction: "same", percent: 0 } : { direction, percent };
}

export type RateChange = { direction: ChangeDirection; /** Percentage points, one decimal, 0 or more. */ points: number };

/** Change in a rate (a 0 to 1 share) in percentage points; null when either rate is unknown. */
export function rateChangeVersusPrevious(current: number | null, previous: number | null): RateChange | null {
  if (current === null || previous === null) return null;
  const points = Math.round((current - previous) * 1000) / 10;
  if (points === 0) return { direction: "same", points: 0 };
  return { direction: points > 0 ? "up" : "down", points: Math.abs(points) };
}

const plain = (count: number) => count.toLocaleString("en-US");

/** The words next to a tile's arrow: "Up 12% from the previous 30 days". `previousLabel` is like "30 days" or "12 months". */
export function describeChange(change: Change | RateChange | null, previousLabel: string, previousCount?: number): string {
  if (change === null) return `No comparison: the previous ${previousLabel} are older than the ${retentionDays} days of counts kept.`;
  const word = change.direction === "up" ? "Up" : change.direction === "down" ? "Down" : "No change";
  if ("points" in change) return change.direction === "same" ? `No change from the previous ${previousLabel}` : `${word} ${change.points} percentage points from the previous ${previousLabel}`;
  if (change.direction === "same") return `No change from the previous ${previousLabel}`;
  if (change.percent === null) return `${word} from none counted in the previous ${previousLabel}`;
  return `${word} ${change.percent}% from the previous ${previousLabel}${previousCount === undefined ? "" : ` (${plain(previousCount)})`}`;
}

export type DailyFunnelPoint = { day: string } & FunnelCounts;
export type DailyMetricRow = { day: string; metric: string; count: number };

/** Every day from `from` to `to` (inclusive) with its views, starts and completions; a day with no row is 0, never skipped. */
export function fillDailySeries(from: string, to: string, rows: readonly DailyMetricRow[]): DailyFunnelPoint[] {
  const byDay = new Map<string, FunnelCounts>();
  for (const row of rows) {
    const counts = byDay.get(row.day) ?? { views: 0, started: 0, completed: 0 };
    if (row.metric === "EVENT_PAGE_VIEW") counts.views += row.count;
    else if (row.metric === "REGISTRATION_START") counts.started += row.count;
    else if (row.metric === "REGISTRATION_COMPLETE") counts.completed += row.count;
    byDay.set(row.day, counts);
  }
  const points: DailyFunnelPoint[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) points.push({ day, ...(byDay.get(day) ?? { views: 0, started: 0, completed: 0 }) });
  return points;
}

export type TrendBucket = { start: string; end: string; days: number } & FunnelCounts;

/**
 * Daily points for 30 and 90 days, weekly sums for 365. Weeks are seven days and end on the last day, so the newest week is
 * always whole; the oldest bucket holds the leftover (365 days is 52 weeks and 1 day, so it is 1 day long).
 */
export function bucketSeries(points: readonly DailyFunnelPoint[], days: number): TrendBucket[] {
  const size = days >= 365 ? 7 : 1;
  const buckets: TrendBucket[] = [];
  for (let end = points.length; end > 0; end -= size) {
    const slice = points.slice(Math.max(0, end - size), end);
    buckets.unshift({
      start: slice[0]!.day,
      end: slice[slice.length - 1]!.day,
      days: slice.length,
      views: slice.reduce((sum, point) => sum + point.views, 0),
      started: slice.reduce((sum, point) => sum + point.started, 0),
      completed: slice.reduce((sum, point) => sum + point.completed, 0),
    });
  }
  return buckets;
}

/** The events with the most completed registrations, most first (ties: views, then slug). Events with none completed are left out. */
export function topEventsByCompleted<T extends { slug: string; views: number; completed: number }>(rows: readonly T[], limit = 10): T[] {
  return rows
    .filter((row) => row.completed > 0)
    .sort((a, b) => b.completed - a.completed || b.views - a.views || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}
