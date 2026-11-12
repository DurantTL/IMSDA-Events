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
  activityAggregate: vi.fn(),
  activityCreate: vi.fn(),
  activityFindFirst: vi.fn(),
  activityFindMany: vi.fn(),
  activityUpdate: vi.fn(),
  activityDelete: vi.fn(),
  assignmentFindFirst: vi.fn(),
  assignmentCreate: vi.fn(),
  assignmentDelete: vi.fn(),
  assignmentDeleteMany: vi.fn(),
  attendeeFindFirst: vi.fn(),
  attendeeFindMany: vi.fn(),
  membershipFindFirst: vi.fn(),
  membershipFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, isAreaCoordinator: mocks.isAreaCoordinator }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    eventStaffingActivity: { aggregate: mocks.activityAggregate, create: mocks.activityCreate, findFirst: mocks.activityFindFirst, findMany: mocks.activityFindMany, update: mocks.activityUpdate, delete: mocks.activityDelete },
    eventStaffingAssignment: { findFirst: mocks.assignmentFindFirst, create: mocks.assignmentCreate, delete: mocks.assignmentDelete, deleteMany: mocks.assignmentDeleteMany },
    registrationAttendee: { findFirst: mocks.attendeeFindFirst, findMany: mocks.attendeeFindMany },
    eventMembership: { findFirst: mocks.membershipFindFirst, findMany: mocks.membershipFindMany },
  };
  return {
    getPrisma: () => ({
      ...tx,
      event: { findFirst: mocks.eventFindFirst, findUnique: mocks.eventFindUnique },
      eventModule: { findUnique: mocks.moduleFindUnique },
      $transaction: async (run: (client: unknown) => unknown) => run({ ...tx }),
    }),
  };
});

import { GET as acExport } from "@/app/api/attendee/area-clubs/events/[eventId]/staffing/export/route";
import { DELETE as acAssignDelete, POST as acAssign } from "@/app/api/attendee/area-clubs/events/[eventId]/staffing/assignments/route";
import { DELETE as acActivityDelete, PATCH as acActivityPatch, POST as acActivityPost } from "@/app/api/attendee/area-clubs/events/[eventId]/staffing/activities/route";
import { GET as staffExport } from "@/app/api/events/[eventId]/staffing/export/route";
import { DELETE as staffAssignDelete, POST as staffAssign } from "@/app/api/events/[eventId]/staffing/assignments/route";
import { DELETE as staffActivityDelete, PATCH as staffActivityPatch, POST as staffActivityPost } from "@/app/api/events/[eventId]/staffing/activities/route";
import { assertStaffingAccess, requireAreaCoordinatorStaffingActor, requireStaffStaffingReader } from "@/modules/event-staffing/access";
import { loadStaffingSheet } from "@/modules/event-staffing/repository";

