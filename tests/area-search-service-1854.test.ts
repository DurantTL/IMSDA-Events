import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Area Coordinator search (#1854): who `getAreaSearchViewer` lets in (the area-clubs layout's own gate, run over mocked
 * sessions and a fake grant table) and what `searchAreaClubs` returns. Synthetic names only.
 */

type Row = Record<string, unknown>;
const NOW = new Date("2027-02-01T12:00:00.000Z");

const database = vi.hoisted(() => ({
  clubs: [] as { id: string; name: string; city: string | null; parentOrganization: { name: string; city: string | null } | null }[],
  grants: [] as { organizationId: string; effectiveFrom: Date; effectiveTo: Date | null; revokedAt: Date | null; attendeeAccount: { displayName: string } }[],
  coordinatorGrant: null as { revokedAt: Date | null; expiresAt: Date | null; ministries?: string[] } | null,
  reads: [] as string[],
  clubWhere: null as Row | null,
}));

const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  currentStaffActingContext: vi.fn(),
  listDirectedClubs: vi.fn(),
  secondStepPending: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ requireAttendeeSecondStep: vi.fn(), attendeeSecondStepPending: mocks.secondStepPending }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/access/admin-roles", () => ({ resolveClubsActor: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    areaCoordinatorGrant: {
      findUnique: vi.fn(async () => {
        database.reads.push("areaCoordinatorGrant");
        return database.coordinatorGrant;
      }),
    },
    organization: {
      findMany: vi.fn(async (args: { select: Row; where: Row }) => {
        database.reads.push("organization");
        database.clubWhere = args.where;
        expect(args.select).not.toHaveProperty("contactEmail");
        return database.clubs;
      }),
    },
    clubDirectorGrant: {
      findMany: vi.fn(async () => {
        database.reads.push("clubDirectorGrant");
        return database.grants;
      }),
    },
  }),
}));

import { AREA_SEARCH_GROUP_LIMIT } from "@/modules/area-search/domain";
import { areaSearchRateLimitKey, getAreaSearchViewer, searchAreaClubs } from "@/modules/area-search/service";

const club = (id: string, name: string, church: string | null = "Synthville Church", city: string | null = "Synthtown") => ({
  id, name, city, parentOrganization: church ? { name: church, city: "Churchtown" } : null,
});
const director = (organizationId: string, displayName: string, extra: Row = {}) => ({
  organizationId, effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveTo: null, revokedAt: null, attendeeAccount: { displayName }, ...extra,
});
const account = { id: "acct_coord", verifiedEmail: "coord@example.test", displayName: "Synthetic Coordinator" };
const signedIn = (via: "attendee" | "staff" = "attendee") => mocks.getCurrentAttendee.mockResolvedValue({ account, via, sessionId: "sess_1" });
const coordinator = { kind: "ATTENDEE", accountId: account.id } as const;

beforeEach(() => {
  vi.resetAllMocks();
  database.reads.length = 0;
  database.coordinatorGrant = { revokedAt: null, expiresAt: null };
  database.clubs = [
    club("org_alpha", "Alpha Pathfinders", "Alpha Church", "Alphaville"),
    club("org_beta", "Beta Adventurers", "Beta Church", "Betaburg"),
    club("org_gamma", "Gamma Pathfinders", null, null),
  ];
  database.grants = [director("org_alpha", "Dana Directorson"), director("org_beta", "Revoked Person", { revokedAt: new Date("2026-10-01T00:00:00Z") })];
  signedIn();
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.listDirectedClubs.mockResolvedValue([]);
  mocks.secondStepPending.mockResolvedValue(false);
});

describe("getAreaSearchViewer: the area-clubs gate", () => {
  it("lets an active Area Coordinator in", async () => {
    expect(await getAreaSearchViewer()).toEqual(coordinator);
    expect(areaSearchRateLimitKey(coordinator)).toBe("account:acct_coord");
  });

  it("lets a staff user acting as an Area Coordinator in, keyed by the act-as", async () => {
    database.coordinatorGrant = null;
    mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", actAsId: "act_1", organizationId: null });
    const viewer = await getAreaSearchViewer();
    expect(viewer).toEqual({ kind: "ACTING", actAsId: "act_1" });
    expect(areaSearchRateLimitKey(viewer!)).toBe("act-as:act_1");
  });

  it("refuses staff acting as a club director", async () => {
    database.coordinatorGrant = null;
    mocks.currentStaffActingContext.mockResolvedValue({ role: "CLUB_DIRECTOR", actAsId: "act_2", organizationId: "org_alpha" });
    expect(await getAreaSearchViewer()).toBeNull();
  });

  it("refuses an expired grant and a removed grant", async () => {
    database.coordinatorGrant = { revokedAt: null, expiresAt: new Date(Date.now() - 60_000) };
    expect(await getAreaSearchViewer()).toBeNull();
    database.coordinatorGrant = { revokedAt: new Date(Date.now() - 60_000), expiresAt: null };
    expect(await getAreaSearchViewer()).toBeNull();
    expect(database.reads).not.toContain("organization");
  });

  it("refuses a club director with no coordinator grant, and an account with no role", async () => {
    database.coordinatorGrant = null;
    mocks.listDirectedClubs.mockResolvedValue([{ organizationId: "org_alpha", name: "Alpha Pathfinders", role: "DIRECTOR", sponsoringChurch: null }]);
    expect(await getAreaSearchViewer()).toBeNull();
    mocks.listDirectedClubs.mockResolvedValue([]);
    expect(await getAreaSearchViewer()).toBeNull();
  });

  it("refuses when signed out", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    expect(await getAreaSearchViewer()).toBeNull();
    expect(database.reads).toEqual([]);
  });

  it("refuses a coordinator whose second step is pending, as the layout does", async () => {
    mocks.accountNeedsSecondStep.mockResolvedValue("SETUP");
    expect(await getAreaSearchViewer()).toBeNull();
  });

  it("refuses a staff sign-in that is not the attendee's own account", async () => {
    signedIn("staff");
    expect(await getAreaSearchViewer()).toBeNull();
  });
});

