import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentTltDirector: vi.fn(),
  accountIsTltDirector: vi.fn(),
  currentAreaCoordinator: vi.fn(),
  isAreaCoordinator: vi.fn(),
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  writeAuditLog: vi.fn(),
  eventFindFirst: vi.fn(),
  eventFindMany: vi.fn(),
  moduleFindUnique: vi.fn(),
  activityFindFirst: vi.fn(),
  activityFindMany: vi.fn(),
  assignmentFindFirst: vi.fn(),
  assignmentCreate: vi.fn(),
  assignmentDelete: vi.fn(),
  assignmentDeleteMany: vi.fn(),
  attendeeFindFirst: vi.fn(),
  attendeeFindMany: vi.fn(),
  membershipFindFirst: vi.fn(),
  membershipFindMany: vi.fn(),
  grantFindMany: vi.fn(),
  grantFindFirst: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  listTltDirectoryRows: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ currentAreaCoordinator: mocks.currentAreaCoordinator, isAreaCoordinator: mocks.isAreaCoordinator }));
vi.mock("@/modules/tlt-directory/access", () => ({ currentTltDirector: mocks.currentTltDirector, accountIsTltDirector: mocks.accountIsTltDirector }));
vi.mock("@/modules/tlt-directory/repository", () => ({ listTltDirectoryRows: mocks.listTltDirectoryRows }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    eventStaffingActivity: { findFirst: mocks.activityFindFirst, findMany: mocks.activityFindMany },
    eventStaffingAssignment: { findFirst: mocks.assignmentFindFirst, create: mocks.assignmentCreate, delete: mocks.assignmentDelete, deleteMany: mocks.assignmentDeleteMany },
    registrationAttendee: { findFirst: mocks.attendeeFindFirst, findMany: mocks.attendeeFindMany },
    eventMembership: { findFirst: mocks.membershipFindFirst, findMany: mocks.membershipFindMany },
    areaCoordinatorGrant: { findMany: mocks.grantFindMany, findFirst: mocks.grantFindFirst },
    clubRosterMember: { findFirst: mocks.rosterFindFirst, findMany: mocks.rosterFindMany },
  };
  return {
    getPrisma: () => ({
      ...tx,
      event: { findFirst: mocks.eventFindFirst, findMany: mocks.eventFindMany },
      eventModule: { findUnique: mocks.moduleFindUnique },
      $transaction: async (run: (client: unknown) => unknown) => run({ ...tx }),
    }),
  };
});

import { DELETE as tltDelete, POST as tltPost } from "@/app/api/attendee/area-clubs/tlt-staffing/[eventId]/assignments/route";
import { DELETE as acAssignDelete, POST as acAssign } from "@/app/api/attendee/area-clubs/events/[eventId]/staffing/assignments/route";
import { DELETE as staffAssignDelete, POST as staffAssign } from "@/app/api/events/[eventId]/staffing/assignments/route";
import { POST as staffActivityPost } from "@/app/api/events/[eventId]/staffing/activities/route";
import { assertStaffingAccess, requireTltDirectorStaffingActor, type StaffingActor } from "@/modules/event-staffing/access";
import { summarizeStaffing } from "@/modules/event-staffing/domain";
import { addAssignment, addTltAssignment, createActivity, loadStaffingSheet, removeAssignment } from "@/modules/event-staffing/repository";
import { listEventTlts, listTltStaffingEvents, tltCounts } from "@/modules/event-staffing/tlt-director";

/**
 * The TLT director assigns TLTs to staffing activities (#1678, part 2). She reads the sheet and adds or removes TLT rows and
 * nothing else; everyone else is refused her routes; only a registered, current TLT can be assigned.
 */

