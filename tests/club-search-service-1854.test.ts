import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Club portal search (#1854): what each club role gets from `searchClubPortal`. The real access functions
 * (`getClubRoleAccess`, `getRosterAccessState`) run over mocked sessions, grants and a fake database, so a member is only
 * returned when the roster page's own gate is OPEN, and the member query is never made otherwise. Synthetic names only.
 */

type Row = Record<string, unknown>;

const NOW = new Date("2027-02-01T12:00:00.000Z");
const database = vi.hoisted(() => ({
  members: [] as { id: string; organizationId: string; clubYear: string; status: string; sealedBirthDate: string; person: { firstName: string; lastName: string } | null }[],
  memberCalls: [] as Row[],
}));

const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  currentStaffActingContext: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  mfaEnrollment: vi.fn(),
  session: vi.fn(),
  organization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: async () => false }));
vi.mock("@/modules/attendee-accounts/return-redirect", () => ({ twoStepRedirectPath: async () => "/account/two-step" }));

const contains = (condition: unknown, value: unknown) => typeof value === "string" && value.toLowerCase().includes(String((condition as { contains: string }).contains).toLowerCase());
function personMatches(where: Row, person: { firstName: string; lastName: string }): boolean {
  return (where.AND as Row[]).every((term) => (term.OR as Row[]).some((field) => Object.entries(field).every(([key, condition]) => contains(condition, (person as Record<string, string>)[key]))));
}

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    attendeeMfaEnrollment: { findUnique: mocks.mfaEnrollment },
    attendeePasskey: { count: async () => 0 },
    attendeeSession: { findUnique: mocks.session },
    organization: { findUnique: mocks.organization },
    clubRosterMember: {
      findMany: vi.fn(async (args: { where: Row; take: number; select: Row }) => {
        database.memberCalls.push(args);
        const where = args.where as { organizationId: { in: string[] }; clubYear: string; status: { not: string }; person: { is: Row } };
        return database.members
          .filter((row) => where.organizationId.in.includes(row.organizationId) && row.clubYear === where.clubYear && row.status !== where.status.not)
          .filter((row) => row.person && personMatches(where.person.is, row.person))
          .sort((a, b) => a.person!.lastName.localeCompare(b.person!.lastName) || a.person!.firstName.localeCompare(b.person!.firstName))
          .slice(0, args.take)
          .map((row) => ({ id: row.id, organizationId: row.organizationId, person: row.person }));
      }),
    },
  }),
}));

import {
  CLUB_SEARCH_GROUP_LIMIT,
  clubRosterSearchHref,
} from "@/modules/club-search/domain";
import { getClubSearchViewer, searchClubPortal, clubSearchRateLimitKey } from "@/modules/club-search/service";

const club = (organizationId: string, name: string, role: string, sponsoringChurch: string | null = "Synthville Church") => ({ organizationId, name, role, sponsoringChurch });
const member = (id: string, organizationId: string, firstName: string, lastName: string, extra: Row = {}) => ({
  id, organizationId, clubYear: "2026-27", status: "ACTIVE", sealedBirthDate: "sealed-synthetic", person: { firstName, lastName }, ...extra,
});

const account = { id: "acct_synthetic", verifiedEmail: "leader@example.test", displayName: "Synthetic Leader" };
const attendee = (via: "attendee" | "staff" = "attendee") => mocks.getCurrentAttendee.mockResolvedValue({ account, via, sessionId: "sess_1" });
const directed = (...clubs: ReturnType<typeof club>[]) => mocks.listDirectedClubs.mockResolvedValue(clubs);
const unlocked = () => {
  mocks.mfaEnrollment.mockResolvedValue({ status: "ACTIVE" });
  mocks.session.mockResolvedValue({ secondFactorVerifiedAt: new Date(NOW.getTime() - 3_600_000) });
};

const ALPHA = club("org_alpha", "Alpha Pathfinders", "DIRECTOR");
const BETA = club("org_beta", "Beta Adventurers", "DIRECTOR", "Beta Church");
const viewer = { kind: "ATTENDEE", accountId: account.id } as const;

