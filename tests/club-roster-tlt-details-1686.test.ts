import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A club's director and deputy see their own TLTs' year and help-area tags on their own roster, read-only (#1686,
 * Caleb, November 12). Nobody else does: not a registrar, not another club's director, not an Area Coordinator, and
 * never another club's TLTs. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  getRosterAccessStateForPage: vi.fn(),
  clubPortalComplianceStatuses: vi.fn(),
  listRoster: vi.fn(),
  listTransferClubOptions: vi.fn(),
  rosterFindMany: vi.fn(),
  profileFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/club-roster-charts/repository", () => ({ rosterChartsAvailable: async () => false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ clubRosterMember: { findMany: mocks.rosterFindMany }, tltProfile: { findMany: mocks.profileFindMany } }) }));
vi.mock("@/modules/club-rosters/access", () => ({ getRosterAccessStateForPage: mocks.getRosterAccessStateForPage }));
vi.mock("@/modules/background-checks/repository", () => ({ clubPortalComplianceStatuses: mocks.clubPortalComplianceStatuses }));
vi.mock("@/modules/club-rosters/repository", () => ({ listRoster: mocks.listRoster }));
vi.mock("@/modules/club-transfers/repository", () => ({ isGuestClub: async () => false, listTransferClubOptions: mocks.listTransferClubOptions }));
vi.mock("@/modules/club-rosters/guardians-access", () => ({ rosterGuardiansForAccess: async () => ({}) }));
vi.mock("@/modules/club-features/roster-health", () => ({ rosterHealthAvailable: async () => false }));
vi.mock("@/modules/staff-training/repository", () => ({ staffTrainingAvailable: async () => false }));
vi.mock("@/modules/club-rosters/carry-forward", () => ({ getCarryForwardOffer: async () => ({ state: "NOTHING_TO_CARRY" }) }));

import ClubRosterPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/roster/page";
import { ClubRosterWorkspace } from "@/components/club-roster-workspace";
import { clubCapabilities, type ClubRole } from "@/modules/organizations/director-grants-domain";
import { clubTltDetailsVisible, listClubTltDetails } from "@/modules/tlt-directory/club-view";
import type { RosterMemberRecord } from "@/modules/club-rosters/repository";

type AnyProps = Record<string, unknown>;
function workspaceProps(node: ReactNode): AnyProps | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = workspaceProps(child); if (found) return found; }
    return undefined;
  }
  if (!isValidElement<AnyProps>(node)) return undefined;
  if (node.type === ClubRosterWorkspace) return node.props;
  return workspaceProps(node.props.children as ReactNode);
}

const tlt: RosterMemberRecord = {
  id: "member-tlt", personId: "person-1", firstName: "Casey", lastName: "Sample", attendeeType: "YOUTH", role: "Pathfinder", classLevel: null, isTlt: true,
  gender: null, status: "ACTIVE", source: "IMPORT", age: 15, reportedAge: null, birthDateNeeded: false, updatedAt: "2026-09-01T00:00:00.000Z",
};
const plain: RosterMemberRecord = { ...tlt, id: "member-plain", personId: "person-2", firstName: "Dana", lastName: "Example", isTlt: false };

const open = (role: ClubRole) => ({
  state: "OPEN",
  club: { organizationId: "club-1", name: "Sample Pathfinders", role, sponsoringChurch: null },
  capabilities: clubCapabilities(role),
  actor: { kind: "ATTENDEE" as const, accountId: "account-1", sessionId: "session-1" },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  mocks.clubPortalComplianceStatuses.mockResolvedValue(null);
  mocks.listRoster.mockResolvedValue([tlt, plain]);
  mocks.listTransferClubOptions.mockResolvedValue([]);
  mocks.rosterFindMany.mockResolvedValue([{ id: "member-tlt", personId: "person-1" }]);
  mocks.profileFindMany.mockResolvedValue([{ personId: "person-1", tltYear: 2, tags: [{ tag: { name: "Setup", sortOrder: 0 } }, { tag: { name: "Games", sortOrder: 1 } }] }]);
});
afterEach(() => vi.useRealTimers());

// The roster page also asks which people moved clubs; only the TLT lookup carries `isTlt`.
const tltLookups = () => mocks.rosterFindMany.mock.calls.filter((call) => call[0].where.isTlt === true);
const render = () => ClubRosterPage({ params: Promise.resolve({ organizationId: "club-1" }), searchParams: Promise.resolve({}) });

