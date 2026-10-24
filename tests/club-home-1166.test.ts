import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The task-first club Home (#1166). Synthetic clubs, people, forms and events
 * only. The page runs against mocked services, so what is checked is what Home
 * builds from the selected authorized club and year, per role.
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
import { clubHomeEventCards, clubHomeRosterPreview, clubHomeSummary, clubHomeUsefulLinks, rosterAgeLabel, type ClubHomeMember } from "@/modules/club-rosters/home-view";
import type { ClubEventSummary } from "@/modules/club-registrations/repository";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

const base = "/account/clubs/club-1";

const person = (id: string, overrides: Partial<ClubHomeMember> & Record<string, unknown> = {}): ClubHomeMember => ({
  id, firstName: `Pat${id}`, lastName: "Sample", status: "ACTIVE", attendeeType: "YOUTH", role: "Member", classLevel: "FRIEND",
  gender: "F", age: 12, reportedAge: null, birthDateNeeded: false, ...overrides,
});
const completeRoster = [person("1"), person("2", { age: 14, role: "Guide" }), person("3", { attendeeType: "STAFF", classLevel: null, age: 35, role: "Counselor" })];

const event = (overrides: Partial<ClubEventSummary> = {}): ClubEventSummary => ({
  id: "event-1", name: "Synthetic Camporee", startsAt: "2026-11-20T15:00:00.000Z", endsAt: "2026-11-22T17:00:00.000Z",
  timezone: "America/Chicago", location: "Camp Example", billingMode: "DEFERRED_ORGANIZATION_INVOICE", phase: "OPEN",
  registrationClosesOn: null, registeredLocation: null, hasLocations: false, available: true, problem: null,
  registration: null, draft: null, multipleTeams: false, teams: [], drafts: [], ...overrides,
} as ClubEventSummary);
const registered = (status: string, overrides: Partial<ClubEventSummary> = {}) =>
  event({ registration: { confirmationCode: "SYN001", status, attendeeCount: 6 } as ClubEventSummary["registration"], ...overrides });

const leaderCapabilities = clubCapabilities("DIRECTOR");
const access = (role: "DIRECTOR" | "DEPUTY" | "REGISTRAR", sponsoringChurch: string | null = "First Synthetic Church") => ({
  state: "OPEN",
  club: { organizationId: "club-1", name: "Synthetic Pathfinders", role, sponsoringChurch },
  capabilities: clubCapabilities(role),
  actor: { kind: "ATTENDEE", accountId: "account-1", sessionId: "session-1" },
});
const reporterAccess = {
  state: "NO_ROSTER",
  club: { organizationId: "club-1", name: "Synthetic Pathfinders", role: "REPORTER", sponsoringChurch: null },
  capabilities: clubCapabilities("REPORTER"),
};
const draftRow = { id: "draft-1", templateKey: "annual-club-info", templateName: "Annual club information", organizationId: "club-1", clubYear: "2026-27", status: "DRAFT", updatedAt: "2026-11-10T18:00:00.000Z", submittedAt: null };

const home = async (searchParams?: { year?: string }) =>
  renderToStaticMarkup(await ClubHomePage({ params: Promise.resolve({ organizationId: "club-1" }), searchParams: searchParams ? Promise.resolve(searchParams) : undefined }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Mid-November 2026 is club year 2026-27.
  vi.setSystemTime(new Date("2026-11-15T18:00:00.000Z"));
  mocks.listRoster.mockResolvedValue(completeRoster);
  mocks.listClubEvents.mockResolvedValue([]);
  mocks.getClubReportYear.mockResolvedValue({ reports: [{ reportMonth: "2026-09" }, { reportMonth: "2026-10" }, { reportMonth: "2026-11" }], registrationOnTime: false });
  mocks.clubPortalComplianceReminderCounts.mockResolvedValue(null);
  mocks.listUpcomingDeadlines.mockResolvedValue([]);
  mocks.listSubmissionsForViewer.mockResolvedValue([]);
  mocks.listDirectedClubs.mockResolvedValue([]);
  mocks.getCurrentAttendee.mockResolvedValue({ account: null });
});
afterEach(() => vi.useRealTimers());

describe("Home summary: counts with a definition, scoped to the selected club and year", () => {
  it("counts active roster people, saved drafts and event registrations, each with its source", () => {
    const summary = clubHomeSummary({
      clubYear: "2026-27",
      members: [...completeRoster, person("4", { status: "INACTIVE" })],
      formDrafts: [{ id: "d1", templateName: "Annual club information", updatedAt: "2026-11-10T18:00:00.000Z" }],
      events: [registered("SUBMITTED"), event()],
    });
    expect(summary.map((item) => [item.key, item.value])).toEqual([["roster", 3], ["drafts", 1], ["events", 1]]);
    for (const item of summary) expect(item.definition.length).toBeGreaterThan(20);
    expect(summary[0]!.definition).toContain("2026–27");
  });

  it("never turns an unknown count into zero or invents one for a role without forms or a past year", () => {
    const failed = clubHomeSummary({ clubYear: "2026-27", members: [], formDrafts: "ERROR", events: [] });
    expect(failed.find((item) => item.key === "drafts")!.value).toBeNull();
    const registrar = clubHomeSummary({ clubYear: "2026-27", members: [], formDrafts: null, events: [] });
    expect(registrar.map((item) => item.key)).toEqual(["roster", "events"]);
    const history = clubHomeSummary({ clubYear: "2025-26", members: completeRoster, formDrafts: [], events: null });
    expect(history.map((item) => item.key)).toEqual(["roster", "drafts"]);
  });
});

describe("Home roster preview shows ages, never birth dates", () => {
  it("words a computed age, an imported age, and a missing age", () => {
    expect(rosterAgeLabel({ age: 12, reportedAge: null })).toBe("Age 12");
    expect(rosterAgeLabel({ age: null, reportedAge: 11 })).toBe("Age 11 (reported)");
    expect(rosterAgeLabel({ age: null, reportedAge: null })).toBe("Age not recorded");
  });

  it("previews the first six active people out of the active total, skipping inactive people", () => {
    const many = Array.from({ length: 9 }, (_, index) => person(String(index + 1), index === 1 ? { status: "INACTIVE" } : {}));
    const preview = clubHomeRosterPreview(many);
    expect(preview.total).toBe(8);
    expect(preview.rows).toHaveLength(6);
    expect(preview.rows.map((row) => row.id)).not.toContain("2");
  });

  it("renders no date of birth, even when a row carries a birth-date field", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("DIRECTOR"));
    mocks.listRoster.mockResolvedValue([person("1", { sealedBirthDate: "sealed-value", birthDate: "2014-03-04" })]);
    const html = await home();
    expect(html).toContain("Age 12");
    expect(html).not.toContain("2014-03-04");
    expect(html).not.toContain("sealed-value");
  });
});