const ctx = { params: Promise.resolve({ eventId: "event-1" }) };
const request = (method: string, body?: unknown) => new Request("https://events.imsda.test/api/x", { method, headers: { origin: "https://events.imsda.test", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const tltBody = { activityId: "act-1", role: "TLT", assignee: { kind: "person", id: "person-tlt" } };
const activityRow = { id: "act-1", name: "Canoe", description: "", location: "Lake", timeText: "Friday", tltsNeeded: 2, lifeguardsNeeded: 0, helpersNeeded: 0, assignments: [] as unknown[] };
const director: StaffingActor = { kind: "tlt-director", accountId: "acct-tlt", canWrite: false };
const sam = { firstName: "Sam", lastName: "Sample" };

const personas = {
  "an ordinary Area Coordinator (director setting off)": "ac",
  "an Area Coordinator who leads an activity on the event": "ac",
  "an Area Coordinator without the second sign-in step": "ac",
  "an Area Coordinator whose grant ended": "ac",
  "an Event Admin of the event": "staff",
  "the Clubs Administrator": "staff",
  "a system administrator": "staff",
  "a club director": "attendee",
  "staff acting as a coordinator": "act-as",
  "an attendee, assigned or not": "attendee",
  "nobody signed in": "anonymous",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentTltDirector.mockResolvedValue({ accountId: "acct-tlt" });
  mocks.accountIsTltDirector.mockResolvedValue(true);
  mocks.eventFindFirst.mockResolvedValue({ id: "event-1", name: "Sample Spring Camporee" });
  mocks.eventFindMany.mockResolvedValue([]);
  mocks.moduleFindUnique.mockResolvedValue({ id: "on" });
  mocks.activityFindFirst.mockResolvedValue(activityRow);
  mocks.activityFindMany.mockResolvedValue([]);
  mocks.assignmentFindFirst.mockResolvedValue({ id: "asg-1", activityId: "act-1", role: "TLT", personId: "person-tlt", userId: null, attendeeAccountId: null });
  mocks.assignmentCreate.mockResolvedValue({ id: "asg-1" });
  mocks.assignmentDelete.mockResolvedValue({});
  mocks.attendeeFindFirst.mockResolvedValue({ id: "ra-1" });
  mocks.attendeeFindMany.mockResolvedValue([]);
  mocks.membershipFindFirst.mockResolvedValue({ id: "m-1" });
  mocks.membershipFindMany.mockResolvedValue([]);
  mocks.grantFindMany.mockResolvedValue([]);
  mocks.grantFindFirst.mockResolvedValue({ id: "grant-1" });
  mocks.rosterFindFirst.mockResolvedValue({ id: "roster-1" });
  mocks.rosterFindMany.mockResolvedValue([]);
  mocks.isAreaCoordinator.mockResolvedValue(true);
  mocks.listTltDirectoryRows.mockResolvedValue([]);
});

describe("who may use the TLT director's staffing routes", () => {
  it("lets the TLT director add a TLT and audits ids and the role only", async () => {
    const answer = await tltPost(request("POST", tltBody), ctx);
    expect(answer.status).toBe(201);
    expect(mocks.assignmentCreate.mock.calls[0]![0].data).toEqual({ eventId: "event-1", activityId: "act-1", role: "TLT", personId: "person-tlt" });
    const audit = mocks.writeAuditLog.mock.calls[0]![0];
    expect(audit.action).toBe("EVENT_STAFFING_ASSIGNED");
    expect(audit.metadata).toMatchObject({ actorAttendeeAccountId: "acct-tlt", viaTltDirector: true, role: "TLT", assigneeKind: "person", assigneeId: "person-tlt", activityId: "act-1" });
    expect(audit).not.toHaveProperty("actorUserId");
  });

  it.each(Object.keys(personas))("answers %s with 404 and changes nothing", async () => {
    mocks.currentTltDirector.mockResolvedValue(null);
    expect((await tltPost(request("POST", tltBody), ctx)).status).toBe(404);
    expect((await tltDelete(request("DELETE", { id: "asg-1" }), ctx)).status).toBe(404);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
    expect(mocks.assignmentDelete).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("stops a director whose setting was switched off after the route's check, by re-reading it in the service", async () => {
    mocks.accountIsTltDirector.mockResolvedValue(false);
    expect((await tltPost(request("POST", tltBody), ctx)).status).toBe(404);
    expect((await tltDelete(request("DELETE", { id: "asg-1" }), ctx)).status).toBe(404);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it("is the real TLT director check, never an Area Coordinator check or staff acting as a coordinator", () => {
    expect(requireTltDirectorStaffingActor.toString()).toContain("currentTltDirector");
    expect(requireTltDirectorStaffingActor.toString()).not.toContain("currentAreaCoordinator");
  });

  it("hides an event with the module off, and one that is not a published club event", async () => {
    mocks.moduleFindUnique.mockResolvedValue(null);
    expect((await tltPost(request("POST", tltBody), ctx)).status).toBe(404);
    mocks.moduleFindUnique.mockResolvedValue({ id: "on" });
    mocks.eventFindFirst.mockResolvedValue(null);
    expect((await tltPost(request("POST", tltBody), ctx)).status).toBe(404);
    expect(mocks.eventFindFirst.mock.calls.at(-1)![0].where).toMatchObject({ audience: "CLUB", archivedAt: null, isPublished: true });
  });
});

describe("only a registered, current TLT can be assigned", () => {
  it("refuses a person with no active registration on this event (none, draft, waitlisted or cancelled)", async () => {
    mocks.attendeeFindFirst.mockResolvedValue(null);
    const answer = await tltPost(request("POST", tltBody), ctx);
    expect(answer.status).toBe(422);
    expect((await answer.json()).error).toBe("NOT_ON_EVENT");
    expect(mocks.attendeeFindFirst.mock.calls[0]![0].where).toEqual({ eventId: "event-1", personId: "person-tlt", registration: { eventId: "event-1", status: { in: ["SUBMITTED", "CONFIRMED"] } } });
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it("refuses a registered person who is not a current TLT, and checks the roster with the directory's own test", async () => {
    mocks.rosterFindFirst.mockResolvedValue(null);
    const answer = await tltPost(request("POST", tltBody), ctx);
    expect(answer.status).toBe(422);
    expect((await answer.json()).error).toBe("NOT_ON_EVENT");
    expect(mocks.rosterFindFirst.mock.calls[0]![0].where).toMatchObject({ personId: "person-tlt", attendeeType: "YOUTH", isTlt: true, status: "ACTIVE", organization: { type: "CLUB", isActive: true } });
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a TLT already on the activity", async () => {
    mocks.activityFindFirst.mockResolvedValue({ ...activityRow, assignments: [{ id: "asg-0", role: "HELPER", personId: "person-tlt", userId: null, attendeeAccountId: null, person: sam, user: null, attendeeAccount: null }] });
    const answer = await tltPost(request("POST", tltBody), ctx);
    expect(answer.status).toBe(409);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it("refuses an activity of another event", async () => {
    mocks.activityFindFirst.mockResolvedValue(null);
    expect((await tltPost(request("POST", tltBody), ctx)).status).toBe(404);
    expect(mocks.activityFindFirst.mock.calls[0]![0].where).toEqual({ id: "act-1", eventId: "event-1" });
  });

  it("refuses any role but TLT, and any assignee but a person, from her", async () => {
    for (const role of ["LEAD", "HELPER", "LIFEGUARD"]) expect((await tltPost(request("POST", { ...tltBody, role }), ctx)).status).toBe(400);
    for (const kind of ["user", "account"]) expect((await tltPost(request("POST", { ...tltBody, assignee: { kind, id: "x" } }), ctx)).status).toBe(400);
    expect((await tltPost(request("POST", { ...tltBody, extra: 1 }), ctx)).status).toBe(400);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it("refuses role TLT from an ordinary editor on both editor routes, and at the service", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", email: "u@example.org", displayName: "U", globalRole: "SYSTEM_ADMIN" } });
    mocks.findActiveMembership.mockResolvedValue(null);
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    const forged = { ...tltBody };
    expect((await staffAssign(request("POST", forged), ctx)).status).toBe(400);
    expect((await acAssign(request("POST", forged), ctx)).status).toBe(400);
    const editor: StaffingActor = { kind: "area-coordinator", accountId: "acct-ac", canWrite: true };
    await expect(addAssignment(editor, "event-1", { activityId: "act-1", role: "TLT" as never, assignee: { kind: "person", id: "person-tlt" } })).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await expect(addTltAssignment(editor, "event-1", tltBody as never)).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await expect(addTltAssignment({ kind: "staff", userId: "u", canWrite: true }, "event-1", tltBody as never)).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });
});

describe("what she cannot change", () => {
  it("cannot change activities, leads, helpers, lifeguards or the sheet", async () => {
    await expect(createActivity(director, "event-1", { name: "Surprise", description: "", location: "", timeText: "", tltsNeeded: 1, lifeguardsNeeded: 0, helpersNeeded: 0 })).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    for (const role of ["LEAD", "HELPER", "LIFEGUARD"] as const) {
      await expect(addAssignment(director, "event-1", { activityId: "act-1", role, assignee: { kind: "person", id: "person-tlt" } })).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    }
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it("can read the sheet but not use the staff or coordinator routes", async () => {
    await expect(assertStaffingAccess(director, "event-1", "read")).resolves.toMatchObject({ id: "event-1" });
    await expect(assertStaffingAccess(director, "event-1", "write")).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    mocks.currentAreaCoordinator.mockResolvedValue(null);
    expect((await staffActivityPost(request("POST", { name: "x" }), ctx)).status).toBe(401);
  });
});

describe("removing a TLT", () => {
  it("lets her take a TLT off, audited by ids", async () => {
    const answer = await tltDelete(request("DELETE", { id: "asg-1" }), ctx);
    expect(answer.status).toBe(200);
    expect(mocks.assignmentDelete).toHaveBeenCalledWith({ where: { id: "asg-1" } });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "EVENT_STAFFING_UNASSIGNED", metadata: { role: "TLT", assigneeId: "person-tlt", viaTltDirector: true } });
  });

  it("refuses her taking off a lead, helper or lifeguard", async () => {
    for (const role of ["LEAD", "HELPER", "LIFEGUARD"]) {
      mocks.assignmentFindFirst.mockResolvedValue({ id: "asg-2", activityId: "act-1", role, personId: "person-1", userId: null, attendeeAccountId: null });
      expect((await tltDelete(request("DELETE", { id: "asg-2" }), ctx)).status).toBe(403);
    }
    expect(mocks.assignmentDelete).not.toHaveBeenCalled();
  });

  it("lets the event's editors take a TLT off, and leaves read-only staff unable to", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u", email: "u@example.org", displayName: "U", globalRole: null } });
    mocks.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "u", role: "EVENT_ADMIN", status: "ACTIVE", permissions: [] });
    expect((await staffAssignDelete(request("DELETE", { id: "asg-1" }), ctx)).status).toBe(200);
    mocks.currentAreaCoordinator.mockResolvedValue({ id: "acct-ac" });
    expect((await acAssignDelete(request("DELETE", { id: "asg-1" }), ctx)).status).toBe(200);
    expect(mocks.assignmentDelete).toHaveBeenCalledTimes(2);
    mocks.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "u", role: "READ_ONLY_STAFF", status: "ACTIVE", permissions: [] });
    expect((await staffAssignDelete(request("DELETE", { id: "asg-1" }), ctx)).status).toBeGreaterThanOrEqual(400);
    expect(mocks.assignmentDelete).toHaveBeenCalledTimes(2);
  });

  it("answers a missing or other-event assignment with 404", async () => {
    mocks.assignmentFindFirst.mockResolvedValue(null);
    expect((await tltDelete(request("DELETE", { id: "asg-9" }), ctx)).status).toBe(404);
    expect(mocks.assignmentFindFirst.mock.calls[0]![0].where).toEqual({ id: "asg-9", eventId: "event-1" });
  });
});

describe("gaps and counts", () => {
  const tltRow = (id: string, personId: string, name: { firstName: string; lastName: string }) => ({ id, role: "TLT", personId, userId: null, attendeeAccountId: null, person: name, user: null, attendeeAccount: null });

  it("counts TLTs still registered and still current, and leaves out a cancelled one and one who stopped being a TLT", async () => {
    mocks.activityFindMany.mockResolvedValue([{ ...activityRow, tltsNeeded: 3, assignments: [
      tltRow("a1", "p1", sam),
      tltRow("a2", "p2", { firstName: "Pat", lastName: "Example" }),
      tltRow("a3", "p3", { firstName: "Alex", lastName: "Sample" }),
    ] }]);
    mocks.attendeeFindMany.mockResolvedValue([{ personId: "p1" }, { personId: "p3" }]);
    mocks.rosterFindMany.mockResolvedValue([{ personId: "p1" }, { personId: "p2" }]);
    const sheet = await loadStaffingSheet("event-1");
    expect(sheet[0]!.assignments.map((entry) => [entry.name, entry.role, entry.active])).toEqual([["Pat Example", "TLT", false], ["Alex Sample", "TLT", false], ["Sam Sample", "TLT", true]]);
    expect(tltCounts(sheet)).toEqual({ needed: 3, assigned: 1 });
    expect(summarizeStaffing(sheet).gaps.map((gap) => gap.text)).toEqual(["Canoe: no lead", "Canoe: 1 of 3 TLTs"]);
  });

  it("lists events with the sheet on, with TLTs needed against assigned", async () => {
    mocks.eventFindMany.mockResolvedValue([{ id: "event-1", name: "Sample Spring Camporee", startsAt: new Date("2027-04-23T15:00:00.000Z"), timezone: "America/Chicago" }]);
    mocks.activityFindMany.mockResolvedValue([{ ...activityRow, tltsNeeded: 2, assignments: [tltRow("a1", "p1", sam)] }]);
    mocks.attendeeFindMany.mockResolvedValue([{ personId: "p1" }]);
    mocks.rosterFindMany.mockResolvedValue([{ personId: "p1" }]);
    const [row] = await listTltStaffingEvents();
    expect(row).toMatchObject({ id: "event-1", activityCount: 1, tltsNeeded: 2, tltsAssigned: 1 });
    expect(mocks.eventFindMany.mock.calls[0]![0].where).toMatchObject({ archivedAt: null, isPublished: true, audience: "CLUB", modules: { some: { moduleKey: "event-staffing" } } });
  });
});

describe("the picker of registered TLTs", () => {
  const directoryRow = (personId: string, name: string) => ({
    personId, rosterMemberId: `r-${personId}`, name, clubId: "club-1", clubName: "Sample Pathfinder Club", church: "", age: 15, reportedAge: null, grade: "9th",
    tltYear: 2, positionTypeId: null, positionName: null, status: "ACTIVE", tags: [{ id: "tag-1", name: "Canoeing" }], suggestedTags: [], shirt: { needed: true, type: "Polo", size: "Adult M" },
  });

  it("lists only current TLTs with an active registration on this event, with year, club and tags and nothing else", async () => {
    mocks.listTltDirectoryRows.mockResolvedValue([directoryRow("p2", "Pat Example"), directoryRow("p1", "Sam Sample"), directoryRow("p3", "Not Registered")]);
    mocks.attendeeFindMany.mockResolvedValue([{ personId: "p1" }, { personId: "p2" }]);
    const options = await listEventTlts("event-1");
    expect(options.map((option) => option.name)).toEqual(["Pat Example", "Sam Sample"]);
    expect(Object.keys(options[0]!).sort()).toEqual(["clubId", "clubName", "name", "personId", "tags", "tltYear"]);
    expect(mocks.attendeeFindMany.mock.calls[0]![0].where).toEqual({ eventId: "event-1", personId: { in: ["p2", "p1", "p3"] }, registration: { eventId: "event-1", status: { in: ["SUBMITTED", "CONFIRMED"] } } });
  });
});

describe("the audit log holds no names", () => {
  it("writes ids, roles and counts for adding and removing a TLT, never a name", async () => {
    mocks.activityFindFirst.mockResolvedValue({ ...activityRow, assignments: [{ id: "asg-1", role: "TLT", personId: "person-tlt", userId: null, attendeeAccountId: null, person: sam, user: null, attendeeAccount: null }] });
    await removeAssignment(director, "event-1", "asg-1");
    mocks.activityFindFirst.mockResolvedValue({ ...activityRow, assignments: [] });
    await addTltAssignment(director, "event-1", { activityId: "act-1", role: "TLT", assignee: { kind: "person", id: "person-tlt" } });
    const written = JSON.stringify(mocks.writeAuditLog.mock.calls);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(2);
    expect(written).not.toMatch(/Sam|Sample|Canoe|Lake/);
  });
});
