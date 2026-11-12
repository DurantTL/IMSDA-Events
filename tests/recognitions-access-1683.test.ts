import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  eventFindUnique: vi.fn(),
  moduleFindUnique: vi.fn(),
  moduleCreateMany: vi.fn(),
  moduleDeleteMany: vi.fn(),
  eventFindFirst: vi.fn(),
  writeAuditLog: vi.fn(),
  tagFindFirst: vi.fn(),
  tagCreate: vi.fn(),
  tagFindMany: vi.fn(),
  attendeeFindFirst: vi.fn(),
  attendeeFindMany: vi.fn(),
  assignmentFindFirst: vi.fn(),
  assignmentFindMany: vi.fn(),
  assignmentCreate: vi.fn(),
  assignmentUpdate: vi.fn(),
  assignmentDelete: vi.fn(),
  assignmentFindUniqueOrThrow: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: vi.fn(), isAreaCoordinator: vi.fn() }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/lib/prisma", () => {
  const client = {
    event: { findUnique: mocks.eventFindUnique, findFirst: mocks.eventFindFirst },
    eventModule: { findUnique: mocks.moduleFindUnique, createMany: mocks.moduleCreateMany, deleteMany: mocks.moduleDeleteMany },
    eventTag: { findFirst: mocks.tagFindFirst, create: mocks.tagCreate, findMany: mocks.tagFindMany },
    registrationAttendee: { findFirst: mocks.attendeeFindFirst, findMany: mocks.attendeeFindMany },
    attendeeTagAssignment: { findFirst: mocks.assignmentFindFirst, findMany: mocks.assignmentFindMany, create: mocks.assignmentCreate, update: mocks.assignmentUpdate, delete: mocks.assignmentDelete, findUniqueOrThrow: mocks.assignmentFindUniqueOrThrow },
    auditLog: { create: mocks.auditCreate },
    $transaction: async (run: (tx: unknown) => unknown) => run(client),
  };
  return { getPrisma: () => client };
});

import type { MembershipLookup } from "@/modules/access/authorization";
import { GET as getSummary, POST as postRecognition } from "@/app/api/events/[eventId]/recognitions/route";
import { GET as getAttendees } from "@/app/api/events/[eventId]/recognitions/attendees/route";
import { DELETE as deleteMark, POST as postMark } from "@/app/api/events/[eventId]/recognitions/marks/route";
import { markRecognition, undoRecognition } from "@/modules/recognitions/repository";

const lookup = (role: string | null) => (async () => (role ? { eventId: "event-1", userId: "u", role, status: "ACTIVE" as const, permissions: [] } : null)) as unknown as MembershipLookup;
const session = { user: { id: "u1", email: "u@example.org", displayName: "Staff Sample", globalRole: null } };
const ctx = { params: Promise.resolve({ eventId: "event-1" }) };
const json = (method: string, body: unknown) => new Request("https://events.imsda.test/api/events/event-1/recognitions", { method, headers: { origin: "https://events.imsda.test", "content-type": "application/json" }, body: JSON.stringify(body) });
const as = (role: string | null) => mocks.findActiveMembership.mockImplementation(lookup(role));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSession.mockResolvedValue(session);
  mocks.eventFindUnique.mockResolvedValue({ audience: "CLUB" });
  mocks.moduleFindUnique.mockResolvedValue({ id: "m1" });
  mocks.tagFindFirst.mockResolvedValue({ id: "tag-1", name: "Memory verses", isActive: true });
  mocks.tagFindMany.mockResolvedValue([]);
  mocks.attendeeFindFirst.mockResolvedValue({ id: "att-1" });
  mocks.attendeeFindMany.mockResolvedValue([]);
  mocks.assignmentFindMany.mockResolvedValue([]);
  mocks.auditCreate.mockResolvedValue({});
});

