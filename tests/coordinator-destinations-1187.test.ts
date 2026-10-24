import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coordinator workspace B (#1187): Monthly Records, Points, Club events, Team
 * approvals and New clubs. Synthetic clubs and people only.
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
import PointsPage from "@/app/(public)/account/(portal)/area-clubs/points/page";
import EventsPage from "@/app/(public)/account/(portal)/area-clubs/events/page";
import TeamApprovalsPage from "@/app/(public)/account/(portal)/area-clubs/team-permissions/page";
import NewClubsPage from "@/app/(public)/account/(portal)/area-clubs/applications/page";
import { AreaPointsChart } from "@/components/area-clubs-views";
import { CoordinatorClubEvents, CoordinatorClubEventsHelp, CoordinatorMonthlyRecords } from "@/components/coordinator-destinations";
import { NewClubApplicationsQueue } from "@/components/new-club-applications-queue";
import { summarizeClub, type AreaClubSummary, type AreaSummaryInput } from "@/modules/club-reports/area-summary-domain";
import type { AreaClubEvent } from "@/modules/club-reports/area-summary-repository";
import { monthlyRecordCounts, supportingRecordMonths } from "@/modules/club-reports/coordinator-destinations-domain";
import type { NewClubApplicationRecord } from "@/modules/club-applications/repository";

const now = new Date("2026-10-24T15:00:00Z");
const clubYear = "2026-27";
const noChecks = { missing: 0, notInCompliance: 0, expiringSoon: 0 };

function club(id: string, name: string, over: Partial<AreaSummaryInput> = {}): AreaClubSummary {
  return summarizeClub({ id, name, church: `${name} Church`, directors: ["Dana Sample"], rosterSize: 10, adultCount: 3, registrationOnTime: true, backgroundChecks: noChecks, reports: [], ...over }, clubYear, now);
}
const submitted = (month: string, onTime = 25) => ({ reportMonth: month, status: "SUBMITTED" as const, totalPoints: 100, onTimePoints: onTime });

const clubs = [
  club("c1", "Alpha Club", { reports: [submitted("2026-09")] }),
  club("c2", "Bravo Club", { reports: [{ reportMonth: "2026-09", status: "DRAFT", totalPoints: 0, onTimePoints: 0 }] }),
  club("c3", "Charlie Club", { reports: [submitted("2026-09", 0)] }),
  club("c4", "Delta Club"),
];

const searchProps = { searchParams: Promise.resolve({}) };
const monthly = (list: AreaClubSummary[], query = "", total = clubs.length) =>
  renderToStaticMarkup(createElement(CoordinatorMonthlyRecords, { allClubsCount: total, clearHref: "/account/area-clubs/reports?year=2026-27", clubYear, clubs: list, now, query }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1", displayName: "Sample Coordinator" }, via: "attendee", sessionId: "s1" });
  mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.getAreaClubsSummary.mockResolvedValue(clubs);
  mocks.listAreaClubEvents.mockResolvedValue([]);
  mocks.listCoordinatorTeamPermissions.mockResolvedValue([]);
  mocks.getTeamSettings.mockResolvedValue({ maxMemberAge: null, ageAsOf: null });
  mocks.currentApplicationViewer.mockResolvedValue("AREA_COORDINATOR");
  mocks.listNewClubApplications.mockResolvedValue([]);
});

describe("Monthly Records (#1187)", () => {
  it("counts Submitted and Not submitted per club and leaves a not-yet-due month out of both", () => {
    expect(monthlyRecordCounts(clubs[0]!, now)).toEqual({ submitted: 1, notSubmitted: 0 });
    // Delta has nothing filed: September has ended and counts as Not submitted; later months are not due yet.
    expect(monthlyRecordCounts(clubs[3]!, now)).toEqual({ submitted: 0, notSubmitted: 1 });
  });

  it("opens a Submitted month read only and shows Not submitted and Not due yet as plain text", () => {
    const html = monthly(clubs);
    expect(html).toContain('href="/account/area/c1/reports/2026-09"');
    expect(html).toContain('href="/account/area/c3/reports/2026-09"');
    // Only the two submitted records are links; Bravo (draft) and Delta are text.
    expect(html.match(/\/reports\/2026-/g)).toHaveLength(2);
    expect(html).toContain("Not submitted");
    expect(html).toContain("(draft saved)");
    expect(html).toContain("Not due yet");
    expect(html).toContain("(late)");
    expect(html).toContain("Opens the record, view only.");
  });

  it("has no approve control and none of the director's tools", () => {
    const html = monthly(clubs);
    expect(html).not.toMatch(/approve|decline|<button|<form|<input/i);
    expect(html).not.toMatch(/background check/i);
  });

  it("puts the wide grid in a labelled, focusable scroll region with semantic headers", () => {
    const html = monthly(clubs);
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Monthly Records by club and month, 2026-27. Scroll sideways to see every month."');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('scope="row"');
    expect(html).toContain('scope="col"');
    expect(html).toContain("Monthly Record status by club for 2026-27");
  });

  it("says plainly when a search has no match or there are no clubs, and offers Clear search only for the first", () => {
    const none = monthly([], "zzz");
    expect(none).toContain("No club name matches");
    expect(none).toContain("Clear search");
    const empty = monthly([], "", 0);
    expect(empty).toContain("No active clubs are available to this role yet.");
    expect(empty).not.toContain("Clear search");
  });

  it("keeps long club and church names whole", () => {
    const long = club("l", "The Extraordinarily Long Named Pathfinder and Adventurer Club of Sample Valley Heights", { church: "An Equally Long Sponsoring Church Name for Layout Testing" });
    const html = monthly([long], "", 1);
    expect(html).toContain("Extraordinarily Long Named");
    expect(html).toContain("An Equally Long Sponsoring Church Name");
  });

  it("page states the year, the scope and the export scope, and the export ignores the search", async () => {
    const html = renderToStaticMarkup(await MonthlyRecordsPage({ searchParams: Promise.resolve({ year: "2026-27", q: "alp" }) }));
    expect(html).toContain("Monthly Records");
    expect(html).toContain("2026-27");
    expect(html).toContain("All active clubs available to this role");
    expect(html).toContain("Full-year CSV — all available clubs, 2026-27");
    expect(html).toContain('href="/api/attendee/area-clubs/export?report=summary&amp;year=2026-27"');
    expect(html).toContain("does not change with the search");
    expect(html).toContain("These are record states, not approvals.");
    expect(html).not.toMatch(/overdue|ministry|area filter/i);
  });

  it("page shows unavailable with a retry, and no Submitted or Not submitted, when the read fails", async () => {
    mocks.getAreaClubsSummary.mockRejectedValue(new Error("db down"));
    const html = renderToStaticMarkup(await MonthlyRecordsPage(searchProps));
    expect(html).toContain("is unavailable");
    expect(html).toContain("Retry");
    expect(html).not.toMatch(/Submitted|Not submitted|No active clubs/);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a revoked grant", () => mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: new Date("2026-01-01"), expiresAt: null })],
    ["a pending second step", () => mocks.accountNeedsSecondStep.mockResolvedValue("VERIFY")],
    ["someone who is not a coordinator", () => mocks.areaGrantFindUnique.mockResolvedValue(null)],
  ])("refuses %s before reading any club", async (_label, arrange) => {
    arrange();
    for (const page of [MonthlyRecordsPage, PointsPage, EventsPage]) {
      await expect(page(searchProps)).rejects.toThrow("NOT_FOUND");
    }
    expect(mocks.getAreaClubsSummary).not.toHaveBeenCalled();
    expect(mocks.listAreaClubEvents).not.toHaveBeenCalled();
  });
});

describe("Points (#1187)", () => {
  const points = (list: AreaClubSummary[], query = "") =>
    renderToStaticMarkup(createElement(AreaPointsChart, {
      basePath: "/account/area-clubs/points", clubYear, clubs: list, query, sort: "points",
      links: { clubHref: (id: string) => `/account/area/${id}`, reportHref: (id: string, month: string) => `/account/area/${id}/reports/${month}` },
    }));

  it("lists the submitted records a club's points rest on, and none for a club without any", () => {
    expect(supportingRecordMonths(clubs[0]!).map((entry) => entry.month)).toEqual(["2026-09"]);
    expect(supportingRecordMonths(clubs[1]!)).toEqual([]);
    const html = points(clubs);
    expect(html).toContain('href="/account/area/c1/reports/2026-09"');
    expect(html).toContain('href="/account/area/c3/reports/2026-09"');
    expect(html).not.toContain('href="/account/area/c2/reports/');
    expect(html).toContain("No submitted records");
    expect(html).toContain('href="/account/area/c4"');
    expect(html).toContain("Supporting records");
  });

  it("keeps the recorded versus yearly registration split and the existing totals", () => {
    const html = points(clubs);
    for (const column of ["Report points", "Yearly registration", "Total points"]) expect(html).toContain(column);
    // 100 recorded + 1,500 for an on-time yearly registration, unchanged.
    expect(clubs[0]!.reportPoints).toBe(100);
    expect(clubs[0]!.totalPoints).toBe(1600);
    expect(html).toContain("1,600");
    expect(html).toContain("1,500");
  });

  it("sits the table in a labelled scroll region only in the coordinator's view", () => {
    expect(points(clubs)).toContain('aria-label="Points by club for 2026-27. Scroll sideways to see every column."');
    const admin = renderToStaticMarkup(createElement(AreaPointsChart, { basePath: "/x", clubYear, clubs, sort: "points" }));
    expect(admin).not.toContain("Supporting records");
    expect(admin).not.toContain('role="region"');
  });

  it("page explains the points, states the export scope and shows unavailable, never zero, on failure", async () => {
    const html = renderToStaticMarkup(await PointsPage(searchProps));
    expect(html).toContain("Recorded report points are the totals on each submitted Monthly Record.");
    expect(html).toContain("Full-year points CSV — all available clubs, 2026-27");
    mocks.getAreaClubsSummary.mockRejectedValue(new Error("db down"));
    const failed = renderToStaticMarkup(await PointsPage(searchProps));
    expect(failed).toContain("is unavailable");
    expect(failed).not.toMatch(/Total points|\b0\b/);
  });
});

describe("Club events (#1187)", () => {
  const events: AreaClubEvent[] = [
    {
      id: "event-1", name: "Synthetic Camporee", startsAt: "2026-10-09T12:00:00Z",
      clubs: [
        { organizationId: "c1", name: "Alpha Club", status: "REGISTERED", headcount: 12 },
        { organizationId: "c4", name: "Delta Club", status: "NOT_REGISTERED", headcount: null },
      ],
    },
  ];
  const render = (query = "") => renderToStaticMarkup(createElement("div", null, createElement(CoordinatorClubEventsHelp), createElement(CoordinatorClubEvents, { clearHref: "/x", events, query })));

  it("offers only the coordinator's actions and never a Pay balance action", () => {
    const html = render();
    expect(html).toContain('href="/account/area-clubs/kitchen/event-1"');
    expect(html).toContain('href="/account/area/c1"');
    expect(html).toContain("1 clubs registered · 12 people");
    expect(html).not.toMatch(/Pay balance|Pay now|Make a payment|<button|<form/i);
    // Said in words too, including for an event a church is billed for.
    expect(html).toContain("You cannot register a club, change a registration or pay a balance, including for an event a church is billed for.");
  });

  it("narrows by search, with Clear search for no match, and says no events when there are none", () => {
    expect(render("alp")).not.toContain("Delta Club");
    expect(render("zzz")).toContain("Clear search");
    const none = renderToStaticMarkup(createElement(CoordinatorClubEvents, { clearHref: "/x", events: [], query: "" }));
    expect(none).toContain("No club events are published for this club year.");
  });

  it("puts each event's grid in a labelled scroll region", () => {
    expect(render()).toContain('aria-label="Club registrations for Synthetic Camporee"');
  });

  it("page shows unavailable, never no events, when the read fails", async () => {
    mocks.listAreaClubEvents.mockRejectedValue(new Error("db down"));
    const html = renderToStaticMarkup(await EventsPage(searchProps));
    expect(html).toContain("is unavailable");
    expect(html).not.toContain("No club events");
  });
});

describe("Team approvals page (#1187)", () => {
  const rows = [{
    id: "perm-1", eventId: "event-1", eventName: "Synthetic Bible Experience", registrationId: "r1", clubEventRegistrationId: "cer1",
    teamLabel: "Alpha Club (Team A)", locationName: "North Location", name: "Sam Sample", age: 18, status: "PENDING" as const, decidedAt: null, decidedBy: null,
  }];

  it("shows Approve and Decline to the real coordinator", async () => {
    mocks.listCoordinatorTeamPermissions.mockResolvedValue(rows);
    const html = renderToStaticMarkup(await TeamApprovalsPage());
    expect(mocks.listCoordinatorTeamPermissions).toHaveBeenCalledWith("account-1");
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Decline<");
    expect(html).toContain("1 person is waiting for approval.");
  });

  it("says plainly when nothing needs a decision", async () => {
    const html = renderToStaticMarkup(await TeamApprovalsPage());
    expect(html).toContain("No team members of 18 or older at your event locations need a decision right now.");
  });

  it("offers a staff act-as no decision control, reads no coordinator's requests, and says why", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.currentStaffActingContext.mockResolvedValue({ userId: "staff-1", role: "AREA_COORDINATOR", actAsId: "act-1" });
    const html = renderToStaticMarkup(await TeamApprovalsPage());
    expect(mocks.listCoordinatorTeamPermissions).not.toHaveBeenCalled();
    expect(html).not.toContain(">Approve<");
    expect(html).not.toContain(">Decline<");
    expect(html).toContain("A staff act-as view cannot approve or decline.");
  });

  it("shows unavailable, never an empty list, when the read fails", async () => {
    mocks.listCoordinatorTeamPermissions.mockRejectedValue(new Error("db down"));
    const html = renderToStaticMarkup(await TeamApprovalsPage());
    expect(html).toContain("is unavailable");
    expect(html).toContain("Retry");
    expect(html).not.toContain("need a decision right now");
  });

  it("refuses a revoked grant", async () => {
    mocks.areaGrantFindUnique.mockResolvedValue({ revokedAt: new Date("2026-01-01"), expiresAt: null });
    await expect(TeamApprovalsPage()).rejects.toThrow("NOT_FOUND");
    expect(mocks.listCoordinatorTeamPermissions).not.toHaveBeenCalled();
  });
});