describe("searchAreaClubs ministry scope (#843)", () => {
  it("reads only the clubs of the coordinator's ministries", async () => {
    database.coordinatorGrant = { revokedAt: null, expiresAt: null, ministries: ["ADVENTURER"] };
    await searchAreaClubs(coordinator, "alpha", NOW);
    expect(database.clubWhere).toEqual({ type: "CLUB", isActive: true, guestEventId: null, clubKind: { in: ["ADVENTURER"] } });
    database.coordinatorGrant = { revokedAt: null, expiresAt: null, ministries: ["PATHFINDER", "ADVENTURER"] };
    await searchAreaClubs(coordinator, "alpha", NOW);
    expect(database.clubWhere).toEqual({ type: "CLUB", isActive: true, guestEventId: null, clubKind: { in: ["PATHFINDER", "ADVENTURER"] } });
  });

  it("reads every ministry for staff acting as a coordinator", async () => {
    await searchAreaClubs({ kind: "ACTING", actAsId: "act_1" }, "alpha", NOW);
    expect(database.clubWhere).toEqual({ type: "CLUB", isActive: true, guestEventId: null, clubKind: { in: ["PATHFINDER", "ADVENTURER"] } });
  });
});

describe("searchAreaClubs", () => {
  it("reads nothing for an empty or symbol-only query", async () => {
    expect(await searchAreaClubs(coordinator, "  ", NOW)).toMatchObject({ clubs: { items: [] } });
    expect(await searchAreaClubs(coordinator, "!!", NOW)).toMatchObject({ clubs: { items: [] } });
    expect(database.reads).toEqual([]);
  });

  it("finds clubs by name, church or city and links them view only", async () => {
    const byName = await searchAreaClubs(coordinator, "path", NOW);
    expect(byName.clubs.items.map((c) => c.name)).toEqual(["Alpha Pathfinders", "Gamma Pathfinders"]);
    expect(byName.clubs.items[0]).toEqual({ id: "org_alpha", name: "Alpha Pathfinders", sponsoringChurch: "Alpha Church", href: "/account/area/org_alpha" });
    expect((await searchAreaClubs(coordinator, "beta church", NOW)).clubs.items.map((c) => c.id)).toEqual(["org_beta"]);
    expect((await searchAreaClubs(coordinator, "betaburg", NOW)).clubs.items.map((c) => c.id)).toEqual(["org_beta"]);
  });

  it("matches a director's name but never returns it", async () => {
    const result = await searchAreaClubs(coordinator, "dana", NOW);
    expect(result.clubs.items.map((c) => c.id)).toEqual(["org_alpha"]);
    expect(JSON.stringify(result)).not.toMatch(/Dana|Directorson/);
    expect(Object.keys(result.clubs.items[0]!).sort()).toEqual(["href", "id", "name", "sponsoringChurch"]);
  });

  it("does not match a revoked director", async () => {
    expect((await searchAreaClubs(coordinator, "revoked", NOW)).clubs.items).toEqual([]);
  });

  it("opens the coordinator's own club with the normal link", async () => {
    mocks.listDirectedClubs.mockResolvedValue([{ organizationId: "org_beta", name: "Beta Adventurers", role: "DIRECTOR", sponsoringChurch: null }]);
    const items = (await searchAreaClubs(coordinator, "a", NOW)).clubs.items;
    expect(items.find((c) => c.id === "org_beta")!.href).toBe("/account/clubs/org_beta");
    expect(items.find((c) => c.id === "org_alpha")!.href).toBe("/account/area/org_alpha");
  });

  it("gives staff acting as a coordinator the view-only links", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ role: "AREA_COORDINATOR", actAsId: "act_1", organizationId: null });
    const items = (await searchAreaClubs({ kind: "ACTING", actAsId: "act_1" }, "alpha", NOW)).clubs.items;
    expect(items.map((c) => c.href)).toEqual(["/account/area/org_alpha"]);
  });

  it("limits the group and offers See all on the Clubs page with the words typed", async () => {
    database.clubs = Array.from({ length: AREA_SEARCH_GROUP_LIMIT + 2 }, (_, index) => club(`org_${index}`, `Synthetic Club ${String(index).padStart(2, "0")}`));
    const result = await searchAreaClubs(coordinator, "synthetic club", NOW);
    expect(result.clubs.items).toHaveLength(AREA_SEARCH_GROUP_LIMIT);
    expect(result.clubs.more).toBe(true);
    expect(result.clubs.seeAllHref).toBe("/account/area-clubs/clubs?q=synthetic+club");
    const few = await searchAreaClubs(coordinator, "club 00", NOW);
    expect(few.clubs.more).toBe(false);
    expect(few.clubs.seeAllHref).toBeNull();
  });
});