beforeEach(() => {
  vi.resetAllMocks();
  database.memberCalls.length = 0;
  database.members = [
    member("m1", "org_alpha", "Ada", "Lovelace"),
    member("m2", "org_alpha", "Adam", "Smith"),
    member("m3", "org_alpha", "Removed", "Person", { status: "REMOVED" }),
    member("m4", "org_alpha", "Old", "Year", { clubYear: "2025-26" }),
    member("m5", "org_beta", "Ada", "Betaclub"),
    member("m6", "org_other", "Ada", "Stranger"),
  ];
  attendee();
  directed(ALPHA);
  unlocked();
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.organization.mockResolvedValue(null);
});

describe("searchClubPortal: club director", () => {
  it("finds members of the director's own club only, current year, not removed", async () => {
    const result = await searchClubPortal(viewer, "ada", NOW);
    expect(result.members.items.map((m) => m.name)).toEqual(["Ada Lovelace", "Adam Smith"]);
    expect(database.memberCalls).toHaveLength(1);
    expect(database.memberCalls[0].where).toMatchObject({ organizationId: { in: ["org_alpha"] }, clubYear: "2026-27", status: { not: "REMOVED" } });
  });

  it("never returns another club's members, even with the same first name", async () => {
    const names = (await searchClubPortal(viewer, "ada", NOW)).members.items.map((m) => m.name);
    expect(names).not.toContain("Ada Betaclub");
    expect(names).not.toContain("Ada Stranger");
  });

  it("requires every word to match a name field, case-insensitively", async () => {
    expect((await searchClubPortal(viewer, "ADA love", NOW)).members.items.map((m) => m.name)).toEqual(["Ada Lovelace"]);
    expect((await searchClubPortal(viewer, "lovelace smith", NOW)).members.items).toEqual([]);
  });

  it("holds only id, name, club label and href for a member", async () => {
    const result = await searchClubPortal(viewer, "lovelace", NOW);
    expect(result.members.items).toEqual([{ name: "Ada Lovelace", club: null, href: "/account/clubs/org_alpha/roster?q=Ada+Lovelace" }]);
    expect(Object.keys(result.members.items[0]).sort()).toEqual(["club", "href", "name"]);
    expect(JSON.stringify(result)).not.toContain("sealed");
  });

  it("selects only the id and the first and last name from the database", async () => {
    await searchClubPortal(viewer, "ada", NOW);
    expect(database.memberCalls[0].select).toEqual({ organizationId: true, person: { select: { firstName: true, lastName: true } } });
  });

  it("finds the club by name or sponsoring church and links to its portal", async () => {
    expect((await searchClubPortal(viewer, "pathfind", NOW)).clubs.items).toEqual([
      { id: "org_alpha", name: "Alpha Pathfinders", sponsoringChurch: "Synthville Church", href: "/account/clubs/org_alpha" },
    ]);
    expect((await searchClubPortal(viewer, "synthville church", NOW)).clubs.items.map((c) => c.id)).toEqual(["org_alpha"]);
  });

  it("returns an empty result and reads nothing for words with no letter or digit", async () => {
    for (const words of ["", "   ", "--", null, undefined]) {
      const result = await searchClubPortal(viewer, words, NOW);
      expect(result.clubs.items).toEqual([]);
      expect(result.members.items).toEqual([]);
    }
    expect(mocks.listDirectedClubs).not.toHaveBeenCalled();
    expect(database.memberCalls).toHaveLength(0);
  });

  it("shows five rows and a more note, with a See all link only for a single club's roster", async () => {
    database.members = Array.from({ length: 7 }, (_, i) => member(`mm${i}`, "org_alpha", "Sam", `Synth${i}`));
    const result = await searchClubPortal(viewer, "sam", NOW);
    expect(result.members.items).toHaveLength(CLUB_SEARCH_GROUP_LIMIT);
    expect(result.members.more).toBe(true);
    expect(result.members.seeAllHref).toBe(clubRosterSearchHref("org_alpha", "sam"));
    expect(database.memberCalls[0].take).toBe(CLUB_SEARCH_GROUP_LIMIT * 2 + 1);
  });
});

