/* eslint-disable @typescript-eslint/no-explicit-any -- the fake database receives loosely typed Prisma arguments */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #111 phase B: privacy-safe analytics. Allowlists, the beacon route, the recorder and who may view. Synthetic data only. */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  eventFindFirst: vi.fn(),
  executeRaw: vi.fn(),
  groupBy: vi.fn(),
  deleteMany: vi.fn(),
  logWarn: vi.fn(),
  getCurrentSession: vi.fn(),
  originOk: { value: true },
  redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }),
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findFirst: mocks.eventFindFirst },
    $executeRaw: mocks.executeRaw,
    publicMetricDaily: { groupBy: mocks.groupBy, deleteMany: mocks.deleteMany },
  }),
}));
vi.mock("@/lib/logger", () => ({ logWarn: mocks.logWarn, logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({
  rejectCrossOriginRequest: () => (mocks.originOk.value ? null : Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 })),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/modules/calendar/repository", () => ({ conferenceToday: () => "2026-10-28" }));
vi.mock("@/components/admin-section-header", () => ({ AdminSectionHeaderFor: () => null }));

import { POST as beacon } from "@/app/api/public-metrics/route";
import PublicAnalyticsPage from "@/app/(workspace)/admin/analytics/page";
import {
  beaconBodySchema,
  decideDimension,
  directoryFiltersInUse,
  firstPathSegment,
  optedOutByHeaders,
} from "@/modules/public-metrics/domain";
import { getAnalyticsSummary, prunePublicMetrics, recordPublicMetric } from "@/modules/public-metrics/repository";

const post = (body: unknown, headers: Record<string, string> = {}) => beacon(new Request("https://events.imsda.test/api/public-metrics", {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
}));
const sqlText = () => mocks.executeRaw.mock.calls.map(([query]) => (query.strings as string[]).join("?")).join("\n");
const sqlValues = () => mocks.executeRaw.mock.calls.flatMap(([query]) => query.values as unknown[]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.originOk.value = true;
  mocks.eventFindFirst.mockImplementation(async ({ where }: any) => (where.slug === "public-camp" && where.isPublished === true && where.archivedAt === null && where.showOnCalendar === true ? { id: "e1" } : null));
  mocks.executeRaw.mockResolvedValue(1);
});

describe("the allowlists", () => {
  it("accepts only listed dimensions and never free text", () => {
    expect(decideDimension("DIRECTORY_SEARCH", "camp for kids")).toEqual({ kind: "ok", dimension: "" });
    expect(decideDimension("DIRECTORY_FILTER", "location")).toEqual({ kind: "ok", dimension: "location" });
    expect(decideDimension("DIRECTORY_FILTER", "Lake Site")).toEqual({ kind: "drop" });
    expect(decideDimension("LOGIN_FAILURE", "staff-password")).toEqual({ kind: "ok", dimension: "staff-password" });
    expect(decideDimension("LOGIN_FAILURE", "jane@example.org")).toEqual({ kind: "drop" });
    expect(decideDimension("IMAGE_ERROR", "https://x.example/a.png")).toEqual({ kind: "drop" });
    expect(decideDimension("IMAGE_ERROR", "external")).toEqual({ kind: "ok", dimension: "external" });
    expect(decideDimension("WEB_VITAL", "LCP:good")).toEqual({ kind: "ok", dimension: "LCP:good" });
    for (const bad of ["LCP", "FID:good", "LCP:ok", "LCP:good:extra"]) expect(decideDimension("WEB_VITAL", bad)).toEqual({ kind: "drop" });
    expect(decideDimension("NOT_FOUND", "events")).toEqual({ kind: "ok", dimension: "events" });
    expect(decideDimension("NOT_FOUND", "secret-path?token=abc")).toEqual({ kind: "ok", dimension: "other" });
    expect(decideDimension("EVENT_PAGE_VIEW", "public-camp")).toEqual({ kind: "event", slug: "public-camp" });
    for (const bad of ["Has Space", "../etc", "a?b=1", "", "x".repeat(101)]) expect(decideDimension("EVENT_PAGE_VIEW", bad)).toEqual({ kind: "drop" });
  });

  it("lets the browser send only its own metrics, with nothing extra", () => {
    expect(beaconBodySchema.safeParse({ metric: "EVENT_PAGE_VIEW", dimension: "public-camp" }).success).toBe(true);
    for (const metric of ["LOGIN_SUCCESS", "LOGIN_FAILURE", "REGISTRATION_COMPLETE", "NOPE"]) expect(beaconBodySchema.safeParse({ metric }).success, metric).toBe(false);
    expect(beaconBodySchema.safeParse({ metric: "NOT_FOUND", dimension: "a", userAgent: "x" }).success).toBe(false);
  });

  it("reduces the events list to filter names and a path to its first segment", () => {
    expect(directoryFiltersInUse({ q: "secret words", from: "2026-11-01", to: "", category: "Youth", location: "", audience: "clubs" })).toEqual({ search: true, filters: ["category", "audience", "date"] });
    expect(directoryFiltersInUse({ q: "", from: "", to: "", category: "", location: "", audience: "all" })).toEqual({ search: false, filters: [] });
    expect(firstPathSegment("/Events/abc?x=1#y")).toBe("events");
    expect(firstPathSegment("/")).toBe("");
  });

  it("reads Global Privacy Control and Do Not Track", () => {
    expect(optedOutByHeaders(new Headers({ "sec-gpc": "1" }))).toBe(true);
    expect(optedOutByHeaders(new Headers({ dnt: "1" }))).toBe(true);
    expect(optedOutByHeaders(new Headers())).toBe(false);
  });
});

describe("recording a count", () => {
  it("increments atomically by day, metric and dimension, and stores nothing else", async () => {
    expect(await recordPublicMetric("EVENT_PAGE_VIEW", "public-camp", new Date("2026-10-28T15:00:00Z"))).toBe(true);
    expect(sqlText()).toContain('ON CONFLICT ("day", "metric", "dimension") DO UPDATE SET "count" = "PublicMetricDaily"."count" + 1');
    expect(sqlValues()).toEqual([new Date("2026-10-28T00:00:00Z"), "EVENT_PAGE_VIEW", "public-camp"]);
  });

  it("counts the conference day, not the UTC day", async () => {
    await recordPublicMetric("DIRECTORY_SEARCH", "", new Date("2026-10-29T02:00:00Z"));
    expect(sqlValues()[0]).toEqual(new Date("2026-10-28T00:00:00Z"));
  });

  it("drops private, unpublished and unknown event slugs without writing", async () => {
    for (const slug of ["private-camp", "draft-camp", "nope"]) expect(await recordPublicMetric("EVENT_PAGE_VIEW", slug)).toBe(false);
    expect(await recordPublicMetric("REGISTRATION_COMPLETE", "private-camp")).toBe(false);
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("swallows a database failure and logs no request data", async () => {
    mocks.executeRaw.mockRejectedValue(new Error("db down, user jane@example.org"));
    expect(await recordPublicMetric("LOGIN_FAILURE", "staff-password")).toBe(false);
    expect(JSON.stringify(mocks.logWarn.mock.calls)).not.toContain("jane");
  });

  it("deletes only rows past 400 days", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 3 });
    expect(await prunePublicMetrics(new Date("2026-10-28T15:00:00Z"))).toBe(3);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { day: { lt: new Date("2025-09-23T00:00:00Z") } } });
  });
});

