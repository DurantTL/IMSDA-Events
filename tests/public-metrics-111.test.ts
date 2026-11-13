/* eslint-disable @typescript-eslint/no-explicit-any -- the fake database receives loosely typed Prisma arguments */
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #111 phase B: privacy-safe analytics. Allowlists, the beacon route, the recorder and who may view. Synthetic data only. */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  eventFindFirst: vi.fn(),
  eventFindMany: vi.fn(),
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
    event: { findFirst: mocks.eventFindFirst, findMany: mocks.eventFindMany },
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
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, usePathname: () => "/admin/analytics", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/modules/calendar/repository", () => ({ conferenceToday: () => "2026-10-28" }));
vi.mock("@/components/admin-section-header", () => ({ AdminSectionHeaderFor: () => null }));

import { resolveLinkScroll } from "@/components/link-guard";
import { POST as beacon } from "@/app/api/public-metrics/route";
import PublicAnalyticsPage from "@/app/(workspace)/admin/analytics/page";
import {
  beaconBodySchema,
  buildEventFunnel,
  funnelRate,
  parseAnalyticsPeriod,
  decideDimension,
  directoryFiltersInUse,
  firstPathSegment,
  isStaffWorkspacePath,
  staffWorkspaceSections,
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
  mocks.eventFindMany.mockResolvedValue([{ slug: "public-camp", name: "Public Camp" }]);
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

  it("lists every staff workspace folder and the staff-only top-level pages, so a new one cannot be forgotten", () => {
    const folders = readdirSync("app/(workspace)", { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    for (const folder of [...folders, "archived-events", "select-event", "no-access"]) expect(staffWorkspaceSections as readonly string[], folder).toContain(folder);
    expect(isStaffWorkspacePath("/community/posts")).toBe(true);
    expect(isStaffWorkspacePath("/events/public-camp")).toBe(false);
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

  it("stops reading a large body that declares no length", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(`{"metric":"DIRECTORY_SEARCH","dimension":"${"x".repeat(5000)}"}`)); controller.close(); } });
    const response = await beacon(new Request("https://events.imsda.test/api/public-metrics", { method: "POST", headers: { origin: "https://events.imsda.test" }, body: stream, duplex: "half" } as RequestInit));
    expect(response.status).toBe(204);
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect((await post({ metric: "DIRECTORY_SEARCH" })).status).toBe(204);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("refuses a large body by its declared length before reading it", async () => {
    const response = await post({ metric: "DIRECTORY_SEARCH" }, { "content-length": "5000" });
    expect(response.status).toBe(204);
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

/** The summary asks for three groupings: by metric and dimension, by day and metric (#1961), and the previous period's totals by metric. */
function mockSummaryRows(rows: unknown[], extra: { daily?: unknown[]; previous?: unknown[] } = {}) {
  mocks.groupBy.mockImplementation(async (args: { by: string[] }) => (args.by.includes("dimension") ? rows : args.by.includes("day") ? extra.daily ?? [] : extra.previous ?? []));
}

describe("the summary and who can see it", () => {
  it("adds up the last 30 days into totals, a funnel, sign-in rates and speed ratings", async () => {
    mockSummaryRows([
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
    expect(summary.funnel).toEqual([{ slug: "public-camp", title: "Public Camp", views: 9, started: 4, completed: 3 }]);
    expect(summary.days).toBe(30);
    expect(mocks.eventFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.eventFindMany.mock.calls[0][0].select).toEqual({ slug: true, name: true });
    expect(summary.logins).toEqual([{ surface: "staff-password", success: 8, failure: 2 }]);
    expect(summary.vitals).toEqual([{ name: "LCP", good: 5, needsImprovement: 0, poor: 1 }]);
  });

  it("reads 90 days and 12 months back, and falls back to the slug for an unknown event", async () => {
    mockSummaryRows([{ metric: "EVENT_PAGE_VIEW", dimension: "gone-event", _sum: { count: 2 } }]);
    const summary = await getAnalyticsSummary("2026-10-28", 90);
    expect(summary.from).toBe("2026-07-31");
    expect(summary.funnel).toEqual([{ slug: "gone-event", title: "gone-event", views: 2, started: 0, completed: 0 }]);
    expect((await getAnalyticsSummary("2026-10-28", 365)).from).toBe("2025-10-29");
  });

  it("adds the previous period's totals and a day-by-day series (#1961)", async () => {
    mockSummaryRows([], {
      daily: [{ day: new Date("2026-10-27T00:00:00Z"), metric: "EVENT_PAGE_VIEW", _sum: { count: 7 } }, { day: new Date("2026-10-28T00:00:00Z"), metric: "REGISTRATION_COMPLETE", _sum: { count: 1 } }],
      previous: [{ metric: "EVENT_PAGE_VIEW", _sum: { count: 5 } }, { metric: "REGISTRATION_START", _sum: { count: 2 } }],
    });
    const summary = await getAnalyticsSummary("2026-10-28");
    expect(summary.previous).toEqual({ from: "2026-08-30", to: "2026-09-28", totals: { views: 5, started: 2, completed: 0 } });
    expect(summary.daily).toHaveLength(30);
    expect(summary.daily.at(-2)).toEqual({ day: "2026-10-27", views: 7, started: 0, completed: 0 });
    expect(summary.daily.at(-1)).toEqual({ day: "2026-10-28", views: 0, started: 0, completed: 1 });
    expect(summary.daily[0]).toEqual({ day: "2026-09-29", views: 0, started: 0, completed: 0 });
  });

  it("does not look up a previous period that is past the 400-day retention", async () => {
    mockSummaryRows([]);
    mocks.groupBy.mockClear();
    const summary = await getAnalyticsSummary("2026-10-28", 365);
    expect(summary.previous.totals).toBeNull();
    expect(summary.daily).toHaveLength(365);
    expect(mocks.groupBy.mock.calls.filter(([args]) => args.by.length === 1)).toHaveLength(0);
  });

  describe("the at-a-glance tiles on the page (#1961)", () => {
    const row = (metric: string, count: number) => ({ metric, dimension: "public-camp", _sum: { count } });
    const current = (views: number, started: number, completed: number) => [row("EVENT_PAGE_VIEW", views), row("REGISTRATION_START", started), row("REGISTRATION_COMPLETE", completed)];
    const previousRows = (views: number, started: number, completed: number) => [{ metric: "EVENT_PAGE_VIEW", _sum: { count: views } }, { metric: "REGISTRATION_START", _sum: { count: started } }, { metric: "REGISTRATION_COMPLETE", _sum: { count: completed } }];
    const render = async (days: string) => {
      mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: "SYSTEM_ADMIN" } });
      return renderToStaticMarkup(createElement("div", null, await PublicAnalyticsPage({ searchParams: Promise.resolve({ days }) })));
    };

    it("compares 30 days with the 30 before, in words, and charts by day", async () => {
      mockSummaryRows(current(120, 40, 20), { previous: previousRows(100, 50, 10) });
      const html = await render("30");
      expect(html).toContain("Up 20% from the previous 30 days (100)");
      expect(html).toContain("Down 20% from the previous 30 days (50)");
      expect(html).toContain("Up 100% from the previous 30 days (10)");
      expect(html).toContain("Up 30 percentage points from the previous 30 days");
      expect(html).toContain("Views, starts and completions by day");
      expect(html).toContain("Each change compares with the 30 days just before this period.");
      expect(html).not.toContain("No comparison");
    });

    it("compares 90 days the same way", async () => {
      mockSummaryRows(current(50, 10, 5), { previous: previousRows(50, 10, 5) });
      const html = await render("90");
      expect(html).toContain("No change from the previous 90 days");
      expect(html).toContain("Views, starts and completions by day");
    });

    it("says there is no comparison for 12 months, charts by week and skips the previous query", async () => {
      mockSummaryRows(current(120, 40, 20), { previous: previousRows(100, 50, 10) });
      mocks.groupBy.mockClear();
      const html = await render("365");
      expect(html).toContain("No comparison: only part of the previous 12 months is still kept (counts are kept for 400 days).");
      expect(html).toContain("Views, starts and completions by week");
      expect(html).toContain("there is no comparison for this period");
      expect(html).not.toContain("Each change compares with the 12 months");
      expect(html).not.toContain("Up 20%");
      expect(mocks.groupBy.mock.calls.filter(([args]) => args.by.length === 1)).toHaveLength(0);
    });

    it("names the period with no starts on the rate tile", async () => {
      mockSummaryRows(current(10, 0, 0), { previous: previousRows(10, 5, 1) });
      expect(await render("30")).toContain("No comparison: nothing was started in this period.");
      mockSummaryRows(current(10, 4, 1), { previous: previousRows(10, 0, 0) });
      expect(await render("30")).toContain("No comparison: nothing was started in the previous 30 days.");
      mockSummaryRows(current(10, 0, 0), { previous: previousRows(10, 0, 0) });
      expect(await render("30")).toContain("No comparison: nothing was started in this period or in the previous 30 days.");
    });
  });

  it("skips the day series and previous period when trends are off (the system report)", async () => {
    mockSummaryRows([]);
    mocks.groupBy.mockClear();
    const summary = await getAnalyticsSummary("2026-10-28", 30, { eventNames: false, trends: false });
    expect(mocks.groupBy).toHaveBeenCalledTimes(1);
    expect(summary.daily).toEqual([]);
    expect(summary.previous.totals).toBeNull();
  });

  it("shows the period links and the one funnel table", async () => {
    mockSummaryRows([{ metric: "EVENT_PAGE_VIEW", dimension: "public-camp", _sum: { count: 2 } }]);
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: "SYSTEM_ADMIN" } });
    const html = renderToStaticMarkup(createElement("div", null, await PublicAnalyticsPage({ searchParams: Promise.resolve({ days: "90", funnelSort: "c1", funnelDir: "desc" }) })));
    expect(html).toContain("last 90 days");
    // The section tab is the one "page"; the chosen period is marked "true".
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-current="page"');
    expect(html).toContain("Last 12 months");
    // Period links keep the table sort and change only `days`; 30 days drops it.
    expect(html).toContain('href="/admin/analytics?funnelSort=c1&amp;funnelDir=desc"');
    expect(html).toContain('href="/admin/analytics?funnelSort=c1&amp;funnelDir=desc&amp;days=365"');
    expect(html).toContain("Events are counted only while they are public");
    expect(html).toContain("Which event pages lead to registrations");
    expect(html).toContain("Public Camp");
    expect(html).not.toContain("Most viewed public event pages");
  });

  it("keeps the reader's place when a period link is used", () => {
    // The strip's links are GuardedLink, which keeps scroll on a same-page address change (#1557).
    expect(readFileSync("components/staff-view-strip.tsx", "utf8")).toContain("<GuardedLink");
    expect(resolveLinkScroll("/admin/analytics?days=90", "/admin/analytics", undefined)).toBe(false);
  });

  it("skips the event name lookup when asked", async () => {
    mockSummaryRows([{ metric: "EVENT_PAGE_VIEW", dimension: "public-camp", _sum: { count: 2 } }]);
    const summary = await getAnalyticsSummary("2026-10-28", 30, { eventNames: false });
    expect(mocks.eventFindMany).not.toHaveBeenCalled();
    expect(summary.funnel[0].title).toBe("public-camp");
  });

  it("is for system administrators only", async () => {
    mockSummaryRows([]);
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(PublicAnalyticsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: null } });
    await expect(PublicAnalyticsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/no-access");
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", globalRole: "SYSTEM_ADMIN" } });
    const html = renderToStaticMarkup(createElement("div", null, await PublicAnalyticsPage({ searchParams: Promise.resolve({}) })));
    expect(html).toContain("Public analytics");
    expect(html).toContain("Nothing counted yet.");
  });
});

