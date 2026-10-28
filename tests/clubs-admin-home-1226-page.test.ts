import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeClub } from "@/modules/club-reports/area-summary-domain";

/** #1226: the page's gate and what it shows to each viewer. Synthetic data only. */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  hasClubsAdministration: vi.fn(),
  resolveAdminRoles: vi.fn(),
  getAreaClubsSummary: vi.fn(),
  listAreaClubEvents: vi.fn(),
  listNewClubApplications: vi.fn(),
  countWaitingNewClubApplications: vi.fn(),
  getRequiredFormsStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: mocks.hasClubsAdministration, resolveAdminRoles: mocks.resolveAdminRoles }));
vi.mock("@/modules/club-reports/area-summary-repository", () => ({ getAreaClubsSummary: mocks.getAreaClubsSummary, listAreaClubEvents: mocks.listAreaClubEvents }));
vi.mock("@/modules/club-forms/required", () => ({ getRequiredFormsStatus: mocks.getRequiredFormsStatus }));
vi.mock("@/modules/club-applications/repository", () => ({ listNewClubApplications: mocks.listNewClubApplications, countWaitingNewClubApplications: mocks.countWaitingNewClubApplications }));

import ClubsAdminPage from "@/app/(workspace)/admin/clubs/page";

const now = new Date("2026-10-26T18:00:00.000Z");
const clubYearNow = "2026-27";
const synthetic = (id: string, name: string, rosterSize: number) => summarizeClub({
  id, name, church: `${name} Church`, directors: [], rosterSize, registrationOnTime: true,
  backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 }, reports: [],
}, clubYearNow, now);

const nextStart = "2026-11-14T15:00:00.000Z";
const render = async (search: { year?: string; q?: string } = {}) => renderToStaticMarkup(await ClubsAdminPage({ searchParams: Promise.resolve(search) }));

const pending = (id: string, needsChoice = false) => ({
  id, status: "PENDING", clubName: `Club ${id}`, submittedAt: "2026-10-10T15:00:00.000Z", otherBoardMembers: ["A", "B"],
  church: { name: `Church ${id}`, needsChoice }, director: { email: `${id}@example.test` },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: null, displayName: "Synthetic Admin", email: "admin@example.test" } });
  mocks.hasClubsAdministration.mockResolvedValue(true);
  mocks.resolveAdminRoles.mockResolvedValue({ systemAdmin: false, clubsAdministrator: true, eventAdminEventIds: [] });
  mocks.getAreaClubsSummary.mockResolvedValue([synthetic("c1", "Alpha Pathfinders", 12), synthetic("c2", "Beta Adventurers", 8)]);
  mocks.listAreaClubEvents.mockResolvedValue([{ id: "evt-1", name: "Synthetic Camporee", startsAt: nextStart, clubs: [
    { organizationId: "c1", name: "Alpha Pathfinders", status: "REGISTERED", headcount: 14 },
    { organizationId: "c2", name: "Beta Adventurers", status: "NOT_REGISTERED", headcount: null },
  ] }]);
  mocks.listNewClubApplications.mockResolvedValue([pending("app-1"), pending("app-2", true)]);
  mocks.countWaitingNewClubApplications.mockResolvedValue(2);
  mocks.getRequiredFormsStatus.mockResolvedValue([]);
});

afterEach(() => vi.useRealTimers());

