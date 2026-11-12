import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentAreaCoordinator: vi.fn(),
  isAreaCoordinator: vi.fn(),
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  writeAuditLog: vi.fn(),
  eventFindFirst: vi.fn(),
  moduleFindUnique: vi.fn(),
  moduleCreateMany: vi.fn(),
  moduleDeleteMany: vi.fn(),
  onEnabled: vi.fn(),
  onDisabled: vi.fn(),
  ensureForm: vi.fn(),
  debriefFindUnique: vi.fn(),
  debriefUpsert: vi.fn(),
  debriefUpdate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, isAreaCoordinator: mocks.isAreaCoordinator }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/event-debriefs/lifecycle", () => ({ onDebriefEnabled: mocks.onEnabled, onDebriefDisabled: mocks.onDisabled, ensureDebriefForm: mocks.ensureForm }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    eventModule: { createMany: mocks.moduleCreateMany, deleteMany: mocks.moduleDeleteMany },
    eventDebrief: { upsert: mocks.debriefUpsert, update: mocks.debriefUpdate },
  };
  return {
    getPrisma: () => ({
      event: { findFirst: mocks.eventFindFirst, findUnique: vi.fn(async () => ({ slug: "sample-spring-camporee" })) },
      eventModule: { findUnique: mocks.moduleFindUnique },
      eventDebrief: { findUnique: mocks.debriefFindUnique },
      informationForm: { findFirst: vi.fn(async () => ({ slug: "debrief" })) },
      $transaction: async (run: (client: unknown) => unknown) => run(tx),
    }),
  };
});

import type { MembershipLookup } from "@/modules/access/authorization";
import { PUT as acPut } from "@/app/api/attendee/area-clubs/events/[eventId]/debrief/route";
import { PUT as staffPut } from "@/app/api/events/[eventId]/debrief/route";
import { applyDebriefSettings, DebriefError, requireAreaCoordinatorDebriefActor, requireStaffDebriefAccess } from "@/modules/event-debriefs/settings";

const lookup = (role: string | null, extra: Record<string, unknown> = {}) => (async () => (role ? { eventId: "event-1", userId: "u", role, status: "ACTIVE" as const, permissions: [], ...extra } : null)) as unknown as MembershipLookup;
const session = (globalRole: "SYSTEM_ADMIN" | null = null) => ({ user: { id: "u", email: "u@example.org", displayName: "U", globalRole } });

const put = (url: string, body: unknown) => new Request(url, { method: "PUT", headers: { origin: "https://events.imsda.test", "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ eventId: "event-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAreaCoordinator.mockResolvedValue(true);
  mocks.eventFindFirst.mockResolvedValue({ id: "event-1", name: "Sample Spring Camporee" });
  mocks.moduleFindUnique.mockResolvedValue(null);
  mocks.moduleCreateMany.mockResolvedValue({ count: 1 });
  mocks.moduleDeleteMany.mockResolvedValue({ count: 1 });
  mocks.debriefFindUnique.mockResolvedValue(null);
  mocks.debriefUpsert.mockResolvedValue({ evaluationEnabled: false });
});

describe("who may switch the Debrief on or off, staff side (#1679)", () => {
  it("lets a system administrator, an Event Admin and the Clubs Administrator (an Event Admin on club events)", async () => {
    await expect(requireStaffDebriefAccess(session("SYSTEM_ADMIN"), "event-1", lookup(null))).resolves.toEqual({ kind: "staff", userId: "u" });
    await expect(requireStaffDebriefAccess(session(), "event-1", lookup("EVENT_ADMIN"))).resolves.toEqual({ kind: "staff", userId: "u" });
    await expect(requireStaffDebriefAccess(session(), "event-1", lookup("EVENT_ADMIN", { viaClubsAdministrator: true }))).resolves.toEqual({ kind: "staff", userId: "u" });
  });

  it("refuses a Registration Manager and every other staff role", async () => {
    for (const role of ["REGISTRATION_MANAGER", "FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF", "KITCHEN_STAFF"]) {
      await expect(requireStaffDebriefAccess(session(), "event-1", lookup(role))).rejects.toMatchObject({ status: 403 });
    }
  });

  it("refuses someone not on the event, and someone not signed in (a plain attendee has no staff session)", async () => {
    await expect(requireStaffDebriefAccess(session(), "event-1", lookup(null))).rejects.toMatchObject({ status: 403 });
    await expect(requireStaffDebriefAccess({ user: null }, "event-1", lookup(null))).rejects.toMatchObject({ status: 401 });
  });

  it("answers 401 or 403 on the route and changes nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await staffPut(put("https://events.imsda.test/api/events/event-1/debrief", { enabled: true }), ctx)).status).toBe(401);
    mocks.getCurrentSession.mockResolvedValue(session());
    mocks.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "u", role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: [] });
    expect((await staffPut(put("https://events.imsda.test/api/events/event-1/debrief", { enabled: true }), ctx)).status).toBe(403);
    expect(mocks.moduleCreateMany).not.toHaveBeenCalled();
  });
});

