import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The next-year roster prompt and checklist page (#414): who sees them, and
 * when. The prompt shows only to a director or deputy, on the current (editable)
 * year, from August through October; the checklist page refuses a registrar
 * with a plain notice and says which years it carries between.
 */

const mocks = vi.hoisted(() => ({
  getRosterAccessStateForPage: vi.fn(),
  getCarryForwardOffer: vi.fn(),
  clubPortalComplianceStatuses: vi.fn(),
  listRoster: vi.fn(),
  listClubHonorsPage: vi.fn(),
  listTransferClubOptions: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/club-rosters/access", () => ({ getRosterAccessStateForPage: mocks.getRosterAccessStateForPage }));
vi.mock("@/modules/club-rosters/carry-forward", () => ({ getCarryForwardOffer: mocks.getCarryForwardOffer }));
vi.mock("@/modules/background-checks/repository", () => ({ clubPortalComplianceStatuses: mocks.clubPortalComplianceStatuses }));
vi.mock("@/modules/club-rosters/repository", () => ({ listRoster: mocks.listRoster }));
vi.mock("@/modules/honors/member-honor-repository", () => ({ listClubHonorsPage: mocks.listClubHonorsPage }));
vi.mock("@/modules/club-transfers/repository", () => ({ listTransferClubOptions: mocks.listTransferClubOptions }));

import ClubRosterNextYearPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/roster/next-year/page";
import ClubRosterPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/roster/page";
import { ClubNewYearStatus } from "@/components/club-new-year-status";
import { ClubRosterCarryForward } from "@/components/club-roster-carry-forward";

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

const available = {
  state: "AVAILABLE",
  fromClubYear: "2026-27",
  toClubYear: "2027-28",
  candidates: [
    { memberId: "m1", firstName: "Robin", lastName: "Fixture", attendeeType: "YOUTH", role: "Pathfinder", classLevel: null, age: 12, transferring: false },
    { memberId: "m2", firstName: "Sam", lastName: "Fixture", attendeeType: "YOUTH", role: "Pathfinder", classLevel: null, age: 13, transferring: true },
  ],
};

function access(manageTeam: boolean) {
  return {
    state: "OPEN",
    club: { organizationId: "club-1", name: "Fixture Pathfinders", role: manageTeam ? "DIRECTOR" : "REGISTRAR", sponsoringChurch: null },
    capabilities: { roster: true, manageTeam, seeBirthDates: manageTeam },
    actor: { kind: "ATTENDEE", accountId: "a1", sessionId: "s1" },
  };
}

async function rosterHtml(year?: string) {
  const tree = await ClubRosterPage({
    params: Promise.resolve({ organizationId: "club-1" }),
    searchParams: Promise.resolve(year === undefined ? {} : { year }),
  });
  return renderToStaticMarkup(tree);
}

function setDay(day: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${day}T15:00:00Z`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRosterAccessStateForPage.mockResolvedValue(access(true));
  mocks.getCarryForwardOffer.mockResolvedValue(available);
  mocks.clubPortalComplianceStatuses.mockResolvedValue(null);
  mocks.listRoster.mockResolvedValue([]);
  mocks.listClubHonorsPage.mockResolvedValue([]);
  mocks.listTransferClubOptions.mockResolvedValue([]);
});

afterEach(() => vi.useRealTimers());

describe("the next-year prompt on the roster page (#414)", () => {
  it.each(["2027-08-15", "2027-09-20", "2027-10-31"])("a director sees it on %s", async (day) => {
    setDay(day);
    const html = await rosterHtml();
    expect(html).toContain("Start the 2027-28 roster");
    expect(html).toContain("/account/clubs/club-1/roster/next-year");
  });

  it.each(["2027-07-31", "2027-11-01", "2028-02-10"])("nobody sees it, and nothing is loaded, on %s", async (day) => {
    setDay(day);
    const html = await rosterHtml();
    expect(html).not.toContain("Start the 2027-28 roster");
    expect(mocks.getCarryForwardOffer).not.toHaveBeenCalled();
  });

  it("the read-only view of another year shows no prompt", async () => {
    setDay("2027-09-20");
    const html = await rosterHtml("2026-27");
    expect(html).toMatch(/read-only/);
    expect(html).not.toContain("Start the 2027-28 roster");
    expect(mocks.getCarryForwardOffer).not.toHaveBeenCalled();
  });

  it("a registrar sees no prompt", async () => {
    setDay("2027-09-20");
    mocks.getRosterAccessStateForPage.mockResolvedValue(access(false));
    expect(await rosterHtml()).not.toContain("Start the 2027-28 roster");
    expect(mocks.getCarryForwardOffer).not.toHaveBeenCalled();
  });

  it("shows no prompt once the club has started or has nobody to carry", async () => {
    setDay("2027-09-20");
    mocks.getCarryForwardOffer.mockResolvedValue({ state: "DONE", fromClubYear: "2026-27", toClubYear: "2027-28", confirmedAt: new Date() });
    expect(await rosterHtml()).not.toContain("Start the 2027-28 roster");
    mocks.getCarryForwardOffer.mockResolvedValue({ state: "NOTHING_TO_CARRY", fromClubYear: "2026-27", toClubYear: "2027-28" });
    expect(await rosterHtml()).not.toContain("Start the 2027-28 roster");
  });
});

describe("the next-year page (#414)", () => {
  const render = async () => ClubRosterNextYearPage({ params: Promise.resolve({ organizationId: "club-1" }) });

  it("a registrar sees a notice and nothing is loaded", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(access(false));
    const tree = await render();
    expect(renderToStaticMarkup(tree)).toContain("doesn&#x27;t include starting a new year");
    expect(componentElements(tree).some((element) => element.type === ClubRosterCarryForward)).toBe(false);
    expect(mocks.getCarryForwardOffer).not.toHaveBeenCalled();
  });

  it("renders nothing while the second step is pending", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue({ state: "MFA_UNLOCK" });
    expect(await render()).toBeNull();
  });

  it("works outside August and says which years it carries from and to", async () => {
    setDay("2028-01-20");
    const tree = await render();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Carries people from the 2026-27 roster to the 2027-28 roster.");
    expect(componentElements(tree).some((element) => element.type === ClubRosterCarryForward)).toBe(true);
  });

  it("says so when the year was already started", async () => {
    mocks.getCarryForwardOffer.mockResolvedValue({ state: "DONE", fromClubYear: "2026-27", toClubYear: "2027-28", confirmedAt: new Date() });
    const tree = await render();
    expect(renderToStaticMarkup(tree)).toContain("already started its 2027-28 roster");
    expect(componentElements(tree).some((element) => element.type === ClubRosterCarryForward)).toBe(false);
  });
});

describe("the checklist (#414)", () => {
  it("flags and unticks a person with an open transfer", () => {
    const html = renderToStaticMarkup(
      createElement(ClubRosterCarryForward, { fromClubYear: "2026-27", organizationId: "club-1", rows: available.candidates as never, toClubYear: "2027-28" }),
    );
    expect(html).toContain("Transferring to another club");
    expect(html).toMatch(/aria-label="Carry Robin Fixture forward"[^>]*checked/);
    expect(html).not.toMatch(/aria-label="Carry Sam Fixture forward"[^>]*checked/);
    expect(html).toContain("Start the 2027-28 roster with 1 person");
  });

  it("notes a declined transfer neutrally and leaves that person ticked", () => {
    const rows = [{ ...available.candidates[0]!, memberId: "m3", firstName: "Kim", transferring: false, transferWithStaff: true }];
    const html = renderToStaticMarkup(
      createElement(ClubRosterCarryForward, { fromClubYear: "2026-27", organizationId: "club-1", rows: rows as never, toClubYear: "2027-28" }),
    );
    expect(html).toContain("Transfer request is with conference staff");
    expect(html).not.toContain("Transferring to another club");
    expect(html).toMatch(/aria-label="Carry Kim Fixture forward"[^>]*checked/);
  });
});

describe("the not-started list for staff and Area Coordinators (#414)", () => {
  const status = {
    toClubYear: "2027-28",
    clubs: [{ organizationId: "c1" }, { organizationId: "c2" }],
    notStarted: [{ organizationId: "c2", name: "Late Pathfinders", church: "First Church", lastYearActive: 14 }],
  };

  it("lists clubs that haven't started, with counts only", () => {
    const html = renderToStaticMarkup(createElement(ClubNewYearStatus, { clubHref: (id: string) => `/club/${id}`, status }));
    expect(html).toContain("1 of 2 clubs");
    expect(html).toContain("Late Pathfinders");
    expect(html).toContain("14");
    expect(html).toContain('href="/club/c2"');
  });

  it("renders nothing without a status or without clubs", () => {
    expect(renderToStaticMarkup(createElement(ClubNewYearStatus, { clubHref: () => "/", status: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(ClubNewYearStatus, { clubHref: () => "/", status: { ...status, clubs: [], notStarted: [] } }))).toBe("");
  });

  it("says when every club has started", () => {
    const html = renderToStaticMarkup(createElement(ClubNewYearStatus, { clubHref: () => "/", status: { ...status, notStarted: [] } }));
    expect(html).toContain("Every club has started.");
  });
});
