import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  grantFindUnique: vi.fn(),
  grantUpsert: vi.fn(),
  grantUpdateMany: vi.fn(),
  accountFindUnique: vi.fn(),
  writeAuditLog: vi.fn(),
  getCurrentAttendee: vi.fn(),
  findSwitchable: vi.fn(),
  orgFindUnique: vi.fn(),
  orgFindFirst: vi.fn(),
  orgFindMany: vi.fn(),
  grantUpdate: vi.fn(),
  grantFindFirst: vi.fn(),
  grantCreate: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  getCurrentSession: vi.fn(),
  userFindUnique: vi.fn(),
  clubsGrantFindFirst: vi.fn(),
}));

const client = {
  areaCoordinatorGrant: { findUnique: mocks.grantFindUnique, upsert: mocks.grantUpsert, updateMany: mocks.grantUpdateMany, update: mocks.grantUpdate },
  attendeeAccount: { findUnique: mocks.accountFindUnique },
  user: { findUnique: mocks.userFindUnique },
  clubsAdministratorGrant: { findFirst: mocks.clubsGrantFindFirst },
  organization: { findUnique: mocks.orgFindUnique, findFirst: mocks.orgFindFirst, findMany: mocks.orgFindMany },
  clubDirectorGrant: { findFirst: mocks.grantFindFirst, create: mocks.grantCreate },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee, findSwitchableAttendeeAccountForStaff: mocks.findSwitchable }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));

import { POST as ACCOUNT_ACTION } from "@/app/api/admin/accounts/[accountId]/route";
import {
  areaCoordinatorClubKinds,
  areaCoordinatorMaySeeClub,
  areaCoordinatorVisibleClubIds,
  coordinatorMinistriesForAccount,
  currentAreaCoordinator,
  listClubsForArea,
  setAreaCoordinator,
  setAreaCoordinatorMinistries,
} from "@/modules/organizations/area-coordinators";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountFindUnique.mockResolvedValue({ id: "account-1" });
  // The actor, read by id: "admin-1" is a system administrator (#1275 checks it inside setAreaCoordinator too).
  mocks.userFindUnique.mockResolvedValue({ globalRole: "SYSTEM_ADMIN" });
  mocks.clubsGrantFindFirst.mockResolvedValue(null);
  mocks.grantFindUnique.mockResolvedValue({ revokedAt: null });
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "account-1" }, via: "attendee", sessionId: "session-1" });
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.findSwitchable.mockResolvedValue({ id: "admin-account" });
  mocks.orgFindUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders" });
  mocks.grantFindFirst.mockResolvedValue(null);
  mocks.grantCreate.mockResolvedValue({ id: "grant-1" });
});

describe("Area Coordinators (#387)", () => {
  it("only counts a signed-in coordinator who has passed the second step", async () => {
    await expect(currentAreaCoordinator()).resolves.toEqual({ id: "account-1" });

    mocks.accountNeedsSecondStep.mockResolvedValueOnce("VERIFY");
    await expect(currentAreaCoordinator()).resolves.toBeNull();

    mocks.grantFindUnique.mockResolvedValueOnce({ revokedAt: new Date() });
    await expect(currentAreaCoordinator()).resolves.toBeNull();

    mocks.getCurrentAttendee.mockResolvedValueOnce({ account: { id: "account-1" }, via: "staff", sessionId: null });
    await expect(currentAreaCoordinator()).resolves.toBeNull();
  });

  it("grants and removes the role, audited without names", async () => {
    await setAreaCoordinator("account-1", true, "admin-1");
    expect(mocks.grantUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { attendeeAccountId: "account-1" },
      update: expect.objectContaining({ revokedAt: null, grantedByUserId: "admin-1" }),
    }));
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "AREA_COORDINATOR_GRANTED", actorUserId: "admin-1", entityId: "account-1" });

    await setAreaCoordinator("account-1", false, "admin-1");
    expect(mocks.grantUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { attendeeAccountId: "account-1", revokedAt: null },
      data: expect.objectContaining({ revokedByUserId: "admin-1" }),
    }));
    expect(mocks.writeAuditLog.mock.calls[1]![0]).toMatchObject({ action: "AREA_COORDINATOR_REVOKED" });
  });

  it("refuses an unknown account", async () => {
    mocks.accountFindUnique.mockResolvedValue(null);
    await expect(setAreaCoordinator("nobody", true, "admin-1")).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
  });

  it("answers 404, not 500, when the account to make an Area Coordinator doesn't exist", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" }, sessionId: "staff-session-1" });
    mocks.accountFindUnique.mockResolvedValue(null);
    const response = await ACCOUNT_ACTION(new Request("https://events.imsda.test/api/admin/accounts/nobody", {
      method: "POST",
      headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "area-coordinator", on: true }),
    }), { params: Promise.resolve({ accountId: "nobody" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "ACCOUNT_NOT_FOUND" });
  });

  it("stops counting a temporary role once it ends", async () => {
    mocks.grantFindUnique.mockResolvedValueOnce({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) });
    await expect(currentAreaCoordinator()).resolves.toBeNull();
  });

  it("keeps the ministries of an active grant when the role is granted again, and says so in the audit (#843)", async () => {
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null, ministries: ["ADVENTURER"] });
    await setAreaCoordinator("account-1", true, "admin-1");
    expect(mocks.grantUpsert.mock.calls[0]![0].update).not.toHaveProperty("ministries");
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "AREA_COORDINATOR_GRANTED", metadata: { ministries: ["ADVENTURER"] } });
  });

  it("resets a revoked or expired grant to Pathfinder when it is granted again (#843)", async () => {
    for (const existing of [{ revokedAt: new Date("2026-01-01"), expiresAt: null }, { revokedAt: null, expiresAt: new Date("2026-01-01") }, null]) {
      mocks.grantUpsert.mockClear();
      mocks.grantFindUnique.mockResolvedValue(existing && { ...existing, ministries: ["ADVENTURER"] });
      await setAreaCoordinator("account-1", true, "admin-1");
      expect(mocks.grantUpsert.mock.calls[0]![0].update).toMatchObject({ ministries: ["PATHFINDER"] });
    }
  });

  it("starts a fresh grant as a Pathfinder coordinator (#843)", async () => {
    mocks.grantFindUnique.mockResolvedValue(null);
    await setAreaCoordinator("account-1", true, "admin-1");
    expect(mocks.grantUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.not.objectContaining({ ministries: expect.anything() }),
      update: expect.objectContaining({ ministries: ["PATHFINDER"] }),
    }));
  });
});

