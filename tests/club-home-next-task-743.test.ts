import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #743 Club home: the next task and its deadline come before the statistics,
 * and the club menu keeps its order. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  getRosterAccessStateForPage: vi.fn(),
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  listRoster: vi.fn(),
  listClubEvents: vi.fn(),
  getClubReportYear: vi.fn(),
  clubPortalComplianceReminderCounts: vi.fn(),
  listUpcomingDeadlines: vi.fn(),
  listSubmissionsForViewer: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/modules/club-rosters/access", () => ({ getRosterAccessStateForPage: mocks.getRosterAccessStateForPage }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/club-rosters/repository", () => ({ listRoster: mocks.listRoster }));
vi.mock("@/modules/club-registrations/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-registrations/repository")>("@/modules/club-registrations/repository");
  return { ...actual, listClubEvents: mocks.listClubEvents };
});
vi.mock("@/modules/club-reports/repository", () => ({ getClubReportYear: mocks.getClubReportYear }));
vi.mock("@/modules/background-checks/repository", () => ({ clubPortalComplianceReminderCounts: mocks.clubPortalComplianceReminderCounts }));
vi.mock("@/modules/club-forms/submissions", () => ({ listSubmissionsForViewer: mocks.listSubmissionsForViewer }));
vi.mock("@/modules/calendar/deadline-list", () => ({ listUpcomingDeadlines: mocks.listUpcomingDeadlines }));

import ClubHomePage from "@/app/(public)/account/(portal)/clubs/[organizationId]/page";
import { ClubNextTaskCard } from "@/components/club-next-task";
import { ClubHomeEvents, ClubHomeRoster, ClubHomeSummary, ClubHomeTasks } from "@/components/club-home";
import { UpcomingDeadlines } from "@/components/upcoming-deadlines";
import { pickClubNextTask } from "@/modules/club-rosters/home-next-task";
import { areaClubPortalNavItems, clubPortalNavItems } from "@/modules/club-rosters/portal-nav";

type AnyProps = Record<string, unknown>;
function componentElements(node: ReactNode, found: ReactElement<AnyProps>[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) componentElements(child, found);
    return found;
  }
  if (!isValidElement<AnyProps>(node)) return found;
  if (typeof node.type === "function") found.push(node);
  componentElements(node.props.children as ReactNode, found);
  return found;
}

const director = {
  state: "OPEN",
  club: { organizationId: "club-1", name: "Test Pathfinders", role: "DIRECTOR", sponsoringChurch: null },
  capabilities: { roster: true, registerForEvents: true, seeBirthDates: true, manageTeam: true, editProfile: true, submitReports: true, guardians: true },
  actor: { kind: "ATTENDEE", accountId: "account-1", sessionId: "session-1" },
};
const openEvent = {
  id: "event-open", name: "Fall Camporee", startsAt: "2026-10-10T00:00:00.000Z", endsAt: "2026-10-12T00:00:00.000Z",
  timezone: "America/Chicago", location: "Camp Fixture", phase: "OPEN", registrationClosesOn: "2026-12-01",
  available: true, problem: null, registration: null, draft: null, billingMode: "DEFERRED_ORGANIZATION_INVOICE", multipleTeams: false, teams: [], drafts: [],
};
// Complete on purpose: no blank roster field, so no roster task unless a test removes the roster.
const activeMember = {
  id: "member-1", firstName: "Pat", lastName: "Sample", status: "ACTIVE", attendeeType: "YOUTH", role: "Member", classLevel: "FRIEND",
  gender: "F", age: 12, reportedAge: null, birthDateNeeded: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRosterAccessStateForPage.mockResolvedValue(director);
  mocks.listRoster.mockResolvedValue([activeMember]);
  mocks.listClubEvents.mockResolvedValue([openEvent]);
  mocks.getClubReportYear.mockResolvedValue({ reports: [{ reportMonth: "2026-09", status: "SUBMITTED" }], registrationOnTime: false });
  mocks.listDirectedClubs.mockResolvedValue([]);
  mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
  mocks.clubPortalComplianceReminderCounts.mockResolvedValue(null);
  mocks.listSubmissionsForViewer.mockResolvedValue([]);
  mocks.listUpcomingDeadlines.mockResolvedValue([]);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T18:00:00.000Z"));
});

