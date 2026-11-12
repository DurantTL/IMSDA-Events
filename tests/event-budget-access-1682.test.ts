import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentAreaCoordinator: vi.fn(),
  isAreaCoordinator: vi.fn(),
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  writeAuditLog: vi.fn(),
  eventFindFirst: vi.fn(),
  eventFindUnique: vi.fn(),
  moduleFindUnique: vi.fn(),
  lineCount: vi.fn(),
  lineCreate: vi.fn(),
  lineFindFirst: vi.fn(),
  lineUpdate: vi.fn(),
  lineDelete: vi.fn(),
  lineFindMany: vi.fn(),
  cloneFindUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, isAreaCoordinator: mocks.isAreaCoordinator }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
// The sources of the auto-filled figures: this file is about who may see and change the sheet, not about the figures.
vi.mock("@/modules/registrations/repository", () => ({ listRegistrations: vi.fn(async () => []) }));
vi.mock("@/modules/reporting/club-event-reports-repository", () => ({ getClubEventRecords: vi.fn(async () => ({ clubs: [] })) }));
vi.mock("@/modules/lodging/service", () => ({ getLodgingView: vi.fn(async () => ({ property: null, buildings: [] })) }));
vi.mock("@/modules/meals/view-repository", () => ({ loadMealView: vi.fn(async () => ({ services: [], plans: [], totals: [] })) }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    eventBudgetCostLine: { count: mocks.lineCount, create: mocks.lineCreate, findFirst: mocks.lineFindFirst, update: mocks.lineUpdate, delete: mocks.lineDelete },
  };
  return {
    getPrisma: () => ({
      event: { findFirst: mocks.eventFindFirst, findUnique: mocks.eventFindUnique },
      eventModule: { findUnique: mocks.moduleFindUnique },
      eventBudgetCostLine: { ...tx.eventBudgetCostLine, findMany: mocks.lineFindMany },
      eventCloneRecord: { findUnique: mocks.cloneFindUnique },
      $transaction: async (run: (client: unknown) => unknown) => run(tx),
    }),
  };
});

import { GET as acExport } from "@/app/api/attendee/area-clubs/events/[eventId]/budget/export/route";
import { DELETE as acDelete, PATCH as acPatch, POST as acPost } from "@/app/api/attendee/area-clubs/events/[eventId]/budget/lines/route";
import { GET as staffExport } from "@/app/api/events/[eventId]/budget/export/route";
import { DELETE as staffDelete, PATCH as staffPatch, POST as staffPost } from "@/app/api/events/[eventId]/budget/lines/route";
import { assertBudgetAccess, requireAreaCoordinatorBudgetActor, requireStaffBudgetReader } from "@/modules/event-budgets/access";

