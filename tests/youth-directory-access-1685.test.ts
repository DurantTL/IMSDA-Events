import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1685: who may open the Youth directory (the page's access helper) and download its CSV, through the real access
 * check and the real export route; only the staff session, the database and the audit writer are stubbed. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  writeAuditLog: vi.fn(),
  youthGrantFindFirst: vi.fn(),
  memberFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    youthAdministratorGrant: { findFirst: mocks.youthGrantFindFirst },
    clubRosterMember: { findMany: mocks.memberFindMany },
  }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
// The birth date is sealed in storage; the test stores a plain date and the fake "opens" it as it is.
vi.mock("@/modules/club-rosters/birth-dates", () => ({ openBirthDate: (value: string) => value }));

import { GET } from "@/app/api/admin/youth-directory/export/route";
import { requireYouthDirectoryAccess, youthDirectoryViewerFor } from "@/modules/youth-directory/access";

const NOW = new Date("2026-11-12T15:00:00Z");

type Who = { id: string; globalRole: "SYSTEM_ADMIN" | null; youthGrant: boolean };
const people: Record<string, Who> = {
  systemAdmin: { id: "admin-1", globalRole: "SYSTEM_ADMIN", youthGrant: false },
  youthAdmin: { id: "youth-1", globalRole: null, youthGrant: true },
  // An Area Coordinator signs in with an attendee account, so there is no staff user at all.
  // A Clubs Administrator without the grant, and a staff member acting as an Area Coordinator, are staff users with no Youth Admin grant.
  clubsAdminNoGrant: { id: "clubs-1", globalRole: null, youthGrant: false },
  actingAsAreaCoordinator: { id: "acting-1", globalRole: null, youthGrant: false },
  staffNoRole: { id: "staff-1", globalRole: null, youthGrant: false },
};

const userOf = (who: Who) => ({ id: who.id, email: `${who.id}@example.test`, displayName: "Synthetic", globalRole: who.globalRole });
const as = (who: Who | null) => mocks.getCurrentSession.mockResolvedValue(who ? { user: userOf(who), sessionId: "s-1" } : { user: null });
const get = (query = "") => GET(new Request(`https://events.imsda.test/api/admin/youth-directory/export${query}`));

const member = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  attendeeType: "YOUTH",
  classLevel: "EXPLORER",
  isTlt: false,
  schoolGrade: "GRADE_7",
  schoolType: "PUBLIC_SCHOOL",
  churchMember: "YES",
  reportedAge: null,
  sealedBirthDate: "2014-03-01",
  organization: { id: "club-a", name: "Alpha Pathfinders" },
  person: { firstName: "Avery", lastName: `Synthetic${id}` },
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.youthGrantFindFirst.mockImplementation(async ({ where }: { where: { userId: string } }) => (
    Object.values(people).some((who) => who.id === where.userId && who.youthGrant) ? { id: "grant" } : null
  ));
  mocks.memberFindMany.mockResolvedValue([
    member("1"),
    member("2", { schoolGrade: "GRADE_8", sealedBirthDate: null, reportedAge: 13, organization: { id: "club-b", name: "Beta Pathfinders" }, person: { firstName: "Blake", lastName: "Synthetic2" } }),
  ]);
});