describe("the beacon route", () => {
  it("counts an allowed hit and answers 204", async () => {
    const response = await post({ metric: "EVENT_PAGE_VIEW", dimension: "public-camp" });
    expect(response.status).toBe(204);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("answers the same 204 for a private event, an unknown metric, a bad dimension, junk and oversize bodies, writing nothing", async () => {
    const hits: unknown[] = [
      { metric: "EVENT_PAGE_VIEW", dimension: "private-camp" },
      { metric: "LOGIN_SUCCESS", dimension: "staff-password" },
      { metric: "WEB_VITAL", dimension: "bogus" },
      "not json",
      { metric: "NOT_FOUND", dimension: "x".repeat(2000) },
    ];
    for (const hit of hits) {
      const response = await post(hit);
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    }
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("does not count a visitor who sends Global Privacy Control or Do Not Track", async () => {
    expect((await post({ metric: "DIRECTORY_SEARCH" }, { "sec-gpc": "1" })).status).toBe(204);
    expect((await post({ metric: "DIRECTORY_SEARCH" }, { dnt: "1" })).status).toBe(204);
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post", async () => {
    mocks.originOk.value = false;
    expect((await post({ metric: "DIRECTORY_SEARCH" })).status).toBe(403);
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("never looks at the session, cookies, address or user agent", () => {
    const source = readFileSync("app/api/public-metrics/route.ts", "utf8") + readFileSync("modules/public-metrics/repository.ts", "utf8") + readFileSync("modules/public-metrics/domain.ts", "utf8");
    for (const forbidden of ["cookies(", "getCurrentSession", "x-forwarded-for", "user-agent", "logInfo", "logError", "request.url"]) expect(source, forbidden).not.toContain(forbidden);
  });
});

describe("the summary and who can see it", () => {
  it("adds up the last 30 days into totals, a funnel, sign-in rates and speed ratings", async () => {
    mocks.groupBy.mockResolvedValue([
      { metric: "EVENT_PAGE_VIEW", dimension: "public-camp", _sum: { count: 9 } },
      { metric: "REGISTRATION_START", dimension: "public-camp", _sum: { count: 4 } },
      { metric: "REGISTRATION_COMPLETE", dimension: "public-camp", _sum: { count: 3 } },
      { metric: "LOGIN_SUCCESS", dimension: "staff-password", _sum: { count: 8 } },
      { metric: "LOGIN_FAILURE", dimension: "staff-password", _sum: { count: 2 } },
      { metric: "WEB_VITAL", dimension: "LCP:good", _sum: { count: 5 } },
      { metric: "WEB_VITAL", dimension: "LCP:poor", _sum: { count: 1 } },
    ]);
    const summary = await getAnalyticsSummary("2026-10-28");
    expect(summary.from).toBe("2026-09-29");
    expect(summary.totals).toMatchObject({ EVENT_PAGE_VIEW: 9, LOGIN_SUCCESS: 8, LOGIN_FAILURE: 2, WEB_VITAL: 6 });
    expect(summary.funnel).toEqual([{ slug: "public-camp", started: 4, completed: 3 }]);
    expect(summary.logins).toEqual([{ surface: "staff-password", success: 8, failure: 2 }]);
    expect(summary.vitals).toEqual([{ name: "LCP", good: 5, needsImprovement: 0, poor: 1 }]);
  });

  it("is for system administrators only", async () => {
    mocks.groupBy.mockResolvedValue([]);
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(PublicAnalyticsPage()).rejects.toThrow("redirect:/login");
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: null } });
    await expect(PublicAnalyticsPage()).rejects.toThrow("redirect:/no-access");
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: "SYSTEM_ADMIN" } });
    const html = renderToStaticMarkup(createElement("div", null, await PublicAnalyticsPage()));
    expect(html).toContain("Public analytics");
    expect(html).toContain("Nothing counted yet.");
  });
});
