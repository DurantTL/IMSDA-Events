import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assignmentFindMany: vi.fn(),
  attendeeFindMany: vi.fn(),
  membershipFindMany: vi.fn(),
  grantFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    eventStaffingAssignment: { findMany: mocks.assignmentFindMany },
    registrationAttendee: { findMany: mocks.attendeeFindMany },
    eventMembership: { findMany: mocks.membershipFindMany },
    areaCoordinatorGrant: { findFirst: mocks.grantFindFirst },
    clubRosterMember: { findMany: mocks.rosterFindMany },
  }),
}));

import { listOwnAssignments } from "@/modules/event-staffing/own-assignments";

/**
 * What one signed-in account sees of the staffing sheet (#1678): its own assignments, and nothing about anybody else. The rows
 * the database returns are shaped by the query's own filter, so these check the filter, then what is done with the rows.
 */

const row = (over: Record<string, unknown> = {}) => ({
  id: "asg-1", eventId: "event-1", role: "LIFEGUARD", personId: "person-1", userId: null,
  event: { name: "Sample Spring Camporee" },
  activity: { name: "Canoe", location: "Lake", timeText: "Friday 2 p.m.", description: "Paddling" },
  ...over,
});
const sam = { id: "acct-sam", verifiedEmail: "Sam.Sample@Example.test " };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assignmentFindMany.mockResolvedValue([row()]);
  mocks.attendeeFindMany.mockResolvedValue([{ eventId: "event-1", personId: "person-1" }]);
  mocks.membershipFindMany.mockResolvedValue([]);
  mocks.grantFindFirst.mockResolvedValue({ id: "grant-1" });
  mocks.rosterFindMany.mockResolvedValue([{ personId: "person-1" }]);
});

describe("an assigned person sees their own assignment (#1678)", () => {
  it("finds assignments by the account's own verified email, its recorded person link, or its linked staff user, and nothing else", async () => {
    await listOwnAssignments(sam);
    const where = mocks.assignmentFindMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { person: { normalizedEmail: "sam.sample@example.test" } },
      { person: { attendeeAccountLinks: { some: { accountId: "acct-sam" } } } },
      { user: { attendeeAccountId: "acct-sam" } },
      { attendeeAccountId: "acct-sam" },
    ]);
    // Never by name, and never with a way to widen it to another person.
    expect(JSON.stringify(where)).not.toMatch(/firstName|lastName|displayName/);
  });

  it("shows the activity, the role, the time and the place, and no other person's name or any count", async () => {
    const [own] = await listOwnAssignments(sam);
    expect(own).toEqual({ id: "asg-1", eventName: "Sample Spring Camporee", activityName: "Canoe", roleLabel: "Lifeguard", role: "LIFEGUARD", location: "Lake", timeText: "Friday 2 p.m.", description: "Paddling" });
    expect(Object.keys(own!).sort()).toEqual(["activityName", "description", "eventName", "id", "location", "role", "roleLabel", "timeText"]);
    const select = mocks.assignmentFindMany.mock.calls[0]![0].select;
    expect(select).not.toHaveProperty("person");
    expect(select).not.toHaveProperty("user");
    expect(JSON.stringify(select.activity)).not.toContain("assignments");
  });

  it("shows a TLT their own TLT assignment while they are registered and still a current TLT", async () => {
    mocks.assignmentFindMany.mockResolvedValue([row({ id: "asg-tlt", role: "TLT" })]);
    expect(await listOwnAssignments(sam)).toEqual([expect.objectContaining({ id: "asg-tlt", role: "TLT", roleLabel: "TLT", activityName: "Canoe" })]);
    expect(mocks.rosterFindMany.mock.calls[0]![0].where).toMatchObject({ personId: { in: ["person-1"] }, attendeeType: "YOUTH", isTlt: true, status: "ACTIVE" });
    mocks.attendeeFindMany.mockResolvedValue([]);
    expect(await listOwnAssignments(sam)).toEqual([]);
  });

  it("hides a TLT job once the person is no longer a current TLT, but keeps a lifeguard job for a registered person", async () => {
    mocks.assignmentFindMany.mockResolvedValue([row({ id: "asg-tlt", role: "TLT" }), row({ id: "asg-lg", role: "LIFEGUARD" })]);
    mocks.rosterFindMany.mockResolvedValue([]);
    expect((await listOwnAssignments(sam)).map((own) => own.id)).toEqual(["asg-lg"]);
  });

  it("shows nothing for an account with no assignment, such as an unassigned attendee or a club director", async () => {
    mocks.assignmentFindMany.mockResolvedValue([]);
    expect(await listOwnAssignments({ id: "acct-other", verifiedEmail: "someone.else@example.test" })).toEqual([]);
    expect(mocks.attendeeFindMany).not.toHaveBeenCalled();
  });

  it("only looks at published, unarchived club events with Event staffing on", async () => {
    await listOwnAssignments(sam);
    expect(mocks.assignmentFindMany.mock.calls[0]![0].where.event).toEqual({ archivedAt: null, isPublished: true, audience: "CLUB", modules: { some: { moduleKey: "event-staffing" } } });
  });

  it("drops an assignment once the person is no longer registered (cancelled, waitlisted) or no longer on the staff", async () => {
    mocks.attendeeFindMany.mockResolvedValue([]);
    expect(await listOwnAssignments(sam)).toEqual([]);
    expect(mocks.attendeeFindMany.mock.calls[0]![0].where).toEqual({ registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } }, OR: [{ eventId: "event-1", personId: "person-1" }] });
    mocks.assignmentFindMany.mockResolvedValue([row({ id: "asg-2", personId: null, userId: "user-1", role: "LEAD" })]);
    expect(await listOwnAssignments(sam)).toEqual([]);
    mocks.membershipFindMany.mockResolvedValue([{ eventId: "event-1", userId: "user-1" }]);
    expect((await listOwnAssignments(sam)).map((own) => own.roleLabel)).toEqual(["Lead"]);
    expect(mocks.membershipFindMany.mock.calls.at(-1)![0].where).toMatchObject({ status: "ACTIVE" });
  });

  it("shows an Area Coordinator their own lead job by account id, only while their grant is active", async () => {
    mocks.assignmentFindMany.mockResolvedValue([row({ id: "asg-3", personId: null, attendeeAccountId: "acct-sam", role: "LEAD" })]);
    expect((await listOwnAssignments(sam)).map((own) => own.roleLabel)).toEqual(["Lead"]);
    expect(mocks.grantFindFirst.mock.calls[0]![0].where).toMatchObject({ attendeeAccountId: "acct-sam", revokedAt: null, attendeeAccount: { status: "ACTIVE" } });
    mocks.grantFindFirst.mockResolvedValue(null);
    expect(await listOwnAssignments(sam)).toEqual([]);
  });

  it("asks for nothing when the account has no email on record", async () => {
    await listOwnAssignments({ id: "acct-x", verifiedEmail: "  " });
    expect(mocks.assignmentFindMany.mock.calls[0]![0].where.OR).toHaveLength(3);
  });
});
