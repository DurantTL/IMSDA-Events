import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1788 (Caleb, 2026-11-09): a Clubs Administrator's People & access list holds club people only, with or without a
 * search. A system administrator's list is unchanged: everyone. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ userFindMany: vi.fn(), accountFindMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ user: { findMany: mocks.userFindMany }, attendeeAccount: { findMany: mocks.accountFindMany } }),
}));

import { findPeople, searchPeople } from "@/modules/system-admin/people-directory";
import { clubPeopleWhere, NO_PEOPLE_FILTERS } from "@/modules/system-admin/people-directory-model";

const now = new Date("2026-11-09T18:00:00.000Z");
const text = { OR: [{ email: { contains: "sam", mode: "insensitive" } }, { displayName: { contains: "sam", mode: "insensitive" } }] };
const userWhere = () => mocks.userFindMany.mock.calls[0][0].where;
const accountWhere = () => mocks.accountFindMany.mock.calls[0][0].where;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.userFindMany.mockResolvedValue([]);
  mocks.accountFindMany.mockResolvedValue([]);
});

describe("clubPeopleWhere", () => {
  it("is a current Area Coordinator or a club role, current or scheduled, in a CLUB-type organization", () => {
    expect(clubPeopleWhere(now).account).toEqual({
      OR: [
        { areaCoordinatorGrant: { is: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } },
        { clubDirectorGrants: { some: { revokedAt: null, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }], organization: { type: "CLUB" } } } },
      ],
    });
  });

  it("is, for a staff login, a current Clubs Administrator or a login linked to a club person's account", () => {
    const where = clubPeopleWhere(now);
    expect(where.staff).toEqual({ OR: [{ clubsAdministratorGrant: { is: { revokedAt: null } } }, { attendeeAccount: { is: where.account } }] });
  });

  it("names no event role, system administrator or sign-in field", () => {
    const flat = JSON.stringify(clubPeopleWhere(now));
    for (const absent of ["memberships", "globalRole", "SYSTEM_ADMIN", "credential", "accountStatus"]) expect(flat).not.toContain(absent);
  });
});

describe("findPeople by viewer scope", () => {
  it("lists only club people for a Clubs Administrator with no search", async () => {
    await findPeople("", "clubs", now);
    expect(userWhere()).toEqual(clubPeopleWhere(now).staff);
    expect(accountWhere()).toEqual(clubPeopleWhere(now).account);
  });

  it("keeps a Clubs Administrator's search inside club people", async () => {
    await findPeople("  sam ", "clubs", now);
    expect(userWhere()).toEqual({ AND: [clubPeopleWhere(now).staff, text] });
    expect(accountWhere()).toEqual({ AND: [clubPeopleWhere(now).account, text] });
  });

  it("lists everyone for a system administrator, as before", async () => {
    await findPeople("", "full", now);
    expect(userWhere()).toBeUndefined();
    expect(accountWhere()).toBeUndefined();
    vi.clearAllMocks();
    await findPeople("sam", "full", now);
    expect(userWhere()).toEqual(text);
    expect(accountWhere()).toEqual(text);
  });

  it("loads names and emails only", async () => {
    await findPeople("", "clubs", now);
    expect(mocks.userFindMany.mock.calls[0][0].select).toEqual({ id: true, email: true, displayName: true, attendeeAccountId: true });
    expect(mocks.accountFindMany.mock.calls[0][0].select).toEqual({ id: true, email: true, displayName: true, linkedUser: { select: { id: true } } });
  });
});

describe("searchPeople", () => {
  it("passes the Clubs Administrator scope to the unfiltered list", async () => {
    await searchPeople("", 1, "clubs", NO_PEOPLE_FILTERS);
    expect(userWhere()).toEqual(clubPeopleWhere(now).staff);
    expect(accountWhere()).toEqual(clubPeopleWhere(now).account);
  });

  it("leaves the system administrator's unfiltered list unlimited", async () => {
    await searchPeople("", 1, "full", NO_PEOPLE_FILTERS);
    expect(userWhere()).toBeUndefined();
    expect(accountWhere()).toBeUndefined();
  });
});