describe("searchClubPortal: more than one club", () => {
  beforeEach(() => {
    directed(ALPHA, BETA);
  });

  it("labels each member with the club name and searches both clubs", async () => {
    const result = await searchClubPortal(viewer, "ada", NOW);
    expect(result.members.items.map((m) => [m.name, m.club])).toEqual([
      ["Ada Betaclub", "Beta Adventurers"],
      ["Ada Lovelace", "Alpha Pathfinders"],
      ["Adam Smith", "Alpha Pathfinders"],
    ]);
    expect(result.members.items.find((m) => m.name === "Ada Betaclub")?.href).toBe("/account/clubs/org_beta/roster?q=Ada+Betaclub");
    expect(result.members.seeAllHref).toBeNull();
  });

  it("lists the clubs that match the words, name or church", async () => {
    expect((await searchClubPortal(viewer, "beta", NOW)).clubs.items.map((c) => c.id)).toEqual(["org_beta"]);
    expect((await searchClubPortal(viewer, "church", NOW)).clubs.items.map((c) => c.id)).toEqual(["org_alpha", "org_beta"]);
  });

  it("gives a director's clubs only where that club's own gate is open", async () => {
    directed(ALPHA, club("org_beta", "Beta Adventurers", "REPORTER"));
    const result = await searchClubPortal(viewer, "ada", NOW);
    expect(result.members.items.map((m) => m.name)).toEqual(["Ada Lovelace", "Adam Smith"]);
    expect(database.memberCalls[0].where).toMatchObject({ organizationId: { in: ["org_alpha"] } });
    expect(result.clubs.items.map((c) => c.id)).toEqual([]);
  });
});

describe("searchClubPortal: deputy and registrar", () => {
  it("gives a deputy members and clubs", async () => {
    directed(club("org_alpha", "Alpha Pathfinders", "DEPUTY"));
    const result = await searchClubPortal(viewer, "ada", NOW);
    expect(result.members.items.map((m) => m.name)).toEqual(["Ada Lovelace", "Adam Smith"]);
    expect(result.clubs.items.map((c) => c.id)).toEqual([]);
    expect((await searchClubPortal(viewer, "alpha", NOW)).clubs.items.map((c) => c.id)).toEqual(["org_alpha"]);
  });

  it("gives a registrar members, with no extra fields", async () => {
    directed(club("org_alpha", "Alpha Pathfinders", "REGISTRAR"));
    const result = await searchClubPortal(viewer, "lovelace", NOW);
    expect(result.members.items.map((m) => Object.keys(m).sort())).toEqual([["club", "href", "name"]]);
  });
});

describe("searchClubPortal: roles and states that get no members", () => {
  it("gives a reporter the club but no members, and makes no member query", async () => {
    directed(club("org_alpha", "Alpha Pathfinders", "REPORTER"));
    const result = await searchClubPortal(viewer, "alpha", NOW);
    expect(result.clubs.items.map((c) => c.id)).toEqual(["org_alpha"]);
    expect((await searchClubPortal(viewer, "ada", NOW)).members.items).toEqual([]);
    expect(database.memberCalls).toHaveLength(0);
    expect(mocks.mfaEnrollment).not.toHaveBeenCalled();
  });

  it("gives a director with no authenticator set up no members and makes no member query", async () => {
    mocks.mfaEnrollment.mockResolvedValue(null);
    const result = await searchClubPortal(viewer, "ada", NOW);
    expect(result.members.items).toEqual([]);
    expect((await searchClubPortal(viewer, "alpha", NOW)).clubs.items).toHaveLength(1);
    expect(database.memberCalls).toHaveLength(0);
  });

  it("gives a director who has not unlocked this session no members and makes no member query", async () => {
    mocks.session.mockResolvedValue({ secondFactorVerifiedAt: null });
    expect((await searchClubPortal(viewer, "ada", NOW)).members.items).toEqual([]);
    expect(database.memberCalls).toHaveLength(0);
  });

  it("gives a director whose unlock is older than 12 hours no members", async () => {
    mocks.session.mockResolvedValue({ secondFactorVerifiedAt: new Date(NOW.getTime() - 13 * 3_600_000) });
    expect((await searchClubPortal(viewer, "ada", NOW)).members.items).toEqual([]);
    expect(database.memberCalls).toHaveLength(0);
  });

  it("gives nothing, and reads no members, while the sign-in second step is pending", async () => {
    mocks.accountNeedsSecondStep.mockResolvedValue("VERIFY");
    const result = await searchClubPortal(viewer, "a", NOW);
    expect(result.clubs.items).toEqual([]);
    expect(result.members.items).toEqual([]);
    expect(database.memberCalls).toHaveLength(0);
  });

  it("gives nothing for a session that is not the person's own", async () => {
    attendee("staff");
    const result = await searchClubPortal(viewer, "a", NOW);
    expect(result.clubs.items).toEqual([]);
    expect(result.members.items).toEqual([]);
    expect(database.memberCalls).toHaveLength(0);
  });

  it("gives nothing to a signed-in account with no club role", async () => {
    directed();
    const result = await searchClubPortal(viewer, "a", NOW);
    expect(result.clubs.items).toEqual([]);
    expect(result.members.items).toEqual([]);
    expect(database.memberCalls).toHaveLength(0);
  });
});

