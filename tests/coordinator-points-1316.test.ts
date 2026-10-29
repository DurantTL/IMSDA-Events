import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coordinator Points (#1316): summary band, top-10 bars, Show all, ranking table and one Records link per club.
 * Synthetic clubs only.
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

import PointsPage from "@/app/(public)/account/(portal)/area-clubs/points/page";

import { summarizeClub, type AreaClubSummary, type AreaSummaryInput } from "@/modules/club-reports/area-summary-domain";
import { medianOf, pointsPageHref, pointsSummaryTiles } from "@/modules/club-reports/coordinator-points-domain";
import { supportingRecordMonths } from "@/modules/club-reports/coordinator-destinations-domain";

const now = new Date("2026-10-24T15:00:00Z");
const clubYear = "2026-27";
const noChecks = { missing: 0, notInCompliance: 0, expiringSoon: 0 };

function club(id: string, name: string, reportPoints: number, over: Partial<AreaSummaryInput> = {}): AreaClubSummary {
  const reports = reportPoints > 0
    ? [{ reportMonth: "2026-09", status: "SUBMITTED" as const, totalPoints: reportPoints, onTimePoints: 10 }]
    : [];
  return summarizeClub({ id, name, church: `${name} Church`, directors: ["Dana Sample"], rosterSize: 10, adultCount: 3, registrationOnTime: true, backgroundChecks: noChecks, reports, ...over }, clubYear, now);
}

// 12 synthetic clubs: Club 01 has the most report points, Club 12 has none and a late yearly registration.
const many = Array.from({ length: 12 }, (_, index) => club(`k${index + 1}`, `Club ${String(index + 1).padStart(2, "0")}`, index === 11 ? 0 : (12 - index) * 10, index === 11 ? { registrationOnTime: false } : {}));
const run = async (search: Record<string, string> = {}) => renderToStaticMarkup(await PointsPage({ searchParams: Promise.resolve(search) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1", displayName: "Sample Coordinator" }, via: "attendee", sessionId: "s1" });
  mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getAreaClubsSummary.mockResolvedValue(many);
});

describe("coordinator points helpers (#1316)", () => {
  it("takes the median of odd and even counts and none for no clubs", () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([1, 2, 3, 10])).toBe(3);
  });

  it("builds the band from existing fields only", () => {
    const tiles = pointsSummaryTiles(many);
    expect(tiles.map((tile) => tile.label)).toEqual(["Points leader", "Median total", "On-time yearly registration", "Report points"]);
    expect(tiles[0]).toMatchObject({ value: "Club 01", detail: "1,620 total points" });
    expect(tiles[2]!.value).toBe("11 of 12");
    expect(tiles[3]!.value).toBe(many.reduce((sum, c) => sum + c.reportPoints, 0));
    expect(pointsSummaryTiles([]).map((tile) => tile.value)).toEqual(["None yet", "None yet", "0 of 0", 0]);
  });

  it("builds addresses that keep year, sort, search and all", () => {
    expect(pointsPageHref("/p", {})).toBe("/p");
    expect(pointsPageHref("/p", { year: "2026-27", sort: "points", q: "al", all: true })).toBe("/p?year=2026-27&q=al&all=1");
    expect(pointsPageHref("/p", { year: "2026-27", sort: "name" })).toBe("/p?year=2026-27&sort=name");
  });
});

describe("Coordinator Points page (#1316)", () => {
  it("shows ten bars with a Show all link that keeps year and search, and the band", async () => {
    const html = await run({ year: "2026-27" });
    expect(html).toContain("Points leader");
    expect(html).toContain("Show all 12 clubs");
    expect(html).toContain('href="/account/area-clubs/points?year=2026-27&amp;all=1"');
    expect(html.match(/<li class="[^"]*barRow/g)).toHaveLength(10);
    expect(html).toContain("1,620");
  });

  it("?all=1 shows every club and a way back", async () => {
    const html = await run({ year: "2026-27", all: "1" });
    expect(html.match(/<li class="[^"]*barRow/g)).toHaveLength(12);
    expect(html).not.toContain("Show all 12 clubs");
    expect(html).toContain("Show top 10 only");
  });

  it("keeps the figures exactly: report points, total minus report points, total", async () => {
    const html = await run();
    expect(many[0]!.reportPoints).toBe(120);
    expect(many[0]!.totalPoints).toBe(1620);
    expect(html).toContain('data-label="Report points">120<');
    expect(html).toContain('data-label="Yearly registration" data-label-long="">1,500<');
    expect(html).toContain('data-label="Total points"><strong>1,620<');
    // The club without a record or an on-time registration has zero everywhere.
    expect(html).toContain('data-label="Yearly registration" data-label-long="">0<');
  });

  it("links one Records (n) per club to the club page, or says none were submitted", async () => {
    const html = await run();
    expect(supportingRecordMonths(many[0]!)).toHaveLength(1);
    expect(html).toContain('href="/account/area/k1"');
    expect(html).toContain("Records (1)");
    expect(html).toContain(", Club 01 submitted records, view only");
    expect(html).not.toContain("/reports/2026-");
    expect(html).toContain("No submitted records");
    expect(html).toContain('Open club<span class="sr-only">: Club 12</span>');
  });

  it("keeps overall rank and the bar scale under a search, and the CSV link", async () => {
    const html = await run({ q: "club 03" });
    expect(html).toContain('data-label="Rank">3<');
    expect(html).not.toContain("Club 04");
    // Club 03: 100 report points and 1,500 registration, scaled to the overall maximum of 1,620.
    expect(html).toContain(`width:${(100 / 1620) * 100}%`);
    expect(html).toContain(`width:${(1500 / 1620) * 100}%`);
    expect(html).toContain('href="/api/attendee/area-clubs/export?report=points&amp;year=');
  });

  it("says when a search matches nothing, and shows unavailable, never zero, on a failed read", async () => {
    expect(await run({ q: "zzz" })).toContain("No club name matches");
    mocks.getAreaClubsSummary.mockRejectedValue(new Error("db down"));
    const failed = await run();
    expect(failed).toContain("is unavailable");
    expect(failed).not.toMatch(/Total points|Points leader|\b0\b/);
  });

  it("refuses someone who is not an active coordinator before reading any club", async () => {
    mocks.areaGrantFindUnique.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("NOT_FOUND");
    expect(mocks.getAreaClubsSummary).not.toHaveBeenCalled();
  });
});
