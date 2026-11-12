import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1685: an active Youth Admin may act as an Area Coordinator (and only that), for the same two hours and with the same
 * view-only pages as a Clubs Administrator. The grant is read again on every request, so a removal ends the act-as on the
 * next one. The audit rows name a Youth Admin and never use the Clubs Administrator marker. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getServerEnv: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  writeAuditLog: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  orgFindUnique: vi.fn(),
  sessionFindUnique: vi.fn(),
  clubsGrantFindFirst: vi.fn(),
  youthGrantFindFirst: vi.fn(),
}));

const client = {
  staffActAs: { findFirst: mocks.findFirst, updateMany: mocks.updateMany, create: mocks.create },
  organization: { findUnique: mocks.orgFindUnique },
  userSession: { findUnique: mocks.sessionFindUnique },
  clubsAdministratorGrant: { findFirst: mocks.clubsGrantFindFirst },
  youthAdministratorGrant: { findFirst: mocks.youthGrantFindFirst },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: mocks.cookieGet, set: mocks.cookieSet })) }));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv, isServerEnvironmentError: () => false }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));

import { POST as startAreaCoordinator } from "@/app/api/admin/act-as/area-coordinator/route";
import { POST as stopActing } from "@/app/api/admin/act-as/stop/route";
import { POST as startDirector } from "@/app/api/admin/organizations/[organizationId]/act-as-director/route";
import { actAsAreaCoordinator, currentStaffActingContext, resolveActiveActAs } from "@/modules/organizations/staff-act-as";

const origin = "https://events.imsda.test";
const NOW = new Date("2026-11-12T12:00:00Z");
const youthAdmin = { user: { id: "youth-1", email: "youth@example.test", displayName: "Youth Director", globalRole: null }, sessionId: "staff-session-y" };
const post = (path: string) => new Request(`${origin}${path}`, { method: "POST", headers: { origin } });
const directorContext = { params: Promise.resolve({ organizationId: "club-1" }) };

const liveSession = (globalRole: "SYSTEM_ADMIN" | null = null) => ({
  expiresAt: new Date("2026-11-12T18:00:00Z"),
  revokedAt: null,
  lastSeenAt: new Date("2026-11-12T11:59:00Z"),
  user: { id: "youth-1", globalRole, accountStatus: "ACTIVE", credential: { disabledAt: null } },
});
const actAsRow = (role: "AREA_COORDINATOR" | "CLUB_DIRECTOR") => ({
  id: "act-1", userId: "youth-1", staffSessionId: "staff-session-y", role,
  organizationId: role === "CLUB_DIRECTOR" ? "club-1" : null, expiresAt: new Date("2026-11-12T14:00:00Z"),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.getServerEnv.mockReturnValue({ APP_BASE_URL: origin });
  mocks.getCurrentSession.mockResolvedValue(youthAdmin);
  mocks.findFirst.mockResolvedValue(null);
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.create.mockResolvedValue({ id: "act-1" });
  mocks.orgFindUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Test Pathfinders" });
  mocks.sessionFindUnique.mockResolvedValue(liveSession());
  mocks.cookieGet.mockReturnValue({ value: "staff-token" });
  mocks.clubsGrantFindFirst.mockResolvedValue(null);
  mocks.youthGrantFindFirst.mockImplementation(async ({ where }: { where: { userId: string } }) => (where.userId === "youth-1" ? { id: "grant-y" } : null));
});