describe("Area Coordinator ministry scope (#843)", () => {
  const attendee = { kind: "ATTENDEE", accountId: "account-1" } as const;
  const acting = { kind: "ACTING", actAsId: "act-1" } as const;

  it("gives a coordinator the ministries on their active grant, read fresh", async () => {
    mocks.grantFindUnique.mockResolvedValueOnce({ revokedAt: null, expiresAt: null, ministries: ["ADVENTURER"] });
    await expect(areaCoordinatorClubKinds(attendee)).resolves.toEqual(["ADVENTURER"]);
    mocks.grantFindUnique.mockResolvedValueOnce({ revokedAt: null, expiresAt: null, ministries: ["ADVENTURER", "PATHFINDER"] });
    await expect(areaCoordinatorClubKinds(attendee)).resolves.toEqual(["PATHFINDER", "ADVENTURER"]);
  });

  it("gives no ministry to a removed, expired or missing grant", async () => {
    mocks.grantFindUnique.mockResolvedValueOnce({ revokedAt: new Date(), expiresAt: null, ministries: ["PATHFINDER"] });
    await expect(coordinatorMinistriesForAccount("account-1")).resolves.toEqual([]);
    mocks.grantFindUnique.mockResolvedValueOnce({ revokedAt: null, expiresAt: new Date(Date.now() - 1000), ministries: ["PATHFINDER"] });
    await expect(coordinatorMinistriesForAccount("account-1")).resolves.toEqual([]);
    mocks.grantFindUnique.mockResolvedValueOnce(null);
    await expect(coordinatorMinistriesForAccount("account-1")).resolves.toEqual([]);
  });

  it("lets staff acting as a coordinator see every ministry", async () => {
    await expect(areaCoordinatorClubKinds(acting)).resolves.toEqual(["PATHFINDER", "ADVENTURER"]);
    expect(mocks.grantFindUnique).not.toHaveBeenCalled();
  });

  it("finds a club only inside the coordinator's ministries", async () => {
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null, ministries: ["PATHFINDER"] });
    mocks.orgFindFirst.mockResolvedValueOnce({ id: "club-1" });
    await expect(areaCoordinatorMaySeeClub(attendee, "club-1")).resolves.toBe(true);
    expect(mocks.orgFindFirst).toHaveBeenCalledWith({
      where: { id: "club-1", type: "CLUB", isActive: true, guestEventId: null, clubKind: { in: ["PATHFINDER"] } },
      select: { id: true },
    });
    // An Adventurer club does not match the Pathfinder filter, so the same query finds nothing.
    mocks.orgFindFirst.mockResolvedValueOnce(null);
    await expect(areaCoordinatorMaySeeClub(attendee, "club-adventurer")).resolves.toBe(false);
  });

  it("asks nothing and sees nothing without an active grant", async () => {
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: new Date(), expiresAt: null, ministries: ["PATHFINDER"] });
    await expect(areaCoordinatorMaySeeClub(attendee, "club-1")).resolves.toBe(false);
    await expect(areaCoordinatorVisibleClubIds(attendee, ["club-1"])).resolves.toEqual([]);
    expect(mocks.orgFindFirst).not.toHaveBeenCalled();
    expect(mocks.orgFindMany).not.toHaveBeenCalled();
  });

  it("keeps only the requested club ids that are in scope", async () => {
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null, ministries: ["ADVENTURER"] });
    mocks.orgFindMany.mockResolvedValueOnce([{ id: "club-a" }]);
    await expect(areaCoordinatorVisibleClubIds(attendee, ["club-a", "club-p"])).resolves.toEqual(["club-a"]);
    expect(mocks.orgFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["club-a", "club-p"] }, clubKind: { in: ["ADVENTURER"] } }),
    }));
  });

  it("lists the clubs of the given ministries, and none for an empty scope", async () => {
    mocks.orgFindMany.mockResolvedValueOnce([{ id: "club-1", name: "Alpha", city: null, parentOrganization: { name: "Church", city: "Ames" } }]);
    await expect(listClubsForArea(["PATHFINDER"])).resolves.toEqual([{ organizationId: "club-1", name: "Alpha", sponsoringChurch: "Church", city: "Ames" }]);
    expect(mocks.orgFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clubKind: { in: ["PATHFINDER"] } }) }));
    mocks.orgFindMany.mockClear();
    await expect(listClubsForArea([])).resolves.toEqual([]);
    expect(mocks.orgFindMany).not.toHaveBeenCalled();
  });
});

