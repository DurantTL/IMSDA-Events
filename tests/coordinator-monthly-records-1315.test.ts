import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coordinator Monthly Records by month (#1315). Synthetic clubs and people only.
 */
const mocks = vi.hoisted(() => ({
  areaGrantFindUnique: vi.fn(),
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  currentStaffActingContext: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  getAreaClubsSummary: vi.fn(),
  listAreaClubEvents: vi.fn(),
  listCoordinatorTeamPermissions: vi.fn(),
  getTeamSettings: vi.fn(),
  currentApplicationViewer: vi.fn(),
  listNewClubApplications: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: vi.fn(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/account/area-clubs/reports",
}));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ areaCoordinatorGrant: { findUnique: mocks.areaGrantFindUnique } }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/club-reports/area-summary-repository", () => ({ getAreaClubsSummary: mocks.getAreaClubsSummary, listAreaClubEvents: mocks.listAreaClubEvents }));
vi.mock("@/modules/club-teams/permission-repository", () => ({ listCoordinatorTeamPermissions: mocks.listCoordinatorTeamPermissions }));
vi.mock("@/modules/club-teams/settings-repository", () => ({ getTeamSettings: mocks.getTeamSettings }));
vi.mock("@/modules/club-applications/viewer", () => ({ currentApplicationViewer: mocks.currentApplicationViewer }));
vi.mock("@/modules/club-applications/repository", () => ({ listNewClubApplications: mocks.listNewClubApplications }));

import MonthlyRecordsPage from "@/app/(public)/account/(portal)/area-clubs/reports/page";
import { summarizeClub, type AreaClubSummary, type AreaSummaryInput } from "@/modules/club-reports/area-summary-domain";
import {
  coordinatorMonthRows,
  coordinatorRecordsHref,
  resolveRecordsMonth,
} from "@/modules/club-reports/coordinator-destinations-domain";

const clubYear = "2026-27";
const noChecks = { missing: 0, notInCompliance: 0, expiringSoon: 0 };
const now = new Date("2026-11-15T15:00:00Z");

function club(id: string, name: string, over: Partial<AreaSummaryInput> = {}): AreaClubSummary {
  return summarizeClub({ id, name, church: `${name} Church`, directors: ["Dana Sample"], rosterSize: 10, adultCount: 3, registrationOnTime: true, backgroundChecks: noChecks, reports: [], ...over }, clubYear, now);
}
const filed = (month: string, onTime = 25, reviewedAt: Date | null = new Date("2026-11-01T00:00:00Z")) => ({ reportMonth: month, status: "SUBMITTED" as const, totalPoints: 100, onTimePoints: onTime, reviewedAt });
const draft = (month: string) => ({ reportMonth: month, status: "DRAFT" as const, totalPoints: 0, onTimePoints: 0 });

// Twelve clubs. October (ended, due Nov 10): Alpha, Bravo (late), Charlie submitted and reviewed; Delta has a draft; the rest filed nothing.
function makeClubs() {
  return [
    club("c01", "Alpha Club", { reports: [filed("2026-10")] }),
    club("c02", "Bravo Club", { reports: [filed("2026-10", 0)] }),
    club("c03", "Charlie Club", { reports: [filed("2026-10"), filed("2026-09")] }),
    club("c04", "Delta Club", { reports: [draft("2026-10")] }),
    ...["Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima"].map((name, i) => club(`c${String(i + 5).padStart(2, "0")}`, `${name} Club`)),
  ];
}

const mocksFor = () => {
  vi.clearAllMocks();
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1", displayName: "Sample Coordinator" }, via: "attendee", sessionId: "s1" });
  mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getAreaClubsSummary.mockResolvedValue(makeClubs());
};

const page = async (params: Record<string, string | undefined> = {}) => renderToStaticMarkup(await MonthlyRecordsPage({ searchParams: Promise.resolve({ year: clubYear, ...params }) }));
/** The month view's table only (the full-year grid sits in a <details> after it). */
const monthTable = (html: string) => { const start = html.indexOf("Clubs and their"); return html.slice(start, html.indexOf("<details", start)); };
const rowNames = (html: string) => [...monthTable(html).matchAll(/<span translate="no">([^<]+)<\/span>/g)].map((match) => match[1]).filter((name) => name!.endsWith(" Club"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocksFor();
});
afterEach(() => vi.useRealTimers());

describe("Monthly Records by month (#1315)", () => {
  it("opens on the current report month and marks it in the picker", async () => {
    const html = await page();
    expect(html).toContain('<nav aria-label="Report month"');
    expect(html).toMatch(/aria-current="page"[^>]*>(?:(?!<\/a>)[\s\S])*Nov/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain("November 2026");
    expect(html).toContain("Nov record");
  });

  it("?month= selects a month and keeps the search and year in the picker links", async () => {
    const html = await page({ month: "2026-10", q: "club" });
    expect(html).toContain("October 2026");
    expect(html).toContain("Oct record");
    expect(html).toContain('href="/account/area-clubs/reports?year=2026-27&amp;month=2026-09&amp;q=club"');
    expect(html).toMatch(/<input[^>]*name="month"[^>]*value="2026-10"|<input[^>]*value="2026-10"[^>]*name="month"/);
    expect(resolveRecordsMonth(clubYear, "2027-02", now)).toBe("2027-02");
  });

  it("falls back to the current month when ?month= is not a month of the club year", async () => {
    for (const bad of ["2025-12", "2026-13", "junk", "2027-09"]) {
      expect(resolveRecordsMonth(clubYear, bad, now)).toBe("2026-11");
    }
    expect(await page({ month: "junk" })).toContain("Nov record");
    // A past club year opens on its last month.
    expect(resolveRecordsMonth("2024-25", undefined, now)).toBe("2025-08");
  });

  it("shows 10 rows and a Show all link, and ?all=1 shows every club with Show fewer", async () => {
    const limited = await page({ month: "2026-10", q: "club" });
    expect(rowNames(limited)).toHaveLength(10);
    expect(limited).toContain("Show all 12 clubs");
    expect(limited).toContain('href="/account/area-clubs/reports?year=2026-27&amp;month=2026-10&amp;q=club&amp;all=1"');
    const all = await page({ month: "2026-10", q: "club", all: "1" });
    expect(rowNames(all)).toHaveLength(12);
    expect(all).toContain("Show fewer");
    expect(all).not.toContain("Show all 12 clubs");
    // No link when 10 or fewer clubs match.
    expect(await page({ month: "2026-10", q: "alpha" })).not.toContain("Show all");
  });

  it("orders Not submitted, then Not due yet, then Submitted, keeping the club order within each", async () => {
    const rows = coordinatorMonthRows(makeClubs(), "2026-10", now).map((row) => `${row.id}:${row.status.state}`);
    expect(rows).toEqual([
      "c04:NOT_SUBMITTED", "c05:NOT_SUBMITTED", "c06:NOT_SUBMITTED", "c07:NOT_SUBMITTED", "c08:NOT_SUBMITTED", "c09:NOT_SUBMITTED", "c10:NOT_SUBMITTED", "c11:NOT_SUBMITTED", "c12:NOT_SUBMITTED",
      "c01:SUBMITTED", "c02:SUBMITTED", "c03:SUBMITTED",
    ]);
    const future = coordinatorMonthRows(makeClubs(), "2027-03", now);
    expect(future.every((row) => row.status.state === "NOT_DUE")).toBe(true);
    const html = await page({ month: "2026-10", all: "1" });
    expect(rowNames(html)[0]).toBe("Delta Club");
    expect(rowNames(html).slice(-3)).toEqual(["Alpha Club", "Bravo Club", "Charlie Club"]);
  });

  it("shows each status as an icon and a word, with draft and late details", async () => {
    const table = monthTable(await page({ month: "2026-10", all: "1" }));
    expect(table).toContain("✓");
    expect(table).toContain("✕");
    expect(table).toMatch(/Submitted<small> \(late\)<\/small>/);
    expect(table).toMatch(/Not submitted<small> \(draft saved\)<\/small>/);
    const future = monthTable(await page({ month: "2027-03" }));
    expect(future).toContain("○");
    expect(future).toContain("Not due yet");
  });

  it("links Submitted to the unchanged record address and every other row to the club", async () => {
    const table = monthTable(await page({ month: "2026-10", all: "1" }));
    expect(table).toContain('href="/account/area/c01/reports/2026-10"');
    expect(table).toContain("Open record");
    expect(table).toContain("Opens the record, view only.");
    expect(table).toContain('href="/account/area/c04"');
    expect(table).toContain("Open club");
    expect(table.match(/\/reports\/2026-10/g)).toHaveLength(3);
    expect(coordinatorRecordsHref({ clubYear, month: "2026-10" })).toBe("/account/area-clubs/reports?year=2026-27&month=2026-10");
  });

  it("keeps the full-year grid in a collapsed details with every existing record link", async () => {
    const html = await page({ month: "2026-10" });
    const details = html.slice(html.indexOf("<details", html.indexOf("Clubs and their")));
    expect(details).toContain("<summary>Full-year grid</summary>");
    expect(details).not.toMatch(/^<details[^>]* open/);
    expect(details).toContain('href="/account/area/c03/reports/2026-09"');
    expect(details).toContain('href="/account/area/c03/reports/2026-10"');
  });

  it("summarises the month in coordinator words, with the late and draft counts", async () => {
    const html = await page({ month: "2026-10" });
    expect(html).toContain("of 12 clubs, 1 late");
    expect(html).toContain("1 draft saved");
    const notEnded = await page({ month: "2026-12" });
    expect(notEnded).toContain("Month not ended; due January 10");
  });

  it("sends no Reviewed data or wording to the page, even when records are reviewed", async () => {
    const clubs = makeClubs();
    expect(clubs.some((entry) => entry.months.some((cell) => cell.reviewed === true))).toBe(true);
    for (const params of [{}, { month: "2026-10" }, { month: "2026-10", all: "1" }, { month: "2026-09", q: "charlie" }]) {
      const html = await page(params);
      expect(html).not.toMatch(/eviewed|To review/);
    }
  });

  it("charts only Submitted, Not submitted and Not due yet", async () => {
    const html = await page({ month: "2026-10" });
    const chart = html.slice(html.indexOf("<figure"), html.indexOf("</figure>"));
    expect(chart).toContain("Submitted");
    expect(chart).toContain("Not submitted");
    expect(chart).toContain("Not due yet");
    expect(chart).not.toMatch(/eviewed|Due or upcoming|Missing/);
  });

  it("keeps the empty and no-match states and drops the month view for them", async () => {
    const none = await page({ q: "zzz" });
    expect(none).toContain("No club name matches");
    expect(none).not.toContain("Report month");
    mocks.getAreaClubsSummary.mockResolvedValue([]);
    const empty = await page();
    expect(empty).toContain("No active clubs are available to this role yet.");
  });

  it("keeps the failed read as unavailable", async () => {
    mocks.getAreaClubsSummary.mockRejectedValue(new Error("db down"));
    const html = await page();
    expect(html).toContain("is unavailable");
    expect(html).not.toMatch(/Report month|Submitted/);
  });
});