describe("searchClubPortal: staff acting as a club director", () => {
  const acting = { kind: "ACTING", actAsId: "act_1", organizationId: "org_alpha" } as const;
  beforeEach(() => {
    mocks.currentStaffActingContext.mockResolvedValue({ userId: "usr_1", staffSessionId: "ss_1", actAsId: "act_1", role: "CLUB_DIRECTOR", organizationId: "org_alpha", expiresAt: new Date(NOW.getTime() + 3_600_000) });
    mocks.organization.mockResolvedValue({ type: "CLUB", isActive: true, name: "Alpha Pathfinders", parentOrganization: { name: "Synthville Church" } });
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
  });

  it("searches only the act-as club, never another club the same browser's account directs", async () => {
    directed(ALPHA, BETA);
    const result = await searchClubPortal(acting, "ada", NOW);
    expect(result.members.items.map((m) => m.name)).toEqual(["Ada Lovelace", "Adam Smith"]);
    expect(database.memberCalls[0].where).toMatchObject({ organizationId: { in: ["org_alpha"] } });
    expect(mocks.listDirectedClubs).not.toHaveBeenCalled();
    expect((await searchClubPortal(acting, "beta", NOW)).clubs.items).toEqual([]);
  });

  it("is a viewer of its own, keyed by the act-as", async () => {
    expect(await getClubSearchViewer()).toEqual(acting);
    expect(clubSearchRateLimitKey(acting)).toBe("act-as:act_1");
  });
});

describe("getClubSearchViewer", () => {
  it("is the attendee account when there is no club act-as", async () => {
    expect(await getClubSearchViewer()).toEqual(viewer);
    expect(clubSearchRateLimitKey(viewer)).toBe("account:acct_synthetic");
  });

  it("is nothing when signed out", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await getClubSearchViewer()).toBeNull();
  });

  it("is nothing for an Area Coordinator act-as with no attendee account", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ userId: "usr_1", staffSessionId: "ss_1", actAsId: "act_2", role: "AREA_COORDINATOR", organizationId: null, expiresAt: NOW });
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await getClubSearchViewer()).toBeNull();
  });
});