describe("a Youth Admin starting and stopping an act-as (#1685)", () => {
  it("may act as an Area Coordinator, recorded as a Youth Admin and never as a Clubs Administrator", async () => {
    const response = await startAreaCoordinator(post("/api/admin/act-as/area-coordinator"));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "youth-1", staffSessionId: "staff-session-y", role: "AREA_COORDINATOR", organizationId: null }),
    }));
    const audit = mocks.writeAuditLog.mock.calls[0]![0];
    expect(audit).toMatchObject({ action: "ACT_AS_AREA_COORDINATOR", actorUserId: "youth-1", summary: "A Youth Admin is acting as an Area Coordinator for a limited time.", metadata: { actorRole: "YOUTH_ADMINISTRATOR" } });
    expect(JSON.stringify(audit)).not.toContain("CLUBS_ADMINISTRATOR");
  });

  it("may NOT act as a club director (403), and nothing is started", async () => {
    const response = await startDirector(post("/api/admin/organizations/club-1/act-as-director"), directorContext);
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("stops acting and lands on the Youth directory, with the audit marker", async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: "act-1", role: "AREA_COORDINATOR", organizationId: null });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    const response = await stopActing(post("/api/admin/act-as/stop"));
    expect(await response.json()).toEqual({ ok: true, stopped: true, href: "/admin/youth" });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "ACT_AS_STOPPED", summary: "A Youth Admin stopped acting as a club role.", metadata: { actorRole: "YOUTH_ADMINISTRATOR" } });
  });

  it("refuses a staff member with no grant, a removed grant and a signed-out visitor", async () => {
    mocks.youthGrantFindFirst.mockResolvedValue(null);
    expect((await startAreaCoordinator(post("/api/admin/act-as/area-coordinator"))).status).toBe(403);
    expect((await stopActing(post("/api/admin/act-as/stop"))).status).toBe(403);
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await startAreaCoordinator(post("/api/admin/act-as/area-coordinator"))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("labels the audit row for a person who holds both roles as a Clubs Administrator, never both", async () => {
    mocks.clubsGrantFindFirst.mockResolvedValue({ id: "grant-c" });
    await startAreaCoordinator(post("/api/admin/act-as/area-coordinator"));
    expect(mocks.writeAuditLog.mock.calls[0]![0].metadata).toEqual(expect.objectContaining({ actorRole: "CLUBS_ADMINISTRATOR" }));
  });

  it("marks the audit entry through the module as well", async () => {
    await actAsAreaCoordinator({ id: "youth-1", viaYouthAdministrator: true }, "staff-session-y", NOW);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ metadata: { actorRole: "YOUTH_ADMINISTRATOR" } });
  });
});

describe("the act-as is re-checked on every read (#1685)", () => {
  it("counts an Area Coordinator act-as while the grant is active, marked as a Youth Admin's and not a Clubs Administrator's", async () => {
    mocks.findFirst.mockResolvedValue(actAsRow("AREA_COORDINATOR"));
    const context = await currentStaffActingContext();
    expect(context).toMatchObject({ role: "AREA_COORDINATOR", viaYouthAdministrator: true });
    expect(context).not.toHaveProperty("viaClubsAdministrator");
    await expect(resolveActiveActAs("staff-session-y", NOW)).resolves.toMatchObject({ viaYouthAdministrator: true });
  });

  it("ends the act-as on the very next read once the grant is removed", async () => {
    mocks.findFirst.mockResolvedValue(actAsRow("AREA_COORDINATOR"));
    await expect(currentStaffActingContext()).resolves.not.toBeNull();
    mocks.youthGrantFindFirst.mockResolvedValue(null);
    await expect(currentStaffActingContext()).resolves.toBeNull();
    expect(mocks.youthGrantFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "youth-1", revokedAt: null } }));
  });

  it("never honours a club director act-as for a Youth Admin, even if such a row existed", async () => {
    mocks.findFirst.mockResolvedValue(actAsRow("CLUB_DIRECTOR"));
    await expect(currentStaffActingContext()).resolves.toBeNull();
  });

  it("does not mark a system administrator's act-as as either role", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { ...youthAdmin.user, globalRole: "SYSTEM_ADMIN" }, sessionId: "staff-session-y" });
    mocks.sessionFindUnique.mockResolvedValue(liveSession("SYSTEM_ADMIN"));
    mocks.findFirst.mockResolvedValue(actAsRow("AREA_COORDINATOR"));
    const context = await currentStaffActingContext();
    expect(context).toMatchObject({ role: "AREA_COORDINATOR" });
    expect(context).not.toHaveProperty("viaYouthAdministrator");
    expect(context).not.toHaveProperty("viaClubsAdministrator");
  });
});