const ctx = { params: Promise.resolve({ eventId: "event-1" }) };
const request = (method: string, body?: unknown) => new Request("https://events.imsda.test/api/x", { method, headers: { origin: "https://events.imsda.test", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const activity = { name: "Canoe", description: "Paddling", location: "Lake", timeText: "Friday 2 p.m.", tltsNeeded: 2, lifeguardsNeeded: 4, helpersNeeded: 1 };
const activityRow = { id: "act-1", ...activity, assignments: [] as unknown[], _count: { assignments: 0 } };
const assign = { activityId: "act-1", role: "LEAD", assignee: { kind: "person", id: "person-1" } };

type Who = { name: string; staff?: { role: string | null; globalRole?: "SYSTEM_ADMIN"; viaClubs?: true }; ac?: "active" | "no-second-step" | "revoked" | "not-a-coordinator" | "anonymous"; read: boolean; write: boolean };
const who: Who[] = [
  { name: "system administrator", staff: { role: null, globalRole: "SYSTEM_ADMIN" }, read: true, write: true },
  { name: "Event Admin of the event", staff: { role: "EVENT_ADMIN" }, read: true, write: true },
  { name: "Clubs Administrator (Event Admin on club events)", staff: { role: "EVENT_ADMIN", viaClubs: true }, read: true, write: true },
  { name: "Finance Manager", staff: { role: "FINANCE_MANAGER" }, read: true, write: false },
  { name: "Registration Manager", staff: { role: "REGISTRATION_MANAGER" }, read: true, write: false },
  { name: "Communications Manager", staff: { role: "COMMUNICATIONS_MANAGER" }, read: true, write: false },
  { name: "Check-in staff", staff: { role: "CHECK_IN_STAFF" }, read: true, write: false },
  { name: "read-only staff", staff: { role: "READ_ONLY_STAFF" }, read: true, write: false },
  { name: "Kitchen staff (no event view)", staff: { role: "KITCHEN_STAFF" }, read: false, write: false },
  { name: "staff of another event", staff: { role: null }, read: false, write: false },
  { name: "the event's Area Coordinator", ac: "active", read: true, write: true },
  { name: "an Area Coordinator without the second sign-in step", ac: "no-second-step", read: false, write: false },
  { name: "an Area Coordinator whose grant ended", ac: "revoked", read: false, write: false },
  // An assigned or unassigned attendee, a club director and staff acting as a coordinator all reach the coordinator
  // routes as "not a coordinator": `currentAreaCoordinator` answers for a real coordinator account only.
  { name: "an attendee, assigned or not, a club director, or staff acting as a coordinator", ac: "not-a-coordinator", read: false, write: false },
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
  mocks.eventFindUnique.mockResolvedValue({ slug: "sample-spring-camporee" });
  mocks.moduleFindUnique.mockResolvedValue({ id: "on" });
  mocks.activityAggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { position: null } });
  mocks.activityCreate.mockResolvedValue({ id: "act-1" });
  mocks.activityFindFirst.mockResolvedValue(activityRow);
  mocks.activityFindMany.mockResolvedValue([]);
  mocks.activityUpdate.mockResolvedValue({});
  mocks.activityDelete.mockResolvedValue({});
  mocks.assignmentFindFirst.mockResolvedValue({ id: "asg-1", activityId: "act-1", role: "HELPER", personId: "person-1", userId: null });
  mocks.assignmentCreate.mockResolvedValue({ id: "asg-1" });
  mocks.assignmentDelete.mockResolvedValue({});
  mocks.assignmentDeleteMany.mockResolvedValue({ count: 0 });
  mocks.attendeeFindFirst.mockResolvedValue({ id: "ra-1" });
  mocks.attendeeFindMany.mockResolvedValue([]);
  mocks.membershipFindFirst.mockResolvedValue({ id: "m-1" });
  mocks.membershipFindMany.mockResolvedValue([]);
  mocks.isAreaCoordinator.mockResolvedValue(true);
});

async function canRead(person: Who): Promise<boolean> {
  try {
    if (person.staff) {
      const actor = await requireStaffStaffingReader(await mocks.getCurrentSession(), "event-1", mocks.findActiveMembership);
      await assertStaffingAccess(actor, "event-1", "read");
    } else {
      await assertStaffingAccess(await requireAreaCoordinatorStaffingActor(), "event-1", "read");
    }
    return true;
  } catch {
    return false;
  }
}

