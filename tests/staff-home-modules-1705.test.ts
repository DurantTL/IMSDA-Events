import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminRoles } from "@/modules/access/admin-roles-domain";
import type { HomeModuleKey } from "@/modules/system-admin/home-layout-domain";
import { resolveHomeLayout, sanitizeHomeLayoutInput } from "@/modules/system-admin/home-layout-domain";
import {
  QUICK_LINKS_MAX,
  cleanQuickLinkKeys,
  defaultQuickLinkKeys,
  usableQuickLinks,
} from "@/modules/system-admin/home-quick-links-domain";
import {
  buildEventsFillingUp,
  buildMonthlyRecords,
  buildSeasonNumbers,
  dailyCounts,
  daysToGoText,
} from "@/modules/system-admin/home-modules-model";
import type { SystemAdminEventSource } from "@/modules/system-admin/dashboard";
import type { AreaClubSummary } from "@/modules/club-reports/area-summary-domain";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const now = new Date("2026-11-12T15:00:00Z");
const none: AdminRoles = { systemAdmin: false, clubsAdministrator: false, eventAdminEventIds: [] };
const system: AdminRoles = { ...none, systemAdmin: true };
const clubs: AdminRoles = { ...none, clubsAdministrator: true };
const events: AdminRoles = { ...none, eventAdminEventIds: ["evt_1"] };
const eventsAndClubs: AdminRoles = { ...none, clubsAdministrator: true, eventAdminEventIds: ["evt_1"] };

function source(patch: Partial<SystemAdminEventSource> & { id: string }): SystemAdminEventSource {
  return {
    slug: patch.id, name: `Event ${patch.id}`, startsAt: new Date("2026-12-01T15:00:00Z"), endsAt: new Date("2026-12-03T15:00:00Z"),
    timezone: "America/Chicago", location: null, capacity: 100, isPublished: true, archivedAt: null, lifecycleState: null,
    registrationOpensOn: null, registrationClosesOn: null, waitlistEnabled: false,
    registrations: [{ status: "CONFIRMED", totalAmountCents: 5000, payments: [] }], attendeeCount: 40, checkedInCount: 0,
    activeStaffCount: 0, publishedFormCount: 1, waitingCount: 0, importIssueCount: 0, importWarningCount: 0, deliveryIssueCount: 0,
    ...patch,
  };
}

function club(id: string, status: "SUBMITTED" | "LATE" | "DRAFT" | "MISSING" | "DUE" | "FUTURE"): AreaClubSummary {
  return {
    id, name: `Club ${id}`, church: "Test church", directors: [], rosterSize: 10, adultCount: 2, registrationOnTime: true,
    backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 }, months: [{ month: "2026-11", status, points: null }],
    submitted: 0, late: 0, drafts: 0, missing: 0, lastReportMonth: null, reportPoints: 0, eventPoints: 0, eventAwards: [], totalPoints: 0,
  } as AreaClubSummary;
}