describe("who sees a TLT's year and tags on the club roster (#1686)", () => {
  it.each([
    ["DIRECTOR", true],
    ["DEPUTY", true],
    ["REGISTRAR", false],
    ["REPORTER", false],
  ] as const)("the club's %s: %s", (role, sees) => {
    expect(clubTltDetailsVisible(open(role), false)).toBe(sees);
  });

  it("is not shown to staff acting as director through Clubs Administration, but is to the club's own people", () => {
    const acting = (viaClubsAdministrator: boolean) => ({
      ...open("DIRECTOR"),
      actor: { kind: "STAFF_ACTING" as const, ...(viaClubsAdministrator ? { viaClubsAdministrator: true as const } : {}) },
    });
    expect(clubTltDetailsVisible(acting(true), false)).toBe(false);
    expect(clubTltDetailsVisible(acting(false), false)).toBe(true);
    expect(clubTltDetailsVisible(open("DEPUTY"), false)).toBe(true);
  });

  it("is not shown on a read-only year", () => {
    expect(clubTltDetailsVisible(open("DIRECTOR"), true)).toBe(false);
  });

  it("gives the own-club director and deputy the year and tags, read-only, for the TLTs only", async () => {
    for (const role of ["DIRECTOR", "DEPUTY"] as const) {
      mocks.getRosterAccessStateForPage.mockResolvedValue(open(role));
      const props = workspaceProps(await render())!;
      expect(props.tltDetails).toEqual({ "member-tlt": { tltYear: 2, tags: ["Setup", "Games"] } });
    }
    // Only the flagged members are looked up.
    expect(tltLookups()[0]![0].where.id).toEqual({ in: ["member-tlt"] });
  });

  it("gives a registrar nothing, and reads nothing", async () => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(open("REGISTRAR"));
    const props = workspaceProps(await render())!;
    expect(props.tltDetails).toBeUndefined();
    expect(tltLookups()).toHaveLength(0);
    expect(mocks.profileFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ["another club's director (not found)", { state: "NOT_FOUND" }],
    ["someone signed out", { state: "SIGN_IN" }],
    ["a role with no roster", { state: "NO_ROSTER", club: open("REPORTER").club, capabilities: clubCapabilities("REPORTER") }],
    ["a director who has not passed the second step", { state: "SECOND_STEP_REQUIRED", club: open("DIRECTOR").club }],
  ])("shows %s no roster and reads no TLT", async (_who, state) => {
    mocks.getRosterAccessStateForPage.mockResolvedValue(state);
    const tree = await render();
    expect(workspaceProps(tree)).toBeUndefined();
    expect(mocks.listRoster).not.toHaveBeenCalled();
    expect(mocks.rosterFindMany).not.toHaveBeenCalled();
    expect(mocks.profileFindMany).not.toHaveBeenCalled();
  });

  it("is a director-only page: the Area Coordinator club page never loads it", () => {
    for (const file of [
      "app/(public)/account/(portal)/area/[organizationId]/page.tsx",
      "app/(workspace)/admin/organizations/[organizationId]/club/page.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/tlt-directory|tltDetails/);
    }
  });
});

describe("reading one club's TLT details (#1686)", () => {
  it("starts from this club's current roster, so another club's TLT is never reached", async () => {
    await listClubTltDetails("club-1", ["member-tlt", "member-of-another-club"]);
    expect(tltLookups()[0]![0].where).toMatchObject({
      organizationId: "club-1", clubYear: "2026-27", attendeeType: "YOUTH", isTlt: true, status: "ACTIVE",
    });
    // Profiles are read only for the people that query returned.
    expect(mocks.profileFindMany.mock.calls[0]![0].where).toEqual({ personId: { in: ["person-1"] } });
  });

  it("returns year and tag names only: no position, status, answers or other club", async () => {
    const details = await listClubTltDetails("club-1", ["member-tlt"]);
    expect(details).toEqual({ "member-tlt": { tltYear: 2, tags: ["Setup", "Games"] } });
    expect(mocks.profileFindMany.mock.calls[0]![0].select).toEqual({ personId: true, tltYear: true, tags: { select: { tag: { select: { name: true, sortOrder: true } } } } });
    expect(tltLookups()[0]![0].select).toEqual({ id: true, personId: true });
  });

  it("shows 'Year not set' for a TLT with no record yet and reads nothing for an empty roster", async () => {
    mocks.profileFindMany.mockResolvedValue([]);
    expect(await listClubTltDetails("club-1", ["member-tlt"])).toEqual({ "member-tlt": { tltYear: null, tags: [] } });
    mocks.rosterFindMany.mockClear();
    expect(await listClubTltDetails("club-1", [])).toEqual({});
    expect(mocks.rosterFindMany).not.toHaveBeenCalled();
  });
});

describe("the roster shows it, without any control (#1686)", () => {
  const html = (tltDetails?: Record<string, { tltYear: number | null; tags: string[] }>) => renderToStaticMarkup(
    ClubRosterWorkspace({ canSeeBirthDates: true, clubYear: "2026-27", initialMembers: [tlt, plain], organizationId: "club-1", tltDetails }) as ReactElement,
  );

  it("is plain text beside the TLT chip, and absent without details", () => {
    const withDetails = html({ "member-tlt": { tltYear: 2, tags: ["Setup", "Games"] } });
    expect(withDetails).toContain("Year 2 · Setup, Games");
    expect(withDetails).not.toContain("Year not set");
    expect(html()).not.toMatch(/Year \d|Year not set|help areas/);
  });

  it("says so plainly when a TLT has no year or tags yet", () => {
    expect(html({ "member-tlt": { tltYear: null, tags: [] } })).toContain("Year not set · No help areas yet");
  });
});