describe("recognition routes check permission on the server (#1683)", () => {
  it("refuses staff with no registration permission on every route, and touches nothing", async () => {
    as("CHECK_IN_STAFF");
    const responses = await Promise.all([
      getSummary(new Request("https://events.imsda.test/x"), ctx),
      getAttendees(new Request("https://events.imsda.test/x?q=al"), ctx),
      postMark(json("POST", { attendeeId: "att-1", recognitionId: "tag-1" }), ctx),
      deleteMark(json("DELETE", { attendeeId: "att-1", recognitionId: "tag-1" }), ctx),
      postRecognition(json("POST", { name: "Memory verses", item: "PIN" }), ctx),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
    expect(mocks.assignmentUpdate).not.toHaveBeenCalled();
    expect(mocks.tagCreate).not.toHaveBeenCalled();
  });

  it("refuses a signed-out visitor and a person with no role on the event", async () => {
    mocks.getCurrentSession.mockResolvedValue(null);
    expect((await postMark(json("POST", { attendeeId: "att-1", recognitionId: "tag-1" }), ctx)).status).toBeGreaterThanOrEqual(401);
    mocks.getCurrentSession.mockResolvedValue(session);
    as(null);
    expect((await getSummary(new Request("https://events.imsda.test/x"), ctx)).status).toBeGreaterThanOrEqual(401);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it("lets registration staff mark and undo, but not list a recognition (event setup)", async () => {
    as("REGISTRATION_MANAGER");
    mocks.assignmentFindFirst.mockResolvedValueOnce(null);
    mocks.assignmentCreate.mockResolvedValue({ id: "as-1", tag: { id: "tag-1", name: "Memory verses", color: "#1D4ED8", description: "", isActive: true }, appliedBy: { id: "u1", displayName: "Staff Sample" }, appliedAt: new Date("2027-06-01T12:00:00Z"), removedBy: null, removedAt: null });
    expect((await postMark(json("POST", { attendeeId: "att-1", recognitionId: "tag-1" }), ctx)).status).toBe(201);
    expect(mocks.assignmentCreate).toHaveBeenCalledWith(expect.objectContaining({ data: { eventId: "event-1", attendeeId: "att-1", tagId: "tag-1", appliedByUserId: "u1" } }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "ATTENDEE_TAG_APPLIED", actorUserId: "u1" }) }));
    expect((await postRecognition(json("POST", { name: "Memory verses", item: "PIN" }), ctx)).status).toBe(403);
    expect(mocks.tagCreate).not.toHaveBeenCalled();
  });

  it("lets an event administrator list a recognition, audited, with the fixed color for what it earns", async () => {
    as("EVENT_ADMIN");
    mocks.tagCreate.mockResolvedValue({ id: "tag-9", name: "Memory verses", isActive: true });
    const response = await postRecognition(json("POST", { name: "Memory verses", item: "PIN" }), ctx);
    expect(response.status).toBe(201);
    expect(mocks.tagCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ eventId: "event-1", recognitionItem: "PIN", normalizedName: "memory verses", color: "#1D4ED8" }) });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "TAG_CREATED", entityId: "tag-9" }) });
  });

  it("does nothing while the module is off, and for a non-club event, even for an administrator", async () => {
    as("EVENT_ADMIN");
    mocks.moduleFindUnique.mockResolvedValue(null);
    const off = await postMark(json("POST", { attendeeId: "att-1", recognitionId: "tag-1" }), ctx);
    expect(off.status).toBe(409);
    expect((await off.json()).error).toBe("MODULE_OFF");
    mocks.moduleFindUnique.mockResolvedValue({ id: "m1" });
    mocks.eventFindUnique.mockResolvedValue({ audience: "GENERAL" });
    expect((await getSummary(new Request("https://events.imsda.test/x"), ctx)).status).toBe(409);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it("rejects a search that is too short or a malformed mark", async () => {
    as("REGISTRATION_MANAGER");
    expect((await getAttendees(new Request("https://events.imsda.test/x?q=a"), ctx)).status).toBe(400);
    expect((await postMark(json("POST", { attendeeId: "att-1" }), ctx)).status).toBe(400);
  });

  it("returns names and club only from a search", async () => {
    as("REGISTRATION_MANAGER");
    mocks.attendeeFindMany.mockResolvedValue([{
      id: "att-1",
      profileSnapshot: { firstName: "Alex", lastName: "Sample", medical: "never shown" },
      person: { firstName: "Alex", lastName: "Sample" },
      registration: { clubRegistration: { organizationId: "org1", teamKey: "", teamName: null, organization: { name: "Eagle Pathfinders" } } },
    }]);
    mocks.assignmentFindMany.mockResolvedValue([{ attendeeId: "att-1", tagId: "tag-1" }]);
    const body = await (await getAttendees(new Request("https://events.imsda.test/x?q=alex"), ctx)).json();
    expect(body.results).toEqual([{ attendeeId: "att-1", name: "Alex Sample", clubName: "Eagle Pathfinders", earnedRecognitionIds: ["tag-1"] }]);
    expect(JSON.stringify(body)).not.toContain("never shown");
  });
});

