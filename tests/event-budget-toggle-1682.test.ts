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
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, isAreaCoordinator: mocks.isAreaCoordinator }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/prisma", () => {
  const tx = { eventModule: { createMany: mocks.moduleCreateMany, deleteMany: mocks.moduleDeleteMany, findUnique: mocks.moduleFindUnique } };
  return {
    getPrisma: () => ({
      event: { findFirst: mocks.eventFindFirst },
      eventModule: { findUnique: mocks.moduleFindUnique },
      $transaction: async (run: (client: unknown) => unknown) => run(tx),
    }),
  };
});

import type { MembershipLookup } from "@/modules/access/authorization";
import { PUT as acPut } from "@/app/api/attendee/area-clubs/events/[eventId]/budget/route";
import { PUT as staffPut } from "@/app/api/events/[eventId]/budget/route";
import { BudgetError } from "@/modules/event-budgets/access";
import { applyBudgetSettings, requireAreaCoordinatorBudgetToggleActor, requireStaffBudgetToggleAccess } from "@/modules/event-budgets/settings";
import { defaultModuleKeys, eventModuleDefinition, scopedToggleModuleKeys } from "@/modules/event-modules/catalog";

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
});

describe("the Budget sheet is an optional event module (#1682)", () => {
  it("is off by default, applies to club events, and is switched by the shared scoped helper", () => {
    const definition = eventModuleDefinition("event-budget");
    expect(definition).toMatchObject({ title: "Budget sheet", appliesTo: "club-audience", offByDefault: true, alwaysOn: false });
    expect(defaultModuleKeys("CLUB")).not.toContain("event-budget");
    expect(defaultModuleKeys("GENERAL")).not.toContain("event-budget");
    expect(scopedToggleModuleKeys).toContain("event-budget");
    expect(definition.routes).toEqual(["/more/budget", "/account/area-clubs/events"]);
  });
});

describe("who may switch the Budget sheet on or off, staff side", () => {
  it("lets a system administrator, an Event Admin and the Clubs Administrator", async () => {
    await expect(requireStaffBudgetToggleAccess(session("SYSTEM_ADMIN"), "event-1", lookup(null))).resolves.toEqual({ kind: "staff", userId: "u" });
    await expect(requireStaffBudgetToggleAccess(session(), "event-1", lookup("EVENT_ADMIN"))).resolves.toEqual({ kind: "staff", userId: "u" });
    await expect(requireStaffBudgetToggleAccess(session(), "event-1", lookup("EVENT_ADMIN", { viaClubsAdministrator: true }))).resolves.toEqual({ kind: "staff", userId: "u" });
  });

  it("refuses a Registration Manager, a Finance Manager and every other staff role", async () => {
    for (const role of ["REGISTRATION_MANAGER", "FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF", "KITCHEN_STAFF"]) {
      await expect(requireStaffBudgetToggleAccess(session(), "event-1", lookup(role))).rejects.toMatchObject({ status: 403 });
    }
  });

  it("answers 401 or 403 on the route and changes nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await staffPut(put("https://events.imsda.test/api/events/event-1/budget", { enabled: true }), ctx)).status).toBe(401);
    mocks.getCurrentSession.mockResolvedValue(session());
    mocks.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "u", role: "FINANCE_MANAGER", status: "ACTIVE", permissions: [] });
    expect((await staffPut(put("https://events.imsda.test/api/events/event-1/budget", { enabled: true }), ctx)).status).toBe(403);
    expect(mocks.moduleCreateMany).not.toHaveBeenCalled();
  });
});

describe("who may switch the Budget sheet on or off, Area Coordinator side", () => {
  it("lets an active coordinator who passed the second sign-in step", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    await expect(requireAreaCoordinatorBudgetToggleActor()).resolves.toEqual({ kind: "area-coordinator", accountId: "acct-ac" });
  });

  it("answers not found for a coordinator without the second step, an inactive grant or an ordinary attendee", async () => {
    mocks.currentAreaCoordinator.mockResolvedValue(null);
    await expect(requireAreaCoordinatorBudgetToggleActor()).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    expect((await acPut(put("https://events.imsda.test/api/attendee/area-clubs/events/event-1/budget", { enabled: true }), ctx)).status).toBe(404);
    expect(mocks.moduleCreateMany).not.toHaveBeenCalled();
  });

  it("re-checks the grant when the service is called from anywhere else", async () => {
    mocks.isAreaCoordinator.mockResolvedValue(false);
    await expect(applyBudgetSettings({ kind: "area-coordinator", accountId: "acct-ac" }, "event-1", { enabled: true })).rejects.toBeInstanceOf(BudgetError);
    expect(mocks.moduleCreateMany).not.toHaveBeenCalled();
  });

  it("sees only published club events, where staff also see unpublished ones", async () => {
    await applyBudgetSettings({ kind: "area-coordinator", accountId: "acct-ac" }, "event-1", { enabled: true });
    expect(mocks.eventFindFirst.mock.calls[0]![0].where).toMatchObject({ audience: "CLUB", archivedAt: null, isPublished: true });
    mocks.eventFindFirst.mockClear();
    await applyBudgetSettings({ kind: "staff", userId: "u" }, "event-1", { enabled: true });
    expect(mocks.eventFindFirst.mock.calls[0]![0].where).not.toHaveProperty("isPublished");
  });
});

describe("what switching does", () => {
  it("writes an audit entry naming a coordinator by account", async () => {
    await applyBudgetSettings({ kind: "area-coordinator", accountId: "acct-ac" }, "event-1", { enabled: true });
    expect(mocks.moduleCreateMany).toHaveBeenCalledWith({ data: [{ eventId: "event-1", moduleKey: "event-budget" }], skipDuplicates: true });
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ eventId: "event-1", action: "EVENT_MODULE_ENABLED", entityType: "EventModule", entityId: "event-budget", metadata: { actorAttendeeAccountId: "acct-ac", viaAreaCoordinator: true, moduleKey: "event-budget" } });
    expect(entry.actorUserId).toBeUndefined();
  });

  it("audits a staff switch with the staff user, and a repeat changes nothing and audits nothing", async () => {
    await applyBudgetSettings({ kind: "staff", userId: "user-1" }, "event-1", { enabled: true });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ actorUserId: "user-1", action: "EVENT_MODULE_ENABLED" });
    mocks.writeAuditLog.mockClear();
    mocks.moduleCreateMany.mockResolvedValue({ count: 0 });
    await applyBudgetSettings({ kind: "staff", userId: "user-1" }, "event-1", { enabled: true });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("switching off removes only the switch row (the cost lines are never touched), audited", async () => {
    await applyBudgetSettings({ kind: "staff", userId: "user-1" }, "event-1", { enabled: false });
    expect(mocks.moduleDeleteMany).toHaveBeenCalledWith({ where: { eventId: "event-1", moduleKey: "event-budget" } });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "EVENT_MODULE_DISABLED" });
  });

  it("refuses an empty request and anything the tool does not have", async () => {
    mocks.getCurrentSession.mockResolvedValue(session("SYSTEM_ADMIN"));
    expect((await staffPut(put("https://events.imsda.test/api/events/event-1/budget", {}), ctx)).status).toBe(400);
    expect((await staffPut(put("https://events.imsda.test/api/events/event-1/budget", { enabled: true, moduleKey: "merchandise" }), ctx)).status).toBe(400);
  });
});
