import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coordinator workspace A (#1186): masthead, task navigation, Overview with an
 * honest scope, counts and export label. Synthetic clubs and people only.
 */
const mocks = vi.hoisted(() => ({
  areaGrantFindUnique: vi.fn(),
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  currentStaffActingContext: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  getAreaClubsSummary: vi.fn(),
  listUpcomingDeadlines: vi.fn(),
  listClubsNewYearStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: vi.fn(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/account/area-clubs/overview",
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ areaCoordinatorGrant: { findUnique: mocks.areaGrantFindUnique } }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/calendar/deadline-list", () => ({ listUpcomingDeadlines: mocks.listUpcomingDeadlines }));
vi.mock("@/modules/club-rosters/carry-forward", () => ({ listClubsNewYearStatus: mocks.listClubsNewYearStatus }));
vi.mock("@/modules/club-reports/area-summary-repository", () => ({ getAreaClubsSummary: mocks.getAreaClubsSummary, listAreaClubEvents: vi.fn() }));

import OverviewPage from "@/app/(public)/account/(portal)/area-clubs/overview/page";
import { GET as AREA_EXPORT } from "@/app/api/attendee/area-clubs/export/route";
import { coordinatorNavItems } from "@/components/area-clubs-subnav";
import { CoordinatorOverviewBody, CoordinatorOverviewHeading, type CoordinatorOverviewData } from "@/components/coordinator-overview";
import { CoordinatorMastheadView, coordinatorMastheadModel } from "@/components/coordinator-masthead-view";
import { isAccountNavItemActive } from "@/components/account-section-nav";
import { summarizeClub, type AreaClubSummary, type AreaSummaryInput } from "@/modules/club-reports/area-summary-domain";
import {
  buildCoordinatorOverview,
  clubRecordStatus,
  fullYearExportLabel,
  overviewMonth,
} from "@/modules/club-reports/coordinator-overview-domain";

const now = new Date("2026-10-24T15:00:00Z");
const clubYear = "2026-27";
const noChecks = { missing: 0, notInCompliance: 0, expiringSoon: 0 };

function club(id: string, name: string, over: Partial<AreaSummaryInput> = {}): AreaClubSummary {
  return summarizeClub({
    id, name, church: `${name} Church`, directors: ["Dana Sample"], rosterSize: 10, adultCount: 3, registrationOnTime: true, backgroundChecks: noChecks, reports: [],
    ...over,
  }, clubYear, now);
}
const submitted = (month: string, onTime = 25) => ({ reportMonth: month, status: "SUBMITTED" as const, totalPoints: 100, onTimePoints: onTime });

const six = [
  club("c1", "Alpha Club", { reports: [submitted("2026-10")] }),
  club("c2", "Bravo Club", { reports: [submitted("2026-10")] }),
  club("c3", "Charlie Club", { reports: [submitted("2026-10", 0)] }),
  club("c4", "Delta Club", { reports: [{ reportMonth: "2026-10", status: "DRAFT", totalPoints: 0, onTimePoints: 0 }] }),
  club("c5", "Echo Club"),
  club("c6", "Foxtrot Club", { directors: [], rosterSize: 9, adultCount: 2 }),
];

const ready = (clubs: AreaClubSummary[]): CoordinatorOverviewData => ({ status: "ready", clubs, overview: buildCoordinatorOverview(clubs, clubYear, now) });
const render = (data: CoordinatorOverviewData, query = "") => renderToStaticMarkup(createElement(CoordinatorOverviewBody, { data, query }));
const props = { searchParams: Promise.resolve({}) };

describe("overview numbers come from the clubs the owning query returned (#1186)", () => {
  it("states the month, the denominator and the roster total for several clubs", () => {
    const overview = buildCoordinatorOverview(six, clubYear, now);
    expect(overview.month).toBe("2026-10");
    expect(overview.activeClubs).toBe(6);
    expect(overview.recordsText).toBe("3 of 6 October records");
    expect(overview.rosterMembers).toBe(10 * 5 + 9);
    expect(overview.followUp.map((entry) => entry.name)).toEqual(["Delta Club", "Echo Club", "Foxtrot Club"]);
  });

  it("handles no clubs without inventing records", () => {
    const overview = buildCoordinatorOverview([], clubYear, now);
    expect(overview).toMatchObject({ activeClubs: 0, submittedCount: 0, recordDenominator: 0, rosterMembers: 0, recordsText: "0 of 0 October records" });
    expect(overview.followUp).toEqual([]);
  });

  it("treats no reports at all as Not submitted for every club, not Submitted", () => {
    const none = [club("a", "Alpha Club"), club("b", "Bravo Club")];
    const overview = buildCoordinatorOverview(none, clubYear, now);
    expect(overview.submittedCount).toBe(0);
    expect(overview.followUp).toHaveLength(2);
    expect(none.map((entry) => clubRecordStatus(entry, "2026-10").label)).toEqual(["Not submitted", "Not submitted"]);
  });

  it("mixes submitted, late, draft and missing months for one month", () => {
    expect(clubRecordStatus(six[0]!, "2026-10")).toEqual({ state: "SUBMITTED", label: "Submitted", detail: null });
    expect(clubRecordStatus(six[2]!, "2026-10")).toEqual({ state: "SUBMITTED", label: "Submitted", detail: "late" });
    expect(clubRecordStatus(six[3]!, "2026-10")).toEqual({ state: "NOT_SUBMITTED", label: "Not submitted", detail: "draft saved" });
    // The same club asked about a different month is judged on that month alone.
    expect(clubRecordStatus(six[0]!, "2026-09").state).toBe("NOT_SUBMITTED");
  });

  it("names the month inside the viewed club year, and clamps outside it", () => {
    expect(overviewMonth("2026-27", new Date("2026-10-24T12:00:00Z"))).toBe("2026-10");
    expect(overviewMonth("2025-26", new Date("2026-10-24T12:00:00Z"))).toBe("2026-08");
    expect(overviewMonth("2027-28", new Date("2026-10-24T12:00:00Z"))).toBe("2027-09");
  });

  it("lists nothing as missing for a month that is not yet due", () => {
    const future = [club("a", "Alpha Club")].map((entry) => summarizeClub({ ...entry, reports: [] }, "2027-28", now));
    const overview = buildCoordinatorOverview(future, "2027-28", now);
    expect(overview.monthNotDue).toBe(true);
    expect(overview.followUp).toEqual([]);
    expect(render({ status: "ready", clubs: future, overview })).toContain("is not due yet");
  });
});

describe("overview markup (#1186)", () => {
  it("shows the heading, the queried year and the honest scope, and claims no ministry or area filter", () => {
    const out = renderToStaticMarkup(createElement(CoordinatorOverviewHeading, { clubYear }));
    expect(out).toContain("Club overview");
    expect(out).toContain("2026-27");
    expect(out).toContain("All active clubs available to this role");
    expect(out).not.toMatch(/ministry|area filter/i);
  });

  it("shows the summary, the table columns, director names and labelled screening counts", () => {
    const out = render(ready(six));
    expect(out).toContain("3 of 6 October records");
    expect(out).toContain("Active clubs");
    for (const column of ["Club / church", "Roster", "Adults", "October 2026 record", "Sterling Volunteers", "Open club"]) expect(out).toContain(column);
    expect(out).toContain("Director: Dana Sample");
    expect(out).toContain("Director: none listed");
    expect(out).toContain("0 not in compliance");
    expect(out).toContain('href="/account/area/c1"');
    expect(out).toContain("6 of 6 clubs shown");
    expect(out).not.toMatch(/background check/i);
  });

  it("keeps sensitive detail out of the cross-club view", () => {
    expect(render(ready(six))).not.toMatch(/birth|DOB|medical|allerg|phone|email|@/i);
  });

  it("filters the table by search while the summary and follow-up stay whole, with N of M shown", () => {
    const out = render(ready(six), "bra");
    expect(out).toContain("1 of 6 clubs shown");
    expect(out).toContain("Bravo Club");
    expect(out).not.toContain('href="/account/area/c1"');
    expect(out).toContain("3 of 6 October records");
    expect(out).toContain("3 of 6 clubs have no submitted October 2026 record");
    expect(out).toContain("0 of 3 listed below match");
    expect(out).not.toContain("Echo Club");
  });

  it("offers Clear search for a search with no results, and says that differently from no clubs", () => {
    const none = render(ready(six), "zzz");
    expect(none).toContain("No club name matches");
    expect(none).toContain("Clear search");
    expect(none).toContain('href="/account/area-clubs/overview?year=2026-27"');
    expect(none).toContain("0 of 6 clubs shown");
    const empty = render(ready([]));
    expect(empty).toContain("No active clubs are available to this role yet.");
    expect(empty).not.toContain("No club name matches");
    expect(empty).not.toContain("Clear search");
  });

  it("labels the full-year export and keeps it independent of the search", () => {
    expect(fullYearExportLabel(clubYear)).toBe("Full-year CSV — all available clubs, 2026-27");
    for (const query of ["", "bra", "zzz"]) {
      const out = render(ready(six), query);
      expect(out).toContain("Full-year CSV — all available clubs, 2026-27");
      expect(out).toContain('href="/api/attendee/area-clubs/export?report=summary&amp;year=2026-27"');
      expect(out).not.toMatch(/export\?[^"]*q=/);
    }
  });

  it("copes with long club, church and director names", () => {
    const long = club("long", "The Extraordinarily Long Named Pathfinder and Adventurer Club of Sample Valley Heights", {
      church: "An Equally Long Sponsoring Church Name for Layout Testing", directors: ["Alexandria Bartholomew-Longname", "Second Director"],
    });
    const out = render(ready([long]));
    expect(out).toContain("Extraordinarily Long Named");
    expect(out).toContain("Alexandria Bartholomew-Longname, Second Director");
  });

  it("states the read-only role and points to the director", () => {
    const out = render(ready(six));
    expect(out).toContain("Your role is read-only");
    expect(out).toContain("club director maintains the roster");
    expect(out).toContain("For information only. This page sets no deadline and sends no messages.");
    expect(out).toContain('href="/account/area-clubs/reports?year=2026-27"');
  });

  it("shows unavailable with a retry, and no count, for a failed read", () => {
    const out = render({ status: "unavailable" });
    expect(out).toContain("is unavailable");
    expect(out).toContain("Retry");
    expect(out).not.toMatch(/\d+ of \d+|Submitted|Active clubs/);
  });
});

describe("overview page (#1186)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1", displayName: "Sample Coordinator" }, via: "attendee", sessionId: "s1" });
    mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
    mocks.accountNeedsSecondStep.mockResolvedValue("OK");
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getAreaClubsSummary.mockResolvedValue(six);
    mocks.listUpcomingDeadlines.mockResolvedValue([]);
    mocks.listClubsNewYearStatus.mockResolvedValue(null);
  });

  it("renders the summary for the queried year", async () => {
    const out = renderToStaticMarkup(await OverviewPage({ searchParams: Promise.resolve({ year: "2026-27" }) }));
    expect(out).toContain("Club overview");
    expect(mocks.getAreaClubsSummary).toHaveBeenCalledWith("2026-27");
  });

  it("shows unavailable, never zero clubs or Submitted, when the summary read fails", async () => {
    mocks.getAreaClubsSummary.mockRejectedValue(new Error("db down"));
    const out = renderToStaticMarkup(await OverviewPage(props));
    expect(out).toContain("is unavailable");
    expect(out).toContain("Retry");
    expect(out).not.toMatch(/0 of 0|No active clubs|Submitted/);
  });

  it.each([
    ["a revoked grant", () => mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: new Date("2026-01-01"), expiresAt: null })],
    ["a pending second step", () => mocks.accountNeedsSecondStep.mockResolvedValue("VERIFY")],
    ["a non-coordinator", () => mocks.areaGrantFindUnique.mockResolvedValue(null)],
  ])("refuses %s before reading any club data", async (_label, arrange) => {
    arrange();
    await expect(OverviewPage(props)).rejects.toThrow("NOT_FOUND");
    expect(mocks.getAreaClubsSummary).not.toHaveBeenCalled();
  });
});