describe("who may read, change and download the staffing sheet (#1678)", () => {
  it.each(who)("$name", async (person) => {
    signIn(person);
    expect(await canRead(person)).toBe(person.read);

    const post = person.staff ? staffActivityPost : acActivityPost;
    const assignRoute = person.staff ? staffAssign : acAssign;
    const csv = person.staff ? staffExport : acExport;
    expect((await post(request("POST", activity), ctx)).status === 201).toBe(person.write);
    expect(mocks.activityCreate).toHaveBeenCalledTimes(person.write ? 1 : 0);
    expect((await assignRoute(request("POST", assign), ctx)).status === 201).toBe(person.write);
    expect(mocks.assignmentCreate).toHaveBeenCalledTimes(person.write ? 1 : 0);

    const downloaded = await csv(request("GET"), ctx);
    expect(downloaded.status === 200).toBe(person.read);
    if (person.read) {
      expect(downloaded.headers.get("content-type")).toContain("text/csv");
      expect(mocks.writeAuditLog.mock.calls.map((call) => call[0].action)).toContain("EVENT_STAFFING_CSV_EXPORTED");
    } else {
      expect(mocks.writeAuditLog.mock.calls.map((call) => call[0].action)).not.toContain("EVENT_STAFFING_CSV_EXPORTED");
    }
  });

  it.each(who.filter((person) => !person.write))("$name cannot change, delete or remove either", async (person) => {
    signIn(person);
    const patch = person.staff ? staffActivityPatch : acActivityPatch;
    const remove = person.staff ? staffActivityDelete : acActivityDelete;
    const removePerson = person.staff ? staffAssignDelete : acAssignDelete;
    expect((await patch(request("PATCH", { id: "act-1", ...activity }), ctx)).status).toBeGreaterThanOrEqual(400);
    expect((await remove(request("DELETE", { id: "act-1" }), ctx)).status).toBeGreaterThanOrEqual(400);
    expect((await removePerson(request("DELETE", { id: "asg-1" }), ctx)).status).toBeGreaterThanOrEqual(400);
    expect(mocks.activityUpdate).not.toHaveBeenCalled();
    expect(mocks.activityDelete).not.toHaveBeenCalled();
    expect(mocks.assignmentDelete).not.toHaveBeenCalled();
  });

  it("answers anonymous staff calls 401 and anonymous coordinator calls 404", async () => {
    signIn(who.at(-1)!);
    expect((await staffActivityPost(request("POST", activity), ctx)).status).toBe(401);
    expect((await staffExport(request("GET"), ctx)).status).toBe(401);
    expect((await acActivityPost(request("POST", activity), ctx)).status).toBe(404);
    expect((await acExport(request("GET"), ctx)).status).toBe(404);
  });

  it("hides the sheet from everyone while the module is off, and for an event that is not a published club event for a coordinator", async () => {
    signIn(who[0]!);
    mocks.moduleFindUnique.mockResolvedValue(null);
    expect((await staffExport(request("GET"), ctx)).status).toBe(404);
    expect((await staffActivityPost(request("POST", activity), ctx)).status).toBe(404);
    signIn(who.find((person) => person.ac === "active")!);
    expect((await acExport(request("GET"), ctx)).status).toBe(404);
    expect((await acAssign(request("POST", assign), ctx)).status).toBe(404);
    mocks.moduleFindUnique.mockResolvedValue({ id: "on" });
    mocks.eventFindFirst.mockResolvedValue(null);
    expect((await acExport(request("GET"), ctx)).status).toBe(404);
    expect(mocks.eventFindFirst.mock.calls.at(-1)![0].where).toMatchObject({ audience: "CLUB", archivedAt: null, isPublished: true });
  });

  it("keeps the coordinator routes on the real coordinator check, never staff acting as one", () => {
    expect(requireAreaCoordinatorStaffingActor.toString()).toContain("currentAreaCoordinator");
  });
});