describe("Home club event card: billing semantics", () => {
  it("shows a church-billed registration as billed to the sponsoring church, with no payment or amount", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("DIRECTOR"));
    mocks.listClubEvents.mockResolvedValue([registered("SUBMITTED")]);
    const html = await home();
    expect(html).toContain("Synthetic Camporee");
    expect(html).toContain("Billed to First Synthetic Church after the event. Nothing to pay here.");
    expect(html).toContain("View club registration");
    expect(html).toContain(`href="${base}/events/event-1"`);
    expect(html).toContain("Submitted");
    expect(html).not.toMatch(/pay now/i);
    expect(html).not.toContain("$");
    expect(html).not.toMatch(/balance|amount due|owe/i);
  });

  it("shows an attendee-pay event as each person paying their own registration, never billed to the church", () => {
    const [card] = clubHomeEventCards([registered("CONFIRMED", { billingMode: "ATTENDEE_PAY" } as Partial<ClubEventSummary>)], { base, sponsoringChurch: "First Synthetic Church" });
    expect(card!.billing).toBe("Each person pays for their own registration. Nothing is billed to your church.");
    expect(card!.billedToChurch).toBe(false);
    expect(JSON.stringify(card)).not.toMatch(/pay now|\$|First Synthetic Church/i);
    expect(card!.lifecycle).toBe("Confirmed");
  });

  it("keeps a waitlisted or cancelled church-billed registration out of the billed state", () => {
    const [waitlisted] = clubHomeEventCards([registered("WAITLISTED")], { base, sponsoringChurch: "First Synthetic Church" });
    const [cancelled] = clubHomeEventCards([registered("CANCELLED")], { base, sponsoringChurch: "First Synthetic Church" });
    expect(waitlisted).toMatchObject({ lifecycle: "Waitlisted", billing: "No amount owed while waitlisted", billedToChurch: false });
    expect(cancelled).toMatchObject({ lifecycle: "Cancelled", billing: "Cancelled — nothing owed", billedToChurch: false });
  });

  it("says 'your sponsoring church' when the club has none on file, and adds up a multi-team event once", () => {
    const multi = event({
      multipleTeams: true,
      teams: [
        { teamKey: "a", teamName: "A", confirmationCode: "S1", status: "SUBMITTED", attendeeCount: 5, locationName: null },
        { teamKey: "b", teamName: "B", confirmationCode: "S2", status: "CONFIRMED", attendeeCount: 7, locationName: null },
      ] as ClubEventSummary["teams"],
    });
    const [card] = clubHomeEventCards([multi], { base, sponsoringChurch: null });
    expect(card).toMatchObject({ people: 12, lifecycle: "2 teams: Submitted, Confirmed" });
    expect(card!.billing).toBe("Billed to your sponsoring church after the event. Nothing to pay here.");
  });
});