describe("the gate", () => {
  it("sends a signed-out visitor to the staff login", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(render()).rejects.toThrow("redirect:/login");
  });

  it("sends anyone without clubs administration to /no-access and reads nothing", async () => {
    mocks.hasClubsAdministration.mockResolvedValue(false);
    await expect(render()).rejects.toThrow("redirect:/no-access");
    expect(mocks.getAreaClubsSummary).not.toHaveBeenCalled();
    expect(mocks.listNewClubApplications).not.toHaveBeenCalled();
  });

  it("reads with the Clubs Administrator viewer, or the system administrator one", async () => {
    await render();
    expect(mocks.listNewClubApplications).toHaveBeenCalledWith("CLUBS_ADMIN");
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u2", globalRole: "SYSTEM_ADMIN", displayName: "Sys", email: "sys@example.test" } });
    await render();
    expect(mocks.listNewClubApplications).toHaveBeenLastCalledWith("SYSTEM_ADMIN");
    expect(mocks.countWaitingNewClubApplications).toHaveBeenLastCalledWith("SYSTEM_ADMIN");
  });

  it("is dynamic and has no client-side data loading", () => {
    const text = readFileSync(join(process.cwd(), "app/(workspace)/admin/clubs/page.tsx"), "utf8");
    expect(text).toContain('export const dynamic = "force-dynamic"');
    expect(text).not.toContain('"use client"');
  });
});

describe("what it shows", () => {
  it("renders the header, cards and sections for a Clubs Administrator", async () => {
    const html = await render();
    expect(html).toContain("Club administration");
    expect(html).toContain("All clubs and applications");
    expect(html).toContain("Signed in as <strong>Synthetic Admin</strong> (admin@example.test)");
    expect(html).toMatch(/<a aria-current="page" href="\/admin\/clubs\?year=[\d-]+">Overview</);
    expect(html).toContain("New clubs (2)");
    expect(html).toContain("1 of 2");
    expect(html).toContain("<strong>20</strong> roster members");
    expect(html).toContain("<strong>14</strong> people registered");
    expect(html).toContain('id="registered-clubs"');
    expect(html).toContain("Only the buttons in this list decide an application.");
    expect(html).toContain("Only registered clubs count toward an event&#x27;s total.");
    expect(html).toContain("Monthly records to review");
    expect(html).toContain("Clubs with forms missing");
    expect(html).toContain("/admin/club-forms?view=missing&amp;year=2026-27");
    expect(html).toContain("/admin/clubs/reports?year=2026-27&amp;month=2026-10&amp;review=to-review");
    expect(html).toContain(`name="year"`);
  });

  it("shows the year and search in the form controls and keeps the year in links", async () => {
    const html = await render({ year: "2024-25", q: "alpha" });
    expect(html).toContain("year=2024-25");
    expect(html).toContain('value="alpha"');
    expect(mocks.getAreaClubsSummary).toHaveBeenCalledWith("2024-25", expect.any(Date), { backgroundChecks: false });
    expect(mocks.listAreaClubEvents).toHaveBeenCalledWith("2024-25");
  });

  it("hides the event links from a Clubs Administrator with no event access", async () => {
    const html = await render();
    expect(html).not.toContain("/overview?event=");
    expect(html).not.toContain("/more/kitchen-report?event=");
    expect(html).toContain("Ask the event&#x27;s administrator for the event workspace.");
  });

  it("shows them to a Clubs Administrator who is also an Event Admin on that event", async () => {
    mocks.resolveAdminRoles.mockResolvedValue({ systemAdmin: false, clubsAdministrator: true, eventAdminEventIds: ["evt-1"] });
    const html = await render();
    expect(html).toContain('href="/overview?event=evt-1"');
    expect(html).toContain('href="/more/kitchen-report?event=evt-1"');
  });

  it("shows them to a system administrator", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u2", globalRole: "SYSTEM_ADMIN", displayName: "Sys", email: "sys@example.test" } });
    const html = await render();
    expect(html).toContain('href="/overview?event=evt-1"');
    expect(html).toContain('href="/more/kitchen-report?event=evt-1"');
  });

  it("offers Approve only when no church choice is needed", async () => {
    const html = await render();
    const first = html.slice(html.indexOf('data-application-id="app-1"'), html.indexOf('data-application-id="app-2"'));
    const second = html.slice(html.indexOf('data-application-id="app-2"'));
    expect(first).toContain(">Approve<");
    expect(first).toContain("/admin/clubs/applications#application-app-1");
    expect(second).not.toContain(">Approve<");
    expect(second).toContain("Review first: choose a church.");
    expect(second).toContain("/admin/clubs/applications#application-app-2");
  });

  it.each([
    ["a possible duplicate", { duplicates: [{ kind: "NAME" }] }, "possible duplicate club"],
    ["an invite email mismatch", { invitedEmailDiffers: true }, "director email differs from the invited address"],
    ["a Sterling flag", { sterling: "FLAGGED" }, "Sterling Volunteers status needs a look"],
    ["an ambiguous Sterling match", { sterlingAmbiguous: true }, "director email matches more than one person"],
    ["a Sterling name mismatch", { sterlingNameMismatch: true }, "director email matched a different name"],
  ])("shows no Approve for %s, only Review first", async (_label, flags, reason) => {
    mocks.listNewClubApplications.mockResolvedValue([{ ...pending("app-1"), sterling: "CLEAR", duplicates: [], ...flags }]);
    mocks.countWaitingNewClubApplications.mockResolvedValue(1);
    const html = await render();
    expect(html).not.toContain(">Approve<");
    expect(html).toContain(`Review first: ${reason}.`);
    expect(html).toContain("/admin/clubs/applications#application-app-1");
  });

  it("shows Approve for a clean application and keeps focus and status targets", async () => {
    mocks.listNewClubApplications.mockResolvedValue([{ ...pending("app-1"), sterling: "CLEAR", duplicates: [], invitedEmailDiffers: false }]);
    const html = await render();
    expect(html).toContain(">Approve<");
    expect(html).toContain('id="new-clubs-heading" tabindex="-1"');
    expect(html).toContain('data-testid="new-clubs-status"');
    expect(html).toContain("Search by club or church name");
    expect(html).toContain("Every active club today; records below are for club year 2026-27");
  });

  it("says so when no club event is coming", async () => {
    mocks.listAreaClubEvents.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("None");
    expect(html).toContain("No upcoming club events this club year");
    expect(html).not.toContain("/overview?event=");
  });
});