describe("export scope (#1186)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1" }, via: "attendee", sessionId: "s1" });
    mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
    mocks.accountNeedsSecondStep.mockResolvedValue("OK");
    mocks.currentStaffActingContext.mockResolvedValue(null);
    mocks.getAreaClubsSummary.mockResolvedValue(six);
  });

  it("exports every club for the year whatever search text is on the address", async () => {
    const response = await AREA_EXPORT(new Request("https://events.example.test/api/attendee/area-clubs/export?report=summary&year=2026-27&q=bra"));
    const csv = await response.text();
    expect(mocks.getAreaClubsSummary).toHaveBeenCalledWith("2026-27", expect.any(Date), { backgroundChecks: false });
    for (const name of ["Alpha Club", "Bravo Club", "Charlie Club", "Delta Club", "Echo Club", "Foxtrot Club"]) expect(csv).toContain(name);
  });

  it("still refuses a revoked grant", async () => {
    mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: new Date("2026-01-01"), expiresAt: null });
    expect((await AREA_EXPORT(new Request("https://events.example.test/api/attendee/area-clubs/export"))).status).toBe(404);
    expect(mocks.getAreaClubsSummary).not.toHaveBeenCalled();
  });
});

describe("coordinator masthead and navigation (#1186, #442)", () => {
  const base = { account: { displayName: "Sample Coordinator" }, secondStepPending: false, actingAs: false, isCoordinator: true, signOut: "attendee" as const };
  const html = (over: Partial<Parameters<typeof coordinatorMastheadModel>[0]> = {}) =>
    renderToStaticMarkup(createElement(CoordinatorMastheadView, { model: coordinatorMastheadModel({ ...base, ...over }) }));

  it("shows the IMSDA identity, Club coordination, the person and the coordinator role", () => {
    const out = html();
    expect(out).toContain("IMSDA Events");
    expect(out).toContain("Club coordination");
    expect(out).toContain("Sample Coordinator");
    expect(out).toContain("Area Coordinator");
    expect(out).toContain('href="/account"');
  });

  it("shows no identity during a staff act-as, and says so", () => {
    const out = html({ actingAs: true, signOut: "none" });
    expect(out).toContain("Acting as Area Coordinator");
    expect(out).not.toContain("Sample Coordinator");
    expect(out).not.toContain("My account");
    expect(out).not.toContain("Sign out");
    expect(coordinatorMastheadModel({ ...base, actingAs: true }).showWaitlists).toBe(false);
  });

  it("shows no identity while the second step is pending", () => {
    const out = html({ secondStepPending: true });
    expect(out).not.toContain("Sample Coordinator");
    expect(out).not.toContain("My account");
  });

  it("has no staff or system links and no role picker", () => {
    for (const over of [{}, { actingAs: true }, { secondStepPending: true }]) {
      expect(html(over)).not.toMatch(/href="\/(admin|overview|system|staff)|<select|role picker/i);
    }
  });

  it("lists the seven destinations with Overview first, keeping every route", () => {
    const items = coordinatorNavItems();
    expect(items.map((item) => item.label)).toEqual(["Overview", "All clubs", "Monthly Records", "Points", "Club events", "Team approvals", "New clubs"]);
    expect(items.map((item) => item.href)).toEqual([
      "/account/area-clubs/overview", "/account/clubs", "/account/area-clubs/reports", "/account/area-clubs/points",
      "/account/area-clubs/events", "/account/area-clubs/team-permissions", "/account/area-clubs/applications",
    ]);
  });

  it("adds Waitlists only when the owner rule allows it", () => {
    expect(coordinatorNavItems().some((item) => item.label === "Waitlists")).toBe(false);
    expect(coordinatorNavItems({ showWaitlists: true }).at(-1)).toEqual({ href: "/account/waitlists", label: "Waitlists" });
    expect(coordinatorMastheadModel({ ...base }).showWaitlists).toBe(true);
    expect(coordinatorMastheadModel({ ...base, isCoordinator: false }).showWaitlists).toBe(false);
    expect(coordinatorMastheadModel({ ...base, secondStepPending: true }).showWaitlists).toBe(false);
  });

  it("shows the active destination, including a coordinator's club pages under All clubs", () => {
    const items = coordinatorNavItems();
    const active = (path: string) => items.filter((item) => isAccountNavItemActive(path, item)).map((item) => item.label);
    expect(active("/account/area-clubs/overview")).toEqual(["Overview"]);
    expect(active("/account/area/club_1")).toEqual(["All clubs"]);
    expect(active("/account/area/club_1/reports/2026-10")).toEqual(["All clubs"]);
    expect(active("/account/area-clubs/reports")).toEqual(["Monthly Records"]);
  });

  it("resolves identity from the same act-as and second-step signals as the portal layout", () => {
    const source = readFileSync("components/coordinator-shell-header.tsx", "utf8");
    expect(source).toContain("accountNeedsSecondStep");
    expect(source).toContain("currentStaffActingContext");
    expect(source).toContain("isAreaCoordinator");
  });
});

describe("coordinator CSS (#1186)", () => {
  const css = readFileSync("app/globals.css", "utf8");
  it("sits before the builder editor shell and form settings blocks and uses no :hover", () => {
    const start = css.indexOf("/* Coordinator workspace (#1186)");
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(css.indexOf("/* Registration form builder editor shell (#1132)"));
    expect(start).toBeLessThan(css.indexOf("/* Form settings tab"));
    const block = css.slice(start, css.indexOf("/* Registration form builder editor shell (#1132)"));
    expect(block).not.toContain(":hover");
    expect(block).not.toMatch(/background check/i);
    expect(css).toContain(".account-portal:has(.coordinator-shell)");
  });
});