describe("Home by role", () => {
  it("director: a saved draft is a Continue form task (the one filled button), the roster and event are outlined", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("DIRECTOR"));
    mocks.listSubmissionsForViewer.mockResolvedValue([draftRow, { ...draftRow, id: "other-year", clubYear: "2025-26" }, { ...draftRow, id: "sent", status: "SUBMITTED" }]);
    mocks.listClubEvents.mockResolvedValue([registered("SUBMITTED")]);
    const html = await home();
    expect(html).toContain("Annual club information is saved as a draft, not submitted.");
    expect(html).toContain("Continue form");
    expect(html).toContain(`href="${base}/forms/submissions/draft-1"`);
    expect(html).not.toContain("other-year");
    // Exactly one filled primary on the whole screen.
    expect(count(html, "primary-button")).toBe(1);
    expect(html).toMatch(/class="primary-button club-event-action" href="\/account\/clubs\/club-1\/forms\/submissions\/draft-1"/);
    // Summary, roster, event and the capability-gated shortcuts.
    expect(html).toContain("Saved form drafts");
    expect(html).toContain("Open roster");
    expect(html).toContain("Useful this month");
    for (const href of ["/records", "/forms", "/club-info#club-team"]) expect(html).toContain(`href="${base}${href}"`);
    // Monthly Records keep their own words: no form status leaks into the event card or the reverse.
    expect(html).not.toContain("Monthly Record is due");
  });

  it("deputy: the same club forms, records and team shortcuts as a director", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("DEPUTY"));
    const html = await home();
    expect(mocks.listSubmissionsForViewer).toHaveBeenCalled();
    for (const href of ["/records", "/forms", "/club-info#club-team"]) expect(html).toContain(`href="${base}${href}"`);
  });

  it("registrar: roster and event registration, but no club forms, no records, no team link and no form lookup", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("REGISTRAR"));
    mocks.listClubEvents.mockResolvedValue([registered("SUBMITTED")]);
    const html = await home();
    expect(mocks.listSubmissionsForViewer).not.toHaveBeenCalled();
    expect(mocks.getClubReportYear).not.toHaveBeenCalled();
    expect(html).not.toContain("Saved form drafts");
    expect(html).not.toContain("Useful this month");
    expect(html).not.toContain("/forms");
    expect(html).not.toContain("/records");
    expect(html).not.toContain("club-team");
    expect(html).toContain("View club registration");
    expect(html).toContain("Roster people");
    expect(html).not.toContain("Monthly Record");
  });

  it("reporter: Monthly Records only, with a due record as the first task and no roster or event data", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(reporterAccess);
    // October is filed late-enough to be locked; nothing else is due, so no task and the link is the primary.
    let html = await home();
    expect(mocks.listRoster).not.toHaveBeenCalled();
    expect(mocks.listClubEvents).not.toHaveBeenCalled();
    expect(html).toContain("Open Monthly Records");
    expect(html).toContain("primary-button");
    expect(html).not.toContain("Roster");

    // A due-today record becomes the one filled task and the link is outlined.
    vi.setSystemTime(new Date("2026-11-10T18:00:00.000Z"));
    mocks.getClubReportYear.mockResolvedValue({ reports: [{ reportMonth: "2026-09" }], registrationOnTime: false });
    html = await home();
    expect(html).toContain("Monthly Record is due");
    expect(count(html, "primary-button")).toBe(1);
    expect(html).not.toContain("Continue form");
  });
});

