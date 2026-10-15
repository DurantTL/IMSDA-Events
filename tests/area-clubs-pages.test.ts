import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Page-level denial for the Area Coordinator Clubs section (#657): layouts do
 * not re-run on navigation, so each page must refuse by itself. The real
 * coordinator check runs; only the session, database and summary data are stubbed.
 */
const mocks = vi.hoisted(() => ({
  areaGrantFindUnique: vi.fn(),
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  currentStaffActingContext: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  getAreaClubsSummary: vi.fn(),
  listAreaClubEvents: vi.fn(),
  listUpcomingDeadlines: vi.fn(),
  listClubsNewYearStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ areaCoordinatorGrant: { findUnique: mocks.areaGrantFindUnique } }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/calendar/deadline-list", () => ({ listUpcomingDeadlines: mocks.listUpcomingDeadlines }));
// Which clubs haven't started next year's roster (#414) has its own tests.
vi.mock("@/modules/club-rosters/carry-forward", () => ({ listClubsNewYearStatus: mocks.listClubsNewYearStatus }));
vi.mock("@/modules/club-reports/area-summary-repository", () => ({
  getAreaClubsSummary: mocks.getAreaClubsSummary,
  listAreaClubEvents: mocks.listAreaClubEvents,
}));

import AreaLayout from "@/app/(public)/account/(portal)/area-clubs/layout";
import EventsPage from "@/app/(public)/account/(portal)/area-clubs/events/page";
import OverviewPage from "@/app/(public)/account/(portal)/area-clubs/overview/page";
import PointsPage from "@/app/(public)/account/(portal)/area-clubs/points/page";
import ReportsPage from "@/app/(public)/account/(portal)/area-clubs/reports/page";

const pages = { overview: OverviewPage, reports: ReportsPage, points: PointsPage, events: EventsPage };
const props = { searchParams: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1" }, via: "attendee", sessionId: "s1" });
  mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getAreaClubsSummary.mockResolvedValue([]);
  mocks.listAreaClubEvents.mockResolvedValue([]);
  mocks.listUpcomingDeadlines.mockResolvedValue([]);
  mocks.listClubsNewYearStatus.mockResolvedValue(null);
});

describe.each(Object.entries(pages))("area-clubs %s page (#657)", (_name, Page) => {
  it("renders for an active Area Coordinator", async () => {
    await expect(Page(props)).resolves.toBeTruthy();
  });

  it.each([
    ["a non-coordinator", () => mocks.areaGrantFindUnique.mockResolvedValue(null)],
    ["a revoked grant", () => mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: new Date("2026-01-01"), expiresAt: null })],
    ["an expired grant", () => mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: new Date("2020-01-01") })],
    ["a pending second step", () => mocks.accountNeedsSecondStep.mockResolvedValue("VERIFY")],
    ["a signed-out visitor", () => mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null })],
  ])("returns not found for %s without loading any club data", async (_label, arrange) => {
    arrange();
    await expect(Page(props)).rejects.toThrow("NOT_FOUND");
    expect(mocks.getAreaClubsSummary).not.toHaveBeenCalled();
    expect(mocks.listAreaClubEvents).not.toHaveBeenCalled();
    expect(mocks.listUpcomingDeadlines).not.toHaveBeenCalled();
  });
});

describe("Upcoming deadlines for the Area Coordinator (#910)", () => {
  it("shows the conference's deadlines on the overview, above the club list", async () => {
    const deadline = { key: "d1", title: "Points Reports Due", dueOn: "2026-12-05", href: null, postponed: false, label: "Due in 20 days", overdue: false };
    mocks.listUpcomingDeadlines.mockResolvedValue([deadline]);
    const tree = await OverviewPage(props);
    const text = JSON.stringify(tree);
    expect(text).toContain("Points Reports Due");
    expect(text.indexOf("Points Reports Due")).toBeLessThan(text.indexOf("area-overview-page"));
  });
});

describe("Clubs that have not started next year's roster (#414)", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["2027-08-15", "2027-09-15", "2027-10-31"])("the overview loads the list on %s", async (day) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${day}T15:00:00Z`));
    await OverviewPage(props);
    expect(mocks.listClubsNewYearStatus).toHaveBeenCalledTimes(1);
  });

  it.each(["2027-07-31", "2027-11-01", "2028-02-10"])("the overview does not load it on %s", async (day) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${day}T15:00:00Z`));
    await OverviewPage(props);
    expect(mocks.listClubsNewYearStatus).not.toHaveBeenCalled();
  });

  it("a non-coordinator never reaches it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-09-15T15:00:00Z"));
    mocks.areaGrantFindUnique.mockResolvedValue(null);
    await expect(OverviewPage(props)).rejects.toThrow("NOT_FOUND");
    expect(mocks.listClubsNewYearStatus).not.toHaveBeenCalled();
  });
});

describe("area-clubs layout (#657)", () => {
  it("still refuses a non-coordinator", async () => {
    mocks.areaGrantFindUnique.mockResolvedValue(null);
    await expect(AreaLayout({ children: null })).rejects.toThrow("NOT_FOUND");
  });
});