describe("the event funnel join (#1560)", () => {
  it("keeps events with views but no starts, and orders by completed then views", () => {
    const rows = buildEventFunnel(
      new Map([["a-camp", 10], ["b-camp", 50], ["c-camp", 7]]),
      new Map([["a-camp", 4], ["d-camp", 1]]),
      new Map([["a-camp", 3], ["d-camp", 3]]),
    );
    expect(rows).toEqual([
      { slug: "a-camp", views: 10, started: 4, completed: 3 },
      { slug: "d-camp", views: 0, started: 1, completed: 3 },
      { slug: "b-camp", views: 50, started: 0, completed: 0 },
      { slug: "c-camp", views: 7, started: 0, completed: 0 },
    ]);
  });

  it("does not cap a rate and has none without a denominator", () => {
    expect(funnelRate(3, 2)).toBe(1.5);
    expect(funnelRate(0, 0)).toBeNull();
  });

  it("accepts only 30, 90 or 365 days", () => {
    expect(parseAnalyticsPeriod(undefined)).toBe(30);
    expect(parseAnalyticsPeriod("90")).toBe(90);
    expect(parseAnalyticsPeriod("365")).toBe(365);
    expect(parseAnalyticsPeriod(["90", "365"])).toBe(90);
    for (const bad of ["", "0", "7", "400", "-30", "30.0", "abc", "90 "]) expect(parseAnalyticsPeriod(bad), bad).toBe(30);
  });
});
