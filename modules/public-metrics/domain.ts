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
export const loginSurfaces = ["staff-password", "staff-passkey", "attendee-password", "attendee-passkey"] as const;
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