describe("the page's access helper", () => {
  it.each([
    ["a system administrator", "systemAdmin", "SYSTEM_ADMIN"],
    ["an active Youth Admin", "youthAdmin", "YOUTH_ADMINISTRATOR"],
    ["a Clubs Administrator without the grant", "clubsAdminNoGrant", null],
    ["a staff member acting as an Area Coordinator", "actingAsAreaCoordinator", null],
    ["a staff member with no role", "staffNoRole", null],
  ] as const)("%s: %s", async (_label, key, expected) => {
    await expect(youthDirectoryViewerFor(userOf(people[key]!))).resolves.toBe(expected);
  });

  it("reads the grant from the database on every call, so a removal applies at once", async () => {
    const who = { ...people.youthAdmin! };
    await expect(youthDirectoryViewerFor(userOf(who))).resolves.toBe("YOUTH_ADMINISTRATOR");
    people.youthAdmin!.youthGrant = false;
    try {
      await expect(youthDirectoryViewerFor(userOf(who))).resolves.toBeNull();
    } finally {
      people.youthAdmin!.youthGrant = true;
    }
    expect(mocks.youthGrantFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "youth-1", revokedAt: null } }));
  });

  it("is 401 signed out and 403 for anyone without the role", async () => {
    as(null);
    await expect(requireYouthDirectoryAccess()).rejects.toMatchObject({ status: 401 });
    as(people.clubsAdminNoGrant!);
    await expect(requireYouthDirectoryAccess()).rejects.toMatchObject({ status: 403 });
  });
});

describe("the CSV export route", () => {
  it.each(["clubsAdminNoGrant", "actingAsAreaCoordinator", "staffNoRole"] as const)("refuses %s with 403, reads no rows and writes no audit entry", async (key) => {
    as(people[key]!);
    expect((await get()).status).toBe(403);
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a signed-out request (an Area Coordinator's own attendee account has no staff session) with 401", async () => {
    as(null);
    expect((await get()).status).toBe(401);
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });

  it.each(["systemAdmin", "youthAdmin"] as const)("sends the file to %s, not cached, with the directory's columns and an audit entry that holds no row", async (key) => {
    as(people[key]!);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="2026-27-youth-directory-2026-11-12.csv"');
    const text = (await response.text()).replace(/^﻿/, "");
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toBe('"Name","Club","Age","Age source","Grade","School type","Church member","Class level"');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('"Synthetic1, Avery","Alpha Pathfinders","12","Birth date","7th grade","Public school","Yes","Explorer"');
    expect(lines[2]).toContain('"13","Reported"');
    // No birth date and nothing beyond the directory's columns.
    expect(text).not.toContain("2014-03-01");

    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const audit = mocks.writeAuditLog.mock.calls[0]![0];
    expect(audit).toMatchObject({
      actorUserId: people[key]!.id,
      action: "YOUTH_DIRECTORY_EXPORTED",
      entityType: "YouthDirectory",
      metadata: { rowCount: 2, clubYear: "2026-27", filtered: false, filters: {} },
    });
    expect(audit.metadata.actorRole).toBe(key === "systemAdmin" ? "SYSTEM_ADMIN" : "YOUTH_ADMINISTRATOR");
    expect(JSON.stringify(audit)).not.toMatch(/Synthetic|Avery|Blake|Alpha|Beta/);
  });

  it("applies the same filters as the page and audits them, with the filtered row count", async () => {
    as(people.youthAdmin!);
    const response = await get("?grade=GRADE_8&club=club-b&sort=age&dir=desc&evil=1");
    const lines = (await response.text()).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Synthetic2, Blake");
    expect(mocks.writeAuditLog.mock.calls[0]![0].metadata).toMatchObject({
      rowCount: 1,
      filtered: true,
      filters: { grade: "GRADE_8", club: "club-b" },
      sort: "age",
      direction: "desc",
    });
  });

  it("reads only active youth on active clubs for this club year, and selects only the directory's columns", async () => {
    as(people.systemAdmin!);
    await get();
    const args = mocks.memberFindMany.mock.calls[0]![0];
    expect(args.where).toEqual({ clubYear: "2026-27", status: "ACTIVE", attendeeType: "YOUTH", organization: { type: "CLUB", isActive: true, guestEventId: null } });
    const selected = JSON.stringify(args.select);
    expect(selected).not.toMatch(/gender|guardian|health|createdBy|sourceRegistration/i);
    expect(Object.keys(args.select).sort()).toEqual(["attendeeType", "churchMember", "classLevel", "id", "isTlt", "organization", "person", "reportedAge", "schoolGrade", "schoolType", "sealedBirthDate"]);
  });
});