describe("Events filling up model (#1705)", () => {
  it("shows spots taken, waitlist only when enabled, days to go, and no money", () => {
    const view = buildEventsFillingUp([
      source({ id: "a", attendeeCount: 40, capacity: 100, waitlistEnabled: true, waitingCount: 3 }),
      source({ id: "b", startsAt: new Date("2026-12-10T15:00:00Z"), endsAt: new Date("2026-12-11T15:00:00Z"), capacity: null, waitingCount: 9 }),
    ], now, false);
    expect(view.rows[0]).toMatchObject({ id: "a", takenText: "40 of 100 spots taken", percentTaken: 40, waitlist: 3, daysText: "19 days to go", href: "/overview?event=a" });
    expect(view.rows[1]).toMatchObject({ takenText: "40 registered, no limit", percentTaken: null, waitlist: null });
    expect(JSON.stringify(view)).not.toMatch(/cents|balance|paid|owed|\$/i);
    expect(view.footerLink.href).toBe("/events-admin");
  });

  it("lists at most five, soonest first, drops ended and archived, and links a system administrator to all events", () => {
    const many = Array.from({ length: 7 }, (_, at) => source({ id: `e${at}`, startsAt: new Date(Date.UTC(2026, 11, 20 - at)), endsAt: new Date(Date.UTC(2026, 11, 21 - at)) }));
    const view = buildEventsFillingUp([
      ...many,
      source({ id: "old", startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-02T00:00:00Z") }),
      source({ id: "archived", archivedAt: new Date("2026-09-01T00:00:00Z") }),
    ], now, true);
    expect(view.rows.map((row) => row.id)).toEqual(["e6", "e5", "e4", "e3", "e2"]);
    expect(view.footerLink.href).toBe("/admin/events");
    expect(buildEventsFillingUp([], now, false).rows).toEqual([]);
  });

  it("words days to go", () => {
    expect(daysToGoText("IN_PROGRESS", null)).toBe("Happening now");
    expect(daysToGoText("UPCOMING", 1)).toBe("1 day to go");
    expect(daysToGoText("UPCOMING", 0)).toBe("Starts today");
  });
});

describe("Season numbers model (#1705)", () => {
  it("buckets daily counts over 30 days, oldest first", () => {
    const counts = dailyCounts([now, new Date("2026-11-12T01:00:00Z"), new Date("2026-11-11T20:00:00Z"), new Date("2026-10-14T12:00:00Z"), new Date("2026-10-13T12:00:00Z"), new Date("2026-11-13T12:00:00Z")], now);
    expect(counts).toHaveLength(30);
    expect(counts[29]).toBe(2);
    expect(counts[28]).toBe(1);
    expect(counts[0]).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("builds tiles by what the person sees, with a trend summary", () => {
    const view = buildSeasonNumbers({ clubYear: "2026-27", events: { registrations: 12, people: 30, trend: [...new Array(29).fill(0), 14], href: "/events-admin" }, clubs: { count: 8 } });
    expect(view.tiles.map((tile) => [tile.key, tile.value])).toEqual([["registrations", 12], ["people", 30], ["clubs", 8]]);
    expect(view.trend?.text).toBe("14 new registrations in the last 30 days");
    const clubsOnly = buildSeasonNumbers({ clubYear: "2026-27", events: null, clubs: { count: 8 } });
    expect(clubsOnly.tiles.map((tile) => tile.key)).toEqual(["clubs"]);
    expect(clubsOnly.trend).toBeNull();
    expect(clubsOnly.trendUnavailable).toBe(false);
  });

  it("shows an unreadable number as unavailable, never zero", () => {
    const view = buildSeasonNumbers({ clubYear: "2026-27", events: { registrations: null, people: 0, trend: null, href: "/admin" }, clubs: { count: null } });
    expect(view.tiles.find((tile) => tile.key === "registrations")?.value).toBeNull();
    expect(view.tiles.find((tile) => tile.key === "people")?.value).toBe(0);
    expect(view.tiles.find((tile) => tile.key === "clubs")?.value).toBeNull();
    expect(view.trendUnavailable).toBe(true);
  });
});

describe("Monthly Records model (#1705)", () => {
  it("makes one conference-wide row for the report month that adds up to the clubs", () => {
    const view = buildMonthlyRecords([club("a", "SUBMITTED"), club("b", "LATE"), club("c", "DRAFT"), club("d", "MISSING"), club("e", "DUE")], "2026-27", now);
    expect(view.monthLabel).toBe("November 2026");
    expect(view.rows).toEqual([{ label: "All clubs", clubs: 5, submitted: 2, started: 1, notStarted: 2 }]);
    expect(view.href).toBe("/admin/clubs/reports");
  });

  it("handles no clubs", () => {
    expect(buildMonthlyRecords([], "2026-27", now).rows[0]).toMatchObject({ clubs: 0, submitted: 0, started: 0, notStarted: 0 });
  });
});

describe("Quick links (#1705)", () => {
  it("lists only pages the person can open", () => {
    expect(usableQuickLinks(none)).toEqual([]);
    expect(usableQuickLinks(events).map((l) => l.key)).toEqual(["help", "coming-up", "events-admin"]);
    expect(usableQuickLinks(clubs).map((l) => l.key)).toEqual(["help", "coming-up", "clubs-admin", "clubs-summary", "monthly-records", "club-applications"]);
    expect(usableQuickLinks(system).map((l) => l.key)).toContain("analytics");
    expect(usableQuickLinks(events).map((l) => l.key)).not.toContain("analytics");
  });

  it("starts with the landing page of each held role, then Help", () => {
    expect(defaultQuickLinkKeys(events)).toEqual(["events-admin", "help"]);
    expect(defaultQuickLinkKeys(eventsAndClubs)).toEqual(["events-admin", "clubs-admin", "help"]);
    expect(defaultQuickLinkKeys(system)).toEqual(["system-hub", "clubs-admin", "help"]);
    expect(defaultQuickLinkKeys(none)).toEqual([]);
  });

  it("drops unknown, unusable and repeated keys and caps the list", () => {
    expect(cleanQuickLinkKeys(["help", "nope", "analytics", "help", 4], events)).toEqual(["help"]);
    expect(cleanQuickLinkKeys("x", events)).toBeNull();
    expect(cleanQuickLinkKeys(Array.from({ length: 40 }, () => "help"), system)).toEqual(["help"]);
    expect(QUICK_LINKS_MAX).toBe(12);
  });

  it("keeps picks on the saved entry, sanitizes them on save and read, and defaults when none are saved", () => {
    const saved = [{ key: "needs-you", shown: true }, { key: "quick-links", shown: true, links: ["coming-up", "analytics", "help"] }];
    const stored = sanitizeHomeLayoutInput(saved, events)!;
    expect(stored.find((entry) => entry.key === "quick-links")).toEqual({ key: "quick-links", shown: true, links: ["coming-up", "help"] });
    const layout = resolveHomeLayout(saved, events);
    expect(layout.modules.find((m) => m.key === "quick-links")?.links).toEqual(["coming-up", "help"]);
    expect(resolveHomeLayout(null, events).modules.find((m) => m.key === "quick-links")?.links).toEqual(["events-admin", "help"]);
    const empty = resolveHomeLayout([{ key: "quick-links", shown: true, links: [] }], events);
    expect(empty.modules.find((m) => m.key === "quick-links")?.links).toEqual([]);
    expect(stored.find((entry) => entry.key === "needs-you")).toEqual({ key: "needs-you", shown: true });
  });

  it("renders the card with links, and an empty message with a button", async () => {
    const { StaffHomeBoard } = await import("@/components/staff-home-board");
    const options = usableQuickLinks(events).map(({ key, label, href }) => ({ key, label, href }));
    const modules = resolveHomeLayout(null, events).modules.map((m) => (m.key === "quick-links" ? { ...m, shown: true } : m));
    const withLinks = renderToStaticMarkup(createElement(StaffHomeBoard, { modules, bodies: {}, quickLinkOptions: options }));
    expect(withLinks).toContain('data-testid="home-quick-links"');
    expect(withLinks).toContain('href="/events-admin"');
    const emptied = modules.map((m) => (m.key === "quick-links" ? { ...m, links: [] } : m));
    const html = renderToStaticMarkup(createElement(StaffHomeBoard, { modules: emptied, bodies: {}, quickLinkOptions: options }));
    expect(html).toContain('data-testid="home-quick-links-empty"');
    expect(html).toContain(">Choose links<");
  });
});

// Scope: mocked reads that record what they were asked.
const dashboardCalls: Array<{ eventIds?: readonly string[]; endsOnOrAfter?: Date }> = [];
const prismaCalls: Array<{ op: string; where: unknown }> = [];
const summaryCalls: string[] = [];
let failing = new Set<string>();
vi.mock("@/lib/logger", async (original) => ({ ...(await original<typeof import("@/lib/logger")>()), logError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    registration: {
      count: async (args: { where: unknown }) => { prismaCalls.push({ op: "registration.count", where: args.where }); if (failing.has("registration.count")) throw new Error("down"); return 12; },
      findMany: async (args: { where: unknown }) => { prismaCalls.push({ op: "registration.findMany", where: args.where }); return [{ createdAt: new Date("2026-11-12T10:00:00Z") }, { createdAt: new Date("2026-11-11T10:00:00Z") }]; },
    },
    registrationAttendee: { count: async (args: { where: unknown }) => { prismaCalls.push({ op: "attendee.count", where: args.where }); return 30; } },
  }),
}));
vi.mock("@/modules/system-admin/repository", () => ({
  findDashboardEvents: async (_prisma: unknown, filter: { eventIds?: readonly string[]; endsOnOrAfter?: Date }) => {
    dashboardCalls.push(filter);
    if (failing.has("dashboard")) throw new Error("down");
    return [source({ id: "evt_1" })];
  },
  toDashboardEventSource: (row: SystemAdminEventSource) => row,
}));
vi.mock("@/modules/club-reports/area-summary-repository", () => ({
  getAreaClubsSummary: async (year: string) => { summaryCalls.push(year); if (failing.has("summary")) throw new Error("down"); return [club("a", "SUBMITTED"), club("b", "DRAFT")]; },
}));

const { loadHomeModules } = await import("@/modules/system-admin/home-modules-repository");
const all = new Set<HomeModuleKey>(["needs-you", "coming-up", "events-filling-up", "season-numbers", "monthly-records", "quick-links"]);

beforeEach(() => { dashboardCalls.length = 0; prismaCalls.length = 0; summaryCalls.length = 0; failing = new Set(); });

describe("Home module reads and scope (#1705)", () => {
  it("reads an Events admin's own event only", async () => {
    const data = await loadHomeModules(events, all, now);
    expect(dashboardCalls).toEqual([{ eventIds: ["evt_1"], endsOnOrAfter: now }]);
    expect(prismaCalls.length).toBeGreaterThan(0);
    for (const call of prismaCalls) expect(JSON.stringify(call.where)).toContain('"id":{"in":["evt_1"]}');
    expect(summaryCalls).toEqual([]);
    expect(data["monthly-records"]).toBeUndefined();
    expect(data["season-numbers"]?.tiles.map((tile) => tile.key)).toEqual(["registrations", "people"]);
    expect(data["season-numbers"]?.trend?.total).toBe(2);
    expect(data["events-filling-up"]?.rows.map((row) => row.id)).toEqual(["evt_1"]);
  });

  it("reads every event for a system administrator, and the club summary once", async () => {
    const data = await loadHomeModules(system, all, now);
    expect(dashboardCalls[0]!.eventIds).toBeUndefined();
    for (const call of prismaCalls) expect(JSON.stringify(call.where)).not.toContain('"id":{"in"');
    expect(summaryCalls).toEqual(["2026-27"]);
    expect(data["season-numbers"]?.tiles.map((tile) => tile.key)).toEqual(["registrations", "people", "clubs"]);
    expect(data["monthly-records"]?.rows[0]).toMatchObject({ submitted: 1, started: 1 });
  });

  it("never reads events for a Clubs admin", async () => {
    const data = await loadHomeModules(clubs, all, now);
    expect(dashboardCalls).toEqual([]);
    expect(prismaCalls).toEqual([]);
    expect(data["events-filling-up"]).toBeUndefined();
    expect(data["season-numbers"]?.tiles.map((tile) => tile.key)).toEqual(["clubs"]);
    expect(data["monthly-records"]?.rows).toHaveLength(1);
  });

  it("gives Events and Clubs each their own reads", async () => {
    const data = await loadHomeModules(eventsAndClubs, all, now);
    expect(dashboardCalls).toEqual([{ eventIds: ["evt_1"], endsOnOrAfter: now }]);
    expect(summaryCalls).toHaveLength(1);
    expect(data["season-numbers"]?.tiles.map((tile) => tile.key)).toEqual(["registrations", "people", "clubs"]);
  });

  it("reads nothing for a person with no admin role", async () => {
    expect(await loadHomeModules(none, all, now)).toEqual({});
    expect(dashboardCalls).toEqual([]);
    expect(prismaCalls).toEqual([]);
    expect(summaryCalls).toEqual([]);
  });

  it("reads only the modules turned on", async () => {
    const data = await loadHomeModules(system, new Set<HomeModuleKey>(["monthly-records"]), now);
    expect(Object.keys(data)).toEqual(["monthly-records"]);
    expect(dashboardCalls).toEqual([]);
    expect(prismaCalls).toEqual([]);
  });

  it("shows a failed read as unavailable, never as zero", async () => {
    failing = new Set(["dashboard", "summary", "registration.count"]);
    const data = await loadHomeModules(system, all, now);
    expect(data["events-filling-up"]).toBeNull();
    expect(data["monthly-records"]).toBeNull();
    const tiles = data["season-numbers"]!.tiles;
    expect(tiles.find((tile) => tile.key === "registrations")?.value).toBeNull();
    expect(tiles.find((tile) => tile.key === "clubs")?.value).toBeNull();
    expect(tiles.find((tile) => tile.key === "people")?.value).toBe(30);
  });

  it("skips a saved module the person can no longer use", () => {
    const layout = resolveHomeLayout([{ key: "monthly-records", shown: true }, { key: "needs-you", shown: true }, { key: "events-filling-up", shown: true }], events);
    expect(layout.modules.map((m) => m.key)).not.toContain("monthly-records");
    expect(layout.modules.map((m) => m.key)).toContain("events-filling-up");
    expect(resolveHomeLayout([{ key: "events-filling-up", shown: true }, { key: "needs-you", shown: true }], clubs).modules.map((m) => m.key)).not.toContain("events-filling-up");
    expect(resolveHomeLayout(null, none).modules).toEqual([]);
  });
});