describe("searchClubPortal: more access shapes", () => {
  it("gives an Area Coordinator act-as, with the person's own attendee session and no directed clubs, nothing", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ userId: "usr_1", staffSessionId: "ss_1", actAsId: "act_5", role: "AREA_COORDINATOR", organizationId: null, expiresAt: new Date(NOW.getTime() + 3_600_000) });
    directed();
    const asAttendee = await getClubSearchViewer();
    expect(asAttendee).toEqual(viewer);
    const result = await searchClubPortal(asAttendee!, "a", NOW);
    expect(result.clubs.items).toEqual([]);
    expect(result.members.items).toEqual([]);
    expect(database.memberCalls).toHaveLength(0);
  });

  it("shows two members with the same name in one club as one row", async () => {
    database.members = [member("d1", "org_alpha", "Sam", "Synth"), member("d2", "org_alpha", "Sam", "Synth"), member("d3", "org_alpha", "Sam", "Other")];
    const result = await searchClubPortal(viewer, "sam", NOW);
    expect(result.members.items.map((m) => m.name)).toEqual(["Sam Other", "Sam Synth"]);
    expect(new Set(result.members.items.map((m) => m.href)).size).toBe(result.members.items.length);
  });

  it("still fills five rows when same-name pairs are joined", async () => {
    database.members = [
      member("f1", "org_alpha", "Sam", "Aaberg"), member("f2", "org_alpha", "Sam", "Aaberg"),
      member("f3", "org_alpha", "Sam", "Abbot"), member("f4", "org_alpha", "Sam", "Abbot"),
      ...["Bravo", "Charlie", "Delta"].map((last, i) => member(`f${i + 5}`, "org_alpha", "Sam", last)),
    ];
    const result = await searchClubPortal(viewer, "sam", NOW);
    expect(result.members.items.map((m) => m.name)).toEqual(["Sam Aaberg", "Sam Abbot", "Sam Bravo", "Sam Charlie", "Sam Delta"]);
    expect(result.members.more).toBe(false);
  });

  it("keeps See all when joining same-name rows leaves five or fewer of the rows read", async () => {
    database.members = [
      member("e1", "org_alpha", "Sam", "Aaberg"), member("e2", "org_alpha", "Sam", "Aaberg"),
      ...["Bravo", "Charlie", "Delta", "Echo", "Foxtrot"].map((last, i) => member(`e${i + 3}`, "org_alpha", "Sam", last)),
    ];
    const result = await searchClubPortal(viewer, "sam", NOW);
    expect(result.members.items.length).toBeLessThanOrEqual(CLUB_SEARCH_GROUP_LIMIT);
    expect(new Set(result.members.items.map((m) => m.href)).size).toBe(result.members.items.length);
    expect(result.members.more).toBe(true);
    expect(result.members.seeAllHref).toBe(clubRosterSearchHref("org_alpha", "sam"));
  });

  it("gives a Clubs Administrator acting as director only the act-as club", async () => {
    const acting = { kind: "ACTING", actAsId: "act_9", organizationId: "org_alpha" } as const;
    mocks.currentStaffActingContext.mockResolvedValue({ userId: "usr_1", staffSessionId: "ss_1", actAsId: "act_9", role: "CLUB_DIRECTOR", organizationId: "org_alpha", viaClubsAdministrator: true, expiresAt: new Date(NOW.getTime() + 3_600_000) });
    mocks.organization.mockResolvedValue({ type: "CLUB", isActive: true, name: "Alpha Pathfinders", parentOrganization: { name: "Synthville Church" } });
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    directed(ALPHA, BETA);
    const result = await searchClubPortal(acting, "ada", NOW);
    expect(result.members.items.map((m) => m.name)).toEqual(["Ada Lovelace", "Adam Smith"]);
    expect(database.memberCalls[0].where).toMatchObject({ organizationId: { in: ["org_alpha"] } });
    expect((await searchClubPortal(acting, "beta", NOW)).clubs.items).toEqual([]);
  });

  it("gives an act-as on an inactive club nothing", async () => {
    const acting = { kind: "ACTING", actAsId: "act_9", organizationId: "org_alpha" } as const;
    mocks.currentStaffActingContext.mockResolvedValue({ userId: "usr_1", staffSessionId: "ss_1", actAsId: "act_9", role: "CLUB_DIRECTOR", organizationId: "org_alpha", expiresAt: new Date(NOW.getTime() + 3_600_000) });
    mocks.organization.mockResolvedValue({ type: "CLUB", isActive: false, name: "Alpha Pathfinders", parentOrganization: null });
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    const result = await searchClubPortal(acting, "a", NOW);
    expect(result.clubs.items).toEqual([]);
    expect(result.members.items).toEqual([]);
    expect(database.memberCalls).toHaveLength(0);
  });
});
