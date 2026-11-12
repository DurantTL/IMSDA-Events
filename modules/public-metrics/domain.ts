/**
 * Privacy-safe public analytics (#111): the rules, all pure. A metric is a daily count with one allowlisted dimension.
 * Nothing about a person, a device, a search, an address or a page address is ever a dimension; anything outside the
 * allowlists is dropped, never stored. See docs/PUBLIC-ANALYTICS.md.
 */

import { z } from "zod";

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