describe("Changing an Area Coordinator's ministries (#843)", () => {
  const url = "https://events.imsda.test/api/admin/accounts/account-1";
  function post(body: unknown) {
    return ACCOUNT_ACTION(new Request(url, {
      method: "POST",
      headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ accountId: "account-1" }) });
  }

  beforeEach(() => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", email: "admin@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" }, sessionId: "staff-session-1" });
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null, ministries: ["PATHFINDER"] });
  });

  it("saves the list on an active grant and audits from and to", async () => {
    const saved = await setAreaCoordinatorMinistries("account-1", ["ADVENTURER", "PATHFINDER"], "admin-1");
    expect(saved).toEqual(["PATHFINDER", "ADVENTURER"]);
    expect(mocks.grantUpdate).toHaveBeenCalledWith({ where: { attendeeAccountId: "account-1" }, data: { ministries: ["PATHFINDER", "ADVENTURER"] } });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({
      action: "AREA_COORDINATOR_MINISTRIES_CHANGED",
      actorUserId: "admin-1",
      entityId: "account-1",
      metadata: { from: ["PATHFINDER"], to: ["PATHFINDER", "ADVENTURER"] },
    });
  });

  it("refuses an empty or unknown list and writes nothing", async () => {
    await expect(setAreaCoordinatorMinistries("account-1", [], "admin-1")).rejects.toMatchObject({ code: "INVALID_MINISTRIES" });
    await expect(setAreaCoordinatorMinistries("account-1", ["DISTRICT"], "admin-1")).rejects.toMatchObject({ code: "INVALID_MINISTRIES" });
    expect(mocks.grantUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("needs an active grant", async () => {
    mocks.grantFindUnique.mockResolvedValue({ revokedAt: new Date(), expiresAt: null, ministries: ["PATHFINDER"] });
    await expect(setAreaCoordinatorMinistries("account-1", ["ADVENTURER"], "admin-1")).rejects.toMatchObject({ code: "NOT_COORDINATOR" });
    mocks.grantFindUnique.mockResolvedValue(null);
    await expect(setAreaCoordinatorMinistries("account-1", ["ADVENTURER"], "admin-1")).rejects.toMatchObject({ code: "NOT_COORDINATOR" });
    expect(mocks.grantUpdate).not.toHaveBeenCalled();
  });

  it("is for a system administrator or an active Clubs Administrator, read from the database", async () => {
    mocks.userFindUnique.mockResolvedValue({ globalRole: null });
    mocks.clubsGrantFindFirst.mockResolvedValue(null);
    await expect(setAreaCoordinatorMinistries("account-1", ["ADVENTURER"], "plain-staff")).rejects.toMatchObject({ status: 403 });
    expect(mocks.grantUpdate).not.toHaveBeenCalled();

    mocks.clubsGrantFindFirst.mockResolvedValue({ id: "grant" });
    await setAreaCoordinatorMinistries("account-1", ["ADVENTURER"], "clubs-admin");
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ metadata: expect.objectContaining({ viaClubsAdministrator: true }) });
  });

  it("answers the route's action for a system administrator, and 400 for an empty or repeated list", async () => {
    const ok = await post({ action: "area-coordinator-ministries", ministries: ["PATHFINDER", "ADVENTURER"] });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ministries: ["PATHFINDER", "ADVENTURER"] });

    expect((await post({ action: "area-coordinator-ministries", ministries: [] })).status).toBe(400);
    expect((await post({ action: "area-coordinator-ministries", ministries: ["PATHFINDER", "PATHFINDER"] })).status).toBe(400);
    expect((await post({ action: "area-coordinator-ministries", ministries: ["DISTRICT"] })).status).toBe(400);
    expect((await post({ action: "area-coordinator-ministries" })).status).toBe(400);
  });

  it("answers 409 when the account is not an Area Coordinator", async () => {
    mocks.grantFindUnique.mockResolvedValue(null);
    const response = await post({ action: "area-coordinator-ministries", ministries: ["ADVENTURER"] });
    expect(response.status).toBe(409);
  });
});