describe("marking goes through the audited tag path (#1683)", () => {
  it("refuses to mark with an ordinary tag, and to mark someone not on a club registration", async () => {
    mocks.tagFindFirst.mockResolvedValue(null);
    await expect(markRecognition("event-1", "att-1", "plain-tag", "u1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.tagFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ recognitionItem: { not: null } }) }));
    mocks.tagFindFirst.mockResolvedValue({ id: "tag-1", name: "Memory verses", isActive: true });
    mocks.attendeeFindFirst.mockResolvedValue(null);
    await expect(markRecognition("event-1", "outsider", "tag-1", "u1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it("marking twice leaves one active mark", async () => {
    mocks.assignmentFindFirst.mockResolvedValue({ id: "as-1" });
    mocks.assignmentFindUniqueOrThrow.mockResolvedValue({ id: "as-1", tag: { id: "tag-1", name: "Memory verses", color: "#1D4ED8", description: "", isActive: true }, appliedBy: { id: "u1", displayName: "Staff Sample" }, appliedAt: new Date("2027-06-01T12:00:00Z"), removedBy: null, removedAt: null });
    await markRecognition("event-1", "att-1", "tag-1", "u1");
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it("undo stamps the mark as removed and keeps the row, with an audit entry", async () => {
    mocks.assignmentFindFirst.mockResolvedValue({ id: "as-1", tag: { name: "Memory verses" } });
    mocks.assignmentUpdate.mockResolvedValue({ id: "as-1", tag: { id: "tag-1", name: "Memory verses", color: "#1D4ED8", description: "", isActive: true }, appliedBy: { id: "u1", displayName: "Staff Sample" }, appliedAt: new Date("2027-06-01T12:00:00Z"), removedBy: { id: "u2", displayName: "Other Sample" }, removedAt: new Date("2027-06-01T13:00:00Z") });
    await undoRecognition("event-1", "att-1", "tag-1", "u2");
    expect(mocks.assignmentUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "as-1" }, data: expect.objectContaining({ removedByUserId: "u2", removedAt: expect.any(Date) }) }));
    expect(mocks.assignmentDelete).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "ATTENDEE_TAG_REMOVED", actorUserId: "u2" }) });
  });
});

describe("the general tag routes cannot mark a recognition (#1683)", () => {
  it("refuses to apply or remove a recognition tag through the attendee tag service", async () => {
    const { applyAttendeeTag, removeAttendeeTag } = await import("@/modules/tags/repository");
    mocks.tagFindFirst.mockResolvedValue({ id: "tag-1", name: "Memory verses", isActive: true, recognitionItem: "PIN" });
    await expect(applyAttendeeTag("event-1", "att-1", "tag-1", "u1")).rejects.toMatchObject({ code: "RECOGNITION_TAG" });
    mocks.assignmentFindFirst.mockResolvedValue({ id: "as-1", tag: { name: "Memory verses", recognitionItem: "PIN" } });
    await expect(removeAttendeeTag("event-1", "att-1", "tag-1", "u1")).rejects.toMatchObject({ code: "RECOGNITION_TAG" });
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
    expect(mocks.assignmentUpdate).not.toHaveBeenCalled();
  });

  it("answers the generic apply route with a plain 409", async () => {
    const route = await import("@/app/api/events/[eventId]/registrations/[registrationId]/attendees/[attendeeId]/tags/route");
    as("REGISTRATION_MANAGER");
    mocks.tagFindFirst.mockResolvedValue({ id: "tag-1", name: "Memory verses", isActive: true, recognitionItem: "PIN" });
    const response = await route.POST(json("POST", { tagId: "tag-1" }), { params: Promise.resolve({ eventId: "event-1", registrationId: "r1", attendeeId: "att-1" }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("RECOGNITION_TAG");
  });
});

describe("who can switch Recognitions on (#1683)", () => {
  it("is a scoped module, switched by staff here; the coordinator side has no route in this slice", async () => {
    const { scopedToggleModuleKeys } = await import("@/modules/event-modules/catalog");
    expect(scopedToggleModuleKeys).toContain("recognitions");
    const { PUT } = await import("@/app/api/events/[eventId]/recognitions/settings/route");
    for (const role of ["REGISTRATION_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF"]) {
      as(role);
      expect((await PUT(json("PUT", { enabled: true }), ctx)).status).toBe(403);
    }
    expect(mocks.moduleCreateMany).not.toHaveBeenCalled();
  });

  it("lets an Event Admin switch it on and audits the change", async () => {
    const { PUT } = await import("@/app/api/events/[eventId]/recognitions/settings/route");
    as("EVENT_ADMIN");
    mocks.eventFindFirst.mockResolvedValue({ id: "event-1", name: "Sample Camporee" });
    mocks.moduleCreateMany.mockResolvedValue({ count: 1 });
    const response = await PUT(json("PUT", { enabled: true }), ctx);
    expect(response.status).toBe(200);
    expect(mocks.moduleCreateMany).toHaveBeenCalledWith({ data: [{ eventId: "event-1", moduleKey: "recognitions" }], skipDuplicates: true });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "EVENT_MODULE_ENABLED", actorUserId: "u1" }), expect.anything());
  });
});