describe("New clubs page (#1187)", () => {
  const application = {
    id: "app-1", clubName: "Sample Valley Pathfinders", clubType: "PATHFINDER", status: "PENDING",
    church: { name: "Sample Valley Church", type: "CHURCH", isOther: false, unavailable: false, needsChoice: false },
    sterling: "NO_RECORD", sterlingAmbiguous: false, sterlingNameMismatch: false, source: "PUBLIC", invitedEmail: null, invitedEmailDiffers: false,
    duplicates: [], director: { name: "Dana Sample", email: "dana@example.test", address: "1 Example Road", homePhone: null, workPhone: null },
    pastorName: "Pat Pastor", signatures: { pastor: "Pat Pastor", headElder: "Hal Elder", clerk: "Cleo Clerk", director: "Dana Sample" },
    otherBoardMembers: [], note: null, submittedAt: "2026-10-01T12:00:00Z", applicationDate: "2026-10-01", attachment: null,
    declineReason: null, decidedAt: null, decidedByName: null, createdOrganizationId: null,
  } as unknown as NewClubApplicationRecord;

  it("says system administrators decide and shows a useful empty state", async () => {
    const html = renderToStaticMarkup(await NewClubsPage());
    expect(html).toContain("System administrators make the approve and decline decisions. This list is view only.");
    expect(html).toContain("No new club applications yet");
    expect(html).not.toMatch(/<button|Approve<|Decline</);
  });

  it("lists applications read only, with no Approve, Decline or invite controls", async () => {
    mocks.listNewClubApplications.mockResolvedValue([application]);
    const html = renderToStaticMarkup(await NewClubsPage());
    expect(mocks.listNewClubApplications).toHaveBeenCalledWith("AREA_COORDINATOR");
    expect(html).toContain("Sample Valley Pathfinders");
    expect(html).not.toMatch(/>Approve<|>Decline<|Send link|private link/);
  });

  it("links a decided application's new club to the coordinator's own view, not an admin page", () => {
    const decided = { ...application, status: "APPROVED", createdOrganizationId: "club-9" } as NewClubApplicationRecord;
    const html = renderToStaticMarkup(createElement(NewClubApplicationsQueue, { applications: [decided], canDecide: false, churches: [] }));
    expect(html).toContain('href="/account/area/club-9"');
    expect(html).not.toContain("/admin/");
    const admin = renderToStaticMarkup(createElement(NewClubApplicationsQueue, { applications: [decided], canDecide: true, churches: [] }));
    expect(admin).toContain('href="/admin/organizations/club-9/profile"');
  });

  it("shows unavailable, never no applications, when the read fails", async () => {
    mocks.listNewClubApplications.mockRejectedValue(new Error("db down"));
    const html = renderToStaticMarkup(await NewClubsPage());
    expect(html).toContain("is unavailable");
    expect(html).not.toContain("No new club applications yet");
  });

  it("answers 404 to someone with no viewer role", async () => {
    mocks.currentApplicationViewer.mockResolvedValue(null);
    await expect(NewClubsPage()).rejects.toThrow("NOT_FOUND");
    expect(mocks.listNewClubApplications).not.toHaveBeenCalled();
  });
});