describe("who may switch the Debrief on or off, Area Coordinator side (#1679)", () => {
  it("lets an active coordinator who passed the second sign-in step", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    await expect(requireAreaCoordinatorDebriefActor()).resolves.toEqual({ kind: "area-coordinator", accountId: "acct-ac" });
  });

  it("answers not found for a coordinator without the second step, an inactive grant or an ordinary attendee", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue(null);
    await expect(requireAreaCoordinatorDebriefActor()).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    const response = await acPut(put("https://events.imsda.test/api/attendee/area-clubs/events/event-1/debrief", { enabled: true }), ctx);
    expect(response.status).toBe(404);
    expect(mocks.moduleCreateMany).not.toHaveBeenCalled();
  });

  it("re-checks the grant when the service is called from anywhere else", async () => {
    mocks.isAreaCoordinator.mockResolvedValue(false);
    await expect(applyDebriefSettings({ kind: "area-coordinator", accountId: "acct-ac" }, "event-1", { enabled: true })).rejects.toBeInstanceOf(DebriefError);
    expect(mocks.moduleCreateMany).not.toHaveBeenCalled();
  });

  it("sees only published club events", async () => {
    await applyDebriefSettings({ kind: "area-coordinator", accountId: "acct-ac" }, "event-1", { enabled: true });
    expect(mocks.eventFindFirst.mock.calls[0]![0].where).toMatchObject({ audience: "CLUB", archivedAt: null, isPublished: true });
    mocks.eventFindFirst.mockClear();
    await applyDebriefSettings({ kind: "staff", userId: "u" }, "event-1", { enabled: true });
    expect(mocks.eventFindFirst.mock.calls[0]![0].where).not.toHaveProperty("isPublished");
  });

  it("may not choose the director evaluation, which goes to club directors", async () => {
    await expect(applyDebriefSettings({ kind: "area-coordinator", accountId: "acct-ac" }, "event-1", { evaluationEnabled: true })).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    expect(mocks.debriefUpsert).not.toHaveBeenCalled();
  });
});

describe("what switching does (#1679)", () => {
  it("is off until someone switches it on, and writes an audit entry naming a coordinator by account", async () => {
    await applyDebriefSettings({ kind: "area-coordinator", accountId: "acct-ac" }, "event-1", { enabled: true });
    expect(mocks.moduleCreateMany).toHaveBeenCalledWith({ data: [{ eventId: "event-1", moduleKey: "debrief" }], skipDuplicates: true });
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ eventId: "event-1", action: "EVENT_MODULE_ENABLED", entityType: "EventModule", entityId: "debrief", metadata: { actorAttendeeAccountId: "acct-ac", viaAreaCoordinator: true, moduleKey: "debrief" } });
    expect(entry.actorUserId).toBeUndefined();
    expect(mocks.onEnabled).toHaveBeenCalledTimes(1);
  });

  it("audits a staff switch with the staff user", async () => {
    await applyDebriefSettings({ kind: "staff", userId: "user-1" }, "event-1", { enabled: true });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ actorUserId: "user-1", action: "EVENT_MODULE_ENABLED" });
  });

  it("switching on again changes nothing and sets nothing up twice", async () => {
    mocks.moduleFindUnique.mockResolvedValue({ id: "row" });
    mocks.moduleCreateMany.mockResolvedValue({ count: 0 });
    await applyDebriefSettings({ kind: "staff", userId: "user-1" }, "event-1", { enabled: true });
    expect(mocks.onEnabled).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("switching off stops the unsent emails, audited, and only when it was on", async () => {
    mocks.moduleFindUnique.mockResolvedValue({ id: "row" });
    await applyDebriefSettings({ kind: "staff", userId: "user-1" }, "event-1", { enabled: false });
    expect(mocks.onDisabled).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "EVENT_MODULE_DISABLED" });
    mocks.onDisabled.mockClear();
    mocks.moduleFindUnique.mockResolvedValue(null);
    await applyDebriefSettings({ kind: "staff", userId: "user-1" }, "event-1", { enabled: false });
    expect(mocks.onDisabled).not.toHaveBeenCalled();
  });

  it("lets staff switch the director evaluation only while the Debrief is on, audited", async () => {
    await expect(applyDebriefSettings({ kind: "staff", userId: "user-1" }, "event-1", { evaluationEnabled: true })).rejects.toMatchObject({ code: "TURN_ON_FIRST" });
    mocks.moduleFindUnique.mockResolvedValue({ id: "row" });
    await applyDebriefSettings({ kind: "staff", userId: "user-1" }, "event-1", { evaluationEnabled: true });
    expect(mocks.debriefUpdate).toHaveBeenCalledWith({ where: { eventId: "event-1" }, data: { evaluationEnabled: true } });
    expect(mocks.ensureForm).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ purpose: "DIRECTOR_EVALUATION" }));
    expect(mocks.writeAuditLog.mock.calls.at(-1)![0]).toMatchObject({ action: "EVENT_DEBRIEF_EVALUATION_ENABLED" });
  });

  it("refuses an empty request and anything the tool does not have", async () => {
    mocks.getCurrentSession.mockResolvedValue(session("SYSTEM_ADMIN"));
    expect((await staffPut(put("https://events.imsda.test/api/events/event-1/debrief", {}), ctx)).status).toBe(400);
    expect((await staffPut(put("https://events.imsda.test/api/events/event-1/debrief", { enabled: true, moduleKey: "merchandise" }), ctx)).status).toBe(400);
  });
});