describe("only people on the event can be put on an activity (#1678)", () => {
  it("checks a person against this event's submitted or confirmed registrations, whatever the request says", async () => {
    signIn(who[1]!);
    expect((await staffAssign(request("POST", assign), ctx)).status).toBe(201);
    expect(mocks.attendeeFindFirst.mock.calls[0]![0].where).toEqual({ eventId: "event-1", personId: "person-1", registration: { eventId: "event-1", status: { in: ["SUBMITTED", "CONFIRMED"] } } });
  });

  it("refuses a person who is not registered for the event (or only waitlisted, drafted or cancelled)", async () => {
    signIn(who[1]!);
    mocks.attendeeFindFirst.mockResolvedValue(null);
    const answer = await staffAssign(request("POST", assign), ctx);
    expect(answer.status).toBe(422);
    expect((await answer.json()).error).toBe("NOT_ON_EVENT");
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("checks a staff user against this event's active staff, and refuses anyone else", async () => {
    signIn(who[1]!);
    const body = { ...assign, role: "HELPER", assignee: { kind: "user", id: "user-9" } };
    expect((await staffAssign(request("POST", body), ctx)).status).toBe(201);
    expect(mocks.membershipFindFirst.mock.calls[0]![0].where).toEqual({ eventId: "event-1", userId: "user-9", status: "ACTIVE" });
    mocks.membershipFindFirst.mockResolvedValue(null);
    expect((await staffAssign(request("POST", body), ctx)).status).toBe(422);
    expect(mocks.assignmentCreate).toHaveBeenCalledTimes(1);
  });

  it("holds for a coordinator too, and refuses to create anyone: no account, person or registration is ever written", async () => {
    signIn(who.find((person) => person.ac === "active")!);
    mocks.attendeeFindFirst.mockResolvedValue(null);
    expect((await acAssign(request("POST", assign), ctx)).status).toBe(422);
    expect((await acAssign(request("POST", { ...assign, assignee: { kind: "person", id: "p", firstName: "New", lastName: "Person" } }), ctx)).status).toBe(400);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it("refuses an activity of another event, a TLT in this slice, a person twice, and a bad request", async () => {
    signIn(who[1]!);
    mocks.activityFindFirst.mockResolvedValue(null);
    expect((await staffAssign(request("POST", assign), ctx)).status).toBe(404);
    expect(mocks.activityFindFirst.mock.calls[0]![0].where).toEqual({ id: "act-1", eventId: "event-1" });
    mocks.activityFindFirst.mockResolvedValue(activityRow);
    expect((await staffAssign(request("POST", { ...assign, role: "TLT" }), ctx)).status).toBe(400);
    mocks.activityFindFirst.mockResolvedValue({ ...activityRow, assignments: [{ id: "asg-0", role: "HELPER", personId: "person-1", userId: null, person: { firstName: "Sam", lastName: "Sample" }, user: null }] });
    expect((await staffAssign(request("POST", assign), ctx)).status).toBe(409);
    expect((await staffAssign(request("POST", { ...assign, extra: 1 }), ctx)).status).toBe(400);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it("a new lead replaces the old one in the same step", async () => {
    signIn(who[1]!);
    mocks.assignmentDeleteMany.mockResolvedValue({ count: 1 });
    await staffAssign(request("POST", assign), ctx);
    expect(mocks.assignmentDeleteMany).toHaveBeenCalledWith({ where: { activityId: "act-1", eventId: "event-1", role: "LEAD" } });
    expect(mocks.writeAuditLog.mock.calls[0]![0].metadata).toMatchObject({ role: "LEAD", replacedLead: true });
  });

  it("shows a person who has since cancelled as no longer on the event, so they count for nothing", async () => {
    mocks.activityFindMany.mockResolvedValue([{ ...activityRow, assignments: [
      { id: "asg-1", role: "LEAD", personId: "person-1", userId: null, person: { firstName: "Sam", lastName: "Sample" }, user: null },
      { id: "asg-2", role: "HELPER", personId: "person-2", userId: null, person: { firstName: "Pat", lastName: "Example" }, user: null },
    ] }]);
    mocks.attendeeFindMany.mockResolvedValue([{ personId: "person-1" }]);
    const [sheet] = await loadStaffingSheet("event-1");
    expect(sheet!.assignments.map((entry) => [entry.name, entry.active])).toEqual([["Sam Sample", true], ["Pat Example", false]]);
    expect(mocks.attendeeFindMany.mock.calls[0]![0].where).toMatchObject({ eventId: "event-1", registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } });
  });
});

describe("changes are audited with ids and counts only (#1678)", () => {
  it("audits add, change, delete, assign and unassign under the right actor, with no name or free text", async () => {
    signIn(who.find((person) => person.name === "Event Admin of the event")!);
    await staffActivityPost(request("POST", activity), ctx);
    await staffActivityPatch(request("PATCH", { id: "act-1", ...activity, lifeguardsNeeded: 6 }), ctx);
    await staffAssign(request("POST", assign), ctx);
    await staffAssignDelete(request("DELETE", { id: "asg-1" }), ctx);
    activityRow._count.assignments = 3;
    await staffActivityDelete(request("DELETE", { id: "act-1" }), ctx);
    expect(mocks.writeAuditLog.mock.calls.map((call) => call[0].action)).toEqual([
      "EVENT_STAFFING_ACTIVITY_ADDED", "EVENT_STAFFING_ACTIVITY_CHANGED", "EVENT_STAFFING_ASSIGNED", "EVENT_STAFFING_UNASSIGNED", "EVENT_STAFFING_ACTIVITY_DELETED",
    ]);
    for (const [entry] of mocks.writeAuditLog.mock.calls) {
      expect(entry).toMatchObject({ eventId: "event-1", actorUserId: "u" });
      const text = JSON.stringify(entry);
      for (const forbidden of ["Canoe", "Paddling", "Lake", "Friday", "Sample", "@"]) expect(text).not.toContain(forbidden);
    }
    expect(mocks.writeAuditLog.mock.calls[4]![0].metadata).toMatchObject({ activityId: "act-1", assignmentCount: 3 });
  });

  it("names a coordinator by account on the audit entry", async () => {
    signIn(who.find((person) => person.ac === "active")!);
    await acActivityPost(request("POST", activity), ctx);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry.actorUserId).toBeUndefined();
    expect(entry.metadata).toMatchObject({ actorAttendeeAccountId: "acct-ac", viaAreaCoordinator: true, lifeguardsNeeded: 4 });
  });

  it("audits the CSV download with counts, never names", async () => {
    signIn(who[1]!);
    mocks.activityFindMany.mockResolvedValue([{ ...activityRow, assignments: [{ id: "asg-1", role: "LEAD", personId: "person-1", userId: null, person: { firstName: "Sam", lastName: "Sample" }, user: null }] }]);
    mocks.attendeeFindMany.mockResolvedValue([{ personId: "person-1" }]);
    const answer = await staffExport(request("GET"), ctx);
    const body = await answer.text();
    expect(body).toContain("Sample, Sam");
    const entry = mocks.writeAuditLog.mock.calls.at(-1)![0];
    expect(entry).toMatchObject({ action: "EVENT_STAFFING_CSV_EXPORTED", metadata: { activityCount: 1, assignmentCount: 1, gapCount: 3 } });
    expect(JSON.stringify(entry)).not.toContain("Sample");
  });

  it("refuses a bad activity before anything is written, and stops at the cap", async () => {
    signIn(who[1]!);
    for (const bad of [{ ...activity, name: "" }, { ...activity, tltsNeeded: -1 }, { ...activity, lifeguardsNeeded: 1.5 }, { ...activity, phone: "(515) 555-0100" }]) {
      expect((await staffActivityPost(request("POST", bad), ctx)).status).toBe(400);
    }
    expect(mocks.activityCreate).not.toHaveBeenCalled();
    mocks.activityAggregate.mockResolvedValue({ _count: { _all: 100 }, _max: { position: 100 } });
    expect((await staffActivityPost(request("POST", activity), ctx)).status).toBe(422);
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it("treats an activity or assignment of another event as missing", async () => {
    signIn(who[1]!);
    mocks.activityFindFirst.mockResolvedValue(null);
    mocks.assignmentFindFirst.mockResolvedValue(null);
    expect((await staffActivityPatch(request("PATCH", { id: "act-elsewhere", ...activity }), ctx)).status).toBe(404);
    expect((await staffActivityDelete(request("DELETE", { id: "act-elsewhere" }), ctx)).status).toBe(404);
    expect((await staffAssignDelete(request("DELETE", { id: "asg-elsewhere" }), ctx)).status).toBe(404);
    expect(mocks.assignmentFindFirst.mock.calls[0]![0].where).toEqual({ id: "asg-elsewhere", eventId: "event-1" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