const ctx = { params: Promise.resolve({ eventId: "event-1" }) };
const request = (method: string, body?: unknown) => new Request("https://events.imsda.test/api/x", { method, headers: { origin: "https://events.imsda.test", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const line = { label: "Trophies", description: "First place", quantity: 4, amountCents: 12500 };
const row = { id: "line-1", label: "Trophies", description: "First place", quantity: 4, amountCents: 12500 };

type Who = { name: string; staff?: { role: string | null; globalRole?: "SYSTEM_ADMIN"; viaClubs?: true }; ac?: "active" | "no-second-step" | "revoked" | "not-a-coordinator" | "anonymous"; read: boolean; write: boolean };
const who: Who[] = [
  { name: "system administrator", staff: { role: null, globalRole: "SYSTEM_ADMIN" }, read: true, write: true },
  { name: "Event Admin of the event", staff: { role: "EVENT_ADMIN" }, read: true, write: true },
  { name: "Clubs Administrator (Event Admin on club events)", staff: { role: "EVENT_ADMIN", viaClubs: true }, read: true, write: true },
  { name: "Finance Manager", staff: { role: "FINANCE_MANAGER" }, read: true, write: true },
  { name: "Registration Manager (reports only)", staff: { role: "REGISTRATION_MANAGER" }, read: true, write: false },
  { name: "Communications Manager", staff: { role: "COMMUNICATIONS_MANAGER" }, read: false, write: false },
  { name: "Check-in staff", staff: { role: "CHECK_IN_STAFF" }, read: false, write: false },
  { name: "read-only staff", staff: { role: "READ_ONLY_STAFF" }, read: false, write: false },
  { name: "staff of another event", staff: { role: null }, read: false, write: false },
  { name: "the event's Area Coordinator", ac: "active", read: true, write: true },
  { name: "an Area Coordinator without the second sign-in step", ac: "no-second-step", read: false, write: false },
  { name: "an Area Coordinator whose grant ended", ac: "revoked", read: false, write: false },
  { name: "a club director (not a coordinator)", ac: "not-a-coordinator", read: false, write: false },
  { name: "nobody signed in", ac: "anonymous", read: false, write: false },
];

function signIn(person: Who) {
  if (person.staff) {
    const { role, globalRole, viaClubs } = person.staff;
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", email: "u@example.org", displayName: "U", globalRole: globalRole ?? null } });
    mocks.findActiveMembership.mockResolvedValue(role ? { eventId: "event-1", userId: "u", role, status: "ACTIVE", permissions: [], ...(viaClubs ? { viaClubsAdministrator: true } : {}) } : null);
    return;
  }
  mocks.getCurrentSession.mockResolvedValue({ user: null });
  mocks.currentAreaCoordinator.mockResolvedValue(person.ac === "active" || person.ac === "revoked" ? { id: "acct-ac" } : null);
  // A grant that ended after the page was loaded is caught by the service's own re-read.
  mocks.isAreaCoordinator.mockResolvedValue(person.ac === "active");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventFindFirst.mockResolvedValue({ id: "event-1", name: "Sample Spring Camporee" });
  mocks.eventFindUnique.mockResolvedValue({ slug: "sample-spring-camporee", name: "Sample Spring Camporee" });
  mocks.moduleFindUnique.mockResolvedValue({ id: "on" });
  mocks.lineCount.mockResolvedValue(0);
  mocks.lineCreate.mockResolvedValue(row);
  mocks.lineFindFirst.mockResolvedValue(row);
  mocks.lineUpdate.mockResolvedValue(row);
  mocks.lineDelete.mockResolvedValue(row);
  mocks.lineFindMany.mockResolvedValue([row]);
  mocks.cloneFindUnique.mockResolvedValue(null);
  mocks.isAreaCoordinator.mockResolvedValue(true);
});

async function canRead(person: Who): Promise<boolean> {
  try {
    if (person.staff) {
      const actor = await requireStaffBudgetReader(await mocks.getCurrentSession(), "event-1", mocks.findActiveMembership);
      await assertBudgetAccess(actor, "event-1", "read");
    } else {
      await assertBudgetAccess(await requireAreaCoordinatorBudgetActor(), "event-1", "read");
    }
    return true;
  } catch {
    return false;
  }
}

describe("who may read, change and download the budget sheet (#1682)", () => {
  it.each(who)("$name", async (person) => {
    signIn(person);
    expect(await canRead(person)).toBe(person.read);

    const post = person.staff ? staffPost : acPost;
    const csv = person.staff ? staffExport : acExport;
    const written = await post(request("POST", line), ctx);
    expect(written.status === 201).toBe(person.write);
    expect(mocks.lineCreate).toHaveBeenCalledTimes(person.write ? 1 : 0);

    const downloaded = await csv(request("GET"), ctx);
    expect(downloaded.status === 200).toBe(person.read);
    if (person.read) {
      expect(downloaded.headers.get("content-type")).toContain("text/csv");
      expect(mocks.writeAuditLog.mock.calls.map((call) => call[0].action)).toContain("EVENT_BUDGET_CSV_EXPORTED");
    }
  });

  it.each(who.filter((person) => !person.write))("$name cannot change or delete a line either", async (person) => {
    signIn(person);
    const patch = person.staff ? staffPatch : acPatch;
    const remove = person.staff ? staffDelete : acDelete;
    expect((await patch(request("PATCH", { id: "line-1", ...line }), ctx)).status).toBeGreaterThanOrEqual(400);
    expect((await remove(request("DELETE", { id: "line-1" }), ctx)).status).toBeGreaterThanOrEqual(400);
    expect(mocks.lineUpdate).not.toHaveBeenCalled();
    expect(mocks.lineDelete).not.toHaveBeenCalled();
  });

  it("answers anonymous staff calls 401 and anonymous coordinator calls 404", async () => {
    signIn(who.at(-1)!);
    expect((await staffPost(request("POST", line), ctx)).status).toBe(401);
    expect((await staffExport(request("GET"), ctx)).status).toBe(401);
    expect((await acPost(request("POST", line), ctx)).status).toBe(404);
    expect((await acExport(request("GET"), ctx)).status).toBe(404);
  });

  it("hides the sheet from everyone while the module is off, and for an event that is not a published club event for a coordinator", async () => {
    signIn(who[0]!);
    mocks.moduleFindUnique.mockResolvedValue(null);
    expect((await staffExport(request("GET"), ctx)).status).toBe(404);
    expect((await staffPost(request("POST", line), ctx)).status).toBe(404);
    signIn(who.find((person) => person.ac === "active")!);
    expect((await acExport(request("GET"), ctx)).status).toBe(404);
    expect((await acPost(request("POST", line), ctx)).status).toBe(404);
    mocks.moduleFindUnique.mockResolvedValue({ id: "on" });
    mocks.eventFindFirst.mockResolvedValue(null);
    expect((await acExport(request("GET"), ctx)).status).toBe(404);
    expect(mocks.eventFindFirst.mock.calls.at(-1)![0].where).toMatchObject({ audience: "CLUB", archivedAt: null, isPublished: true });
  });

  it("keeps the coordinator route on the real coordinator check, never staff acting as one", () => {
    // `currentAreaCoordinator` answers for a real attendee account only; the route files name no other check.
    expect(requireAreaCoordinatorBudgetActor.toString()).toContain("currentAreaCoordinator");
  });
});

describe("cost line changes are audited with amounts only (#1682)", () => {
  it("audits add, change and delete under the right actor, without the description or any person", async () => {
    signIn(who.find((person) => person.name === "Finance Manager")!);
    await staffPost(request("POST", line), ctx);
    await staffPatch(request("PATCH", { id: "line-1", ...line, amountCents: 9900 }), ctx);
    await staffDelete(request("DELETE", { id: "line-1" }), ctx);
    expect(mocks.writeAuditLog.mock.calls.map((call) => call[0].action)).toEqual(["EVENT_BUDGET_COST_ADDED", "EVENT_BUDGET_COST_CHANGED", "EVENT_BUDGET_COST_DELETED"]);
    for (const [entry] of mocks.writeAuditLog.mock.calls) {
      expect(entry).toMatchObject({ eventId: "event-1", actorUserId: "u", entityType: "EventBudgetCostLine", entityId: "line-1" });
      expect(Object.keys(entry.metadata).sort()).toEqual(["amountCents", "eventId", "label", "lineId", "quantity"]);
      expect(JSON.stringify(entry)).not.toContain("First place");
    }
  });

  it("names a coordinator by account on the audit entry", async () => {
    signIn(who.find((person) => person.ac === "active")!);
    await acPost(request("POST", line), ctx);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry.actorUserId).toBeUndefined();
    expect(entry.metadata).toMatchObject({ actorAttendeeAccountId: "acct-ac", viaAreaCoordinator: true, amountCents: 12500 });
  });

  it("treats a line of another event as missing", async () => {
    signIn(who[0]!);
    mocks.lineFindFirst.mockResolvedValue(null);
    expect((await staffPatch(request("PATCH", { id: "line-elsewhere", ...line }), ctx)).status).toBe(404);
    expect((await staffDelete(request("DELETE", { id: "line-elsewhere" }), ctx)).status).toBe(404);
    expect(mocks.lineFindFirst.mock.calls[0]![0].where).toEqual({ id: "line-elsewhere", eventId: "event-1" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a bad line before anything is written", async () => {
    signIn(who[0]!);
    for (const bad of [{ ...line, amountCents: -1 }, { ...line, amountCents: 1.5 }, { ...line, amountCents: 100_000_001 }, { ...line, label: "Free text" }, { ...line, quantity: 0 }, { ...line, receiptUrl: "https://example.org/r.pdf" }]) {
      expect((await staffPost(request("POST", bad), ctx)).status).toBe(400);
    }
    expect(mocks.lineCreate).not.toHaveBeenCalled();
  });

  it("stops at the cap on lines", async () => {
    signIn(who[0]!);
    mocks.lineCount.mockResolvedValue(200);
    expect((await staffPost(request("POST", line), ctx)).status).toBe(422);
    expect(mocks.lineCreate).not.toHaveBeenCalled();
  });
});

describe("last year's sheet is read only and checked against the source event (#1682)", () => {
  it("shows nothing when the event was not copied, or when the clone record has no source", async () => {
    signIn(who[0]!);
    const { loadCarriedBudget } = await import("@/modules/event-budgets/repository");
    const actor = { kind: "staff" as const, userId: "u", canWrite: true };
    expect(await loadCarriedBudget(actor, "event-1")).toEqual({ kind: "none" });
    mocks.cloneFindUnique.mockResolvedValue({ sourceEventId: null });
    expect(await loadCarriedBudget(actor, "event-1")).toEqual({ kind: "none" });
  });

  it("says there was no sheet when the source kept none, and shows nothing to staff who may not read the source", async () => {
    const { loadCarriedBudget } = await import("@/modules/event-budgets/repository");
    const staff = { kind: "staff" as const, userId: "u", canWrite: true };
    const { findActiveMembership } = mocks;
    mocks.cloneFindUnique.mockResolvedValue({ sourceEventId: "event-0" });
    mocks.eventFindFirst.mockResolvedValue({ id: "event-0" });
    mocks.eventFindUnique.mockResolvedValue({ name: "Last Year Camporee", slug: "last-year" });
    mocks.lineCount.mockResolvedValue(0);
    mocks.moduleFindUnique.mockResolvedValue(null);
    const session = { user: { id: "u", email: "u@example.org", displayName: "U", globalRole: null } };
    findActiveMembership.mockResolvedValue({ eventId: "event-0", userId: "u", role: "FINANCE_MANAGER", status: "ACTIVE", permissions: [] });
    expect(await loadCarriedBudget(staff, "event-1", { session, lookup: findActiveMembership })).toEqual({ kind: "no-sheet", sourceEventId: "event-0", sourceEventName: "Last Year Camporee" });
    findActiveMembership.mockResolvedValue({ eventId: "event-0", userId: "u", role: "READ_ONLY_STAFF", status: "ACTIVE", permissions: [] });
    expect(await loadCarriedBudget(staff, "event-1", { session, lookup: findActiveMembership })).toEqual({ kind: "none" });
    findActiveMembership.mockResolvedValue(null);
    expect(await loadCarriedBudget(staff, "event-1", { session, lookup: findActiveMembership })).toEqual({ kind: "none" });
  });
});