describe("Home tasks come only from real data", () => {
  it("links 'Review roster' to the details filter when people have blank details, and counts only them", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("DIRECTOR"));
    mocks.listRoster.mockResolvedValue([person("1"), person("2", { gender: null }), person("3", { birthDateNeeded: true })]);
    const html = await home();
    expect(html).toContain("2 people need details on the roster.");
    expect(html).toContain("Review roster");
    expect(html).toContain(`href="${base}/roster?filter=details-needed"`);
  });

  it("invents nothing for a complete roster: no roster task, no form task, an honest empty note", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("DIRECTOR"));
    const html = await home();
    expect(html).not.toContain("Review roster");
    expect(html).not.toContain("Continue form");
    expect(html).toContain("Nothing is saved or due for this club year.");
    expect(html).not.toMatch(/caught up|ready|required|missing document/i);
  });

  it("keeps an open event's register step and an event draft's Continue wording", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("DIRECTOR"));
    mocks.listClubEvents.mockResolvedValue([event({ draft: { updatedAt: "2026-11-10T00:00:00.000Z", selectedCount: 3 } })]);
    const html = await home();
    expect(html).toContain("Finish registering for Synthetic Camporee");
    expect(html).toContain(">Continue");
    expect(html).toContain("Your club has not registered for a club event yet.");
  });
});

describe("Home empty, error and read-only states", () => {
  it("a new club with no roster, no events and no draft asks for people and shows plain empty cards", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("DIRECTOR"));
    mocks.listRoster.mockResolvedValue([]);
    const html = await home();
    expect(html).toContain("Add your club members to this year&#x27;s roster.");
    expect(html).toContain("Add people");
    expect(html).toContain("No one is on this year&#x27;s roster yet.");
    expect(html).toContain("No club events are open for your club right now.");
    // Zero counts are shown as zero, with their definitions, not as work.
    expect(html).toMatch(/Roster people<\/dt><dd class="club-home-count-value">0</);
    expect(html).toMatch(/Event registrations<\/dt><dd class="club-home-count-value">0</);
    expect(html).toMatch(/Saved form drafts<\/dt><dd class="club-home-count-value">0</);
  });

  it("says so when saved drafts could not be loaded, instead of showing zero", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("DIRECTOR"));
    mocks.listSubmissionsForViewer.mockRejectedValue(new Error("forms down"));
    const html = await home();
    expect(html).toContain("Saved club form drafts could not be loaded");
    expect(html).toMatch(/Saved form drafts<\/dt><dd class="club-home-count-value">Unavailable</);
  });

  it("a past year is read-only history: roster for that year, no tasks, no event card, View roster", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("DIRECTOR"));
    mocks.listSubmissionsForViewer.mockResolvedValue([{ ...draftRow, id: "old-draft", clubYear: "2025-26" }]);
    const html = await home({ year: "2025-26" });
    expect(mocks.listRoster).toHaveBeenCalledWith("club-1", "2025-26");
    expect(mocks.listClubEvents).not.toHaveBeenCalled();
    expect(mocks.getClubReportYear).not.toHaveBeenCalled();
    expect(html).toContain("Showing 2025–26 read-only.");
    expect(html).toContain(`href="${base}"`);
    expect(html).not.toContain("Continue club work");
    expect(html).not.toContain("Continue form");
    expect(html).not.toContain("View club registration");
    expect(html).not.toContain("Register");
    expect(html).toContain("View roster");
    expect(html).toContain(`href="${base}/roster?year=2025-26"`);
    expect(html).not.toContain("primary-button");
    expect(html).not.toContain("Upcoming deadlines");
    // The 2025-26 saved draft is counted for that year, and never as current work.
    expect(html).toMatch(/Saved form drafts<\/dt><dd class="club-home-count-value">1</);
  });

  it("ignores a year that is not one of the club's own year choices", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access("DIRECTOR"));
    await home({ year: "1999-00" });
    expect(mocks.listRoster).toHaveBeenCalledWith("club-1", "2026-27");
  });

  it("renders nothing for a club the viewer cannot open (the shell shows the gate)", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue({ state: "MFA_UNLOCK", club: access("DIRECTOR").club, methods: { code: true, passkey: false } });
    expect(await ClubHomePage({ params: Promise.resolve({ organizationId: "club-1" }) })).toBeNull();
    expect(mocks.listRoster).not.toHaveBeenCalled();
  });
});

describe("Home shortcuts follow capabilities", () => {
  it("lists only what the role may open", () => {
    const keys = (role: "DIRECTOR" | "REGISTRAR" | "REPORTER") =>
      clubHomeUsefulLinks({ base, capabilities: clubCapabilities(role), formsRole: role === "DIRECTOR" }).map((link) => link.key);
    expect(keys("DIRECTOR")).toEqual(["records", "forms", "team"]);
    expect(keys("REGISTRAR")).toEqual([]);
    expect(keys("REPORTER")).toEqual(["records"]);
    expect(leaderCapabilities.manageTeam).toBe(true);
  });
});