describe("the review and forms-missing cards match the pages they link to (#1246)", () => {
  const submittedRecord = (reviewedAt?: Date) => [{ reportMonth: "2026-10", status: "SUBMITTED" as const, totalPoints: 60, onTimePoints: 50, reviewedAt }];
  const withRecord = (id: string, name: string, reviewedAt?: Date) => summarizeClub({
    id, name, church: `${name} Church`, directors: [], rosterSize: 3, registrationOnTime: true,
    backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 }, reports: submittedRecord(reviewedAt),
  }, clubYearNow, now);

  it("counts submitted and not reviewed, and shows Reviewed in the clubs table", async () => {
    mocks.getAreaClubsSummary.mockResolvedValue([withRecord("c1", "Alpha Pathfinders"), withRecord("c2", "Beta Adventurers", new Date("2026-10-20T12:00:00Z")), withRecord("c3", "Gamma Pathfinders")]);
    const html = await render();
    expect(html).toMatch(/data-card="monthly-records"[^>]*>.*?<strong>2<\/strong>/);
    expect(html).toContain("Reviewed");
    expect(html).toContain(">Submitted<");
  });

  it("counts clubs with forms missing from the same status the list page reads", async () => {
    mocks.getRequiredFormsStatus.mockResolvedValue([
      { id: "c1", name: "Alpha Pathfinders", church: "", items: [{ templateKey: "can", name: "Can", requirement: "ONCE_PER_CLUB_YEAR", roles: [], status: "MISSING", missingMembers: [], memberCount: 0 }] },
      { id: "c2", name: "Beta Adventurers", church: "", items: [{ templateKey: "can", name: "Can", requirement: "ONCE_PER_CLUB_YEAR", roles: [], status: "DONE", missingMembers: [], memberCount: 0 }] },
    ]);
    const html = await render();
    expect(html).toMatch(/data-card="forms-missing"[^>]*>.*?<strong>1<\/strong>/);
    expect(mocks.getRequiredFormsStatus).toHaveBeenCalledWith("2026-27");
  });
});