const home = async () => renderToStaticMarkup(await ClubHomePage({ params: Promise.resolve({ organizationId: "club-1" }) }));

describe("Club home shows the first task and its deadline before the roster and event cards (#743, #1166)", () => {
  it("renders Continue club work after the summary and before the roster and event card", async () => {
    const tree = await ClubHomePage({ params: Promise.resolve({ organizationId: "club-1" }) });
    const order = componentElements(tree).map((element) => element.type);
    expect(order.indexOf(ClubHomeSummary)).toBeLessThan(order.indexOf(ClubHomeTasks));
    expect(order.indexOf(ClubHomeTasks)).toBeLessThan(order.indexOf(ClubHomeRoster));
    expect(order.indexOf(ClubHomeRoster)).toBeLessThan(order.indexOf(ClubHomeEvents));
    // The old Next task card and year tiles are gone from Home.
    expect(order).not.toContain(ClubNextTaskCard);
  });

  it("names the first task and its deadline: a report due date, then an event closing date", async () => {
    // September is unfiled and due October 10, which is still ahead.
    mocks.getClubReportYear.mockResolvedValue({ reports: [], registrationOnTime: false });
    vi.setSystemTime(new Date("2026-10-05T18:00:00.000Z"));
    const tree = await ClubHomePage({ params: Promise.resolve({ organizationId: "club-1" }) });
    const tasks = componentElements(tree).find((element) => element.type === ClubHomeTasks)!;
    const steps = tasks.props.steps as Array<{ key: string }>;
    expect(steps.map((step) => step.key)).toEqual(["report-2026-09", "event-open"]);
    expect(tasks.props.deadlines).toMatchObject({ "report-2026-09": "Due October 10", "event-open": "Register by December 1, 2026" });
    const html = await home();
    expect(html).toContain("Due October 10");
    expect(html).toContain("Open report");
    expect(html.match(/class="primary-button/g)).toHaveLength(1);
  });

  it("falls to the event closing date when nothing else is due", async () => {
    const tree = await ClubHomePage({ params: Promise.resolve({ organizationId: "club-1" }) });
    const tasks = componentElements(tree).find((element) => element.type === ClubHomeTasks)!;
    expect((tasks.props.steps as Array<{ key: string }>).map((step) => step.key)).toEqual(["event-open"]);
    expect(tasks.props.deadlines).toMatchObject({ "event-open": "Register by December 1, 2026" });
  });

  it("picks the first step, says No deadline when it has none, and keeps the rest for the list", () => {
    const steps = [
      { key: "roster", text: "Add your club members.", href: "/r", action: "Add people" },
      { key: "event-1", text: "Register.", href: "/e", action: "Register" },
    ];
    const next = pickClubNextTask(steps, { "event-1": "Register by May 1" });
    expect(next?.step.key).toBe("roster");
    expect(next?.deadline).toBeNull();
    expect(next?.others.map((step) => step.key)).toEqual(["event-1"]);
    expect(renderToStaticMarkup(ClubNextTaskCard({ next }) as ReactElement)).toContain("No deadline");
    expect(pickClubNextTask([], {})).toBeNull();
    expect(renderToStaticMarkup(ClubNextTaskCard({ next: null }) as ReactElement)).toContain("all caught up");
  });

  it("gives the first task the one filled button and every later action an outline, so the page keeps one filled button", async () => {
    mocks.listRoster.mockResolvedValue([]);
    const html = await home();
    expect(html.match(/class="primary-button club-event-action"/g)).toHaveLength(1);
    expect(html).toMatch(/class="primary-button club-event-action" href="\/account\/clubs\/club-1\/roster">Add people/);
    expect(html).toMatch(/class="secondary-button club-event-action" href="\/account\/clubs\/club-1\/events\/event-open">Register/);
  });
});

describe("Home tasks pick from every step, in order, without repeating one", () => {
  it("lets a red background-check item be the first task when it is the only step", async () => {
    mocks.listClubEvents.mockResolvedValue([]);
    mocks.clubPortalComplianceReminderCounts.mockResolvedValue({ notInCompliance: 1, expiringSoon: 0, missing: 0 });
    const tree = await ClubHomePage({ params: Promise.resolve({ organizationId: "club-1" }) });
    const tasks = componentElements(tree).find((element) => element.type === ClubHomeTasks)!;
    const steps = tasks.props.steps as Array<{ key: string; danger?: boolean }>;
    expect(steps).toHaveLength(1);
    expect(steps[0]!.danger).toBe(true);
    const html = await home();
    expect(html).toContain("club-step-danger");
    expect(html.match(/class="primary-button/g)).toHaveLength(1);
  });

  it("lists the roster step, then the event step", async () => {
    mocks.listRoster.mockResolvedValue([]);
    const tree = await ClubHomePage({ params: Promise.resolve({ organizationId: "club-1" }) });
    const tasks = componentElements(tree).find((element) => element.type === ClubHomeTasks)!;
    expect((tasks.props.steps as Array<{ key: string }>).map((step) => step.key)).toEqual(["roster", "event-open"]);
  });
});

describe("the club menu order is unchanged", () => {
  const capabilities = { roster: true, registerForEvents: true, seeBirthDates: true, manageTeam: true, editProfile: true, submitReports: true, guardians: true };
  it("keeps the director's menu in its order", () => {
    expect(clubPortalNavItems({ base: "/account/clubs/c", role: "DIRECTOR", capabilities }).map((item) => item.label)).toEqual([
      "Home", "Roster", "Honors", "Class tracking", "Club events", "Forms", "Health", "Monthly Records", "Orders", "Club settings",
    ]);
  });
  it("keeps the Area Coordinator's menu in its order", () => {
    expect(areaClubPortalNavItems({ organizationId: "c" }).map((item) => item.label)).toEqual([
      "Home", "Roster", "Honors", "Events", "Club forms", "Monthly Records", "Earned awards",
    ]);
  });
});

describe("Upcoming deadlines on the club home (#910)", () => {
  const deadline = { key: "d1", title: "Spring Camporee Registration Due", dueOn: "2026-12-05", href: null, postponed: false, label: "Due in 20 days", overdue: false };

  it("shows the conference's deadlines to a director, after the roster and event cards", async () => {
    mocks.listUpcomingDeadlines.mockResolvedValue([deadline]);
    const tree = await ClubHomePage({ params: Promise.resolve({ organizationId: "club-1" }) });
    const order = componentElements(tree).map((element) => element.type);
    const list = componentElements(tree).find((element) => element.type === UpcomingDeadlines)!;
    expect(list.props.deadlines).toEqual([deadline]);
    expect(order.indexOf(ClubHomeEvents)).toBeLessThan(order.indexOf(UpcomingDeadlines));
    expect(mocks.listUpcomingDeadlines).toHaveBeenCalledTimes(1);
  });

  it("shows them to a reporter too, who has no roster", async () => {
    mocks.listUpcomingDeadlines.mockResolvedValue([deadline]);
    mocks.getRosterAccessStateForPage.mockResolvedValue({
      state: "NO_ROSTER",
      club: { organizationId: "club-1", name: "Test Pathfinders", role: "REPORTER", sponsoringChurch: null },
      capabilities: { roster: false, registerForEvents: false, seeBirthDates: false, manageTeam: false, editProfile: false, submitReports: true, guardians: false },
    });
    const tree = await ClubHomePage({ params: Promise.resolve({ organizationId: "club-1" }) });
    expect(componentElements(tree).find((element) => element.type === UpcomingDeadlines)?.props.deadlines).toEqual([deadline]);
  });

  it("loads nothing for someone who does not direct the club", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue({ state: "FORBIDDEN" });
    const tree = await ClubHomePage({ params: Promise.resolve({ organizationId: "club-1" }) });
    expect(tree).toBeNull();
    expect(mocks.listUpcomingDeadlines).not.toHaveBeenCalled();
  });
});
