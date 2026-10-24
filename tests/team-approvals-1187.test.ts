import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/communications/effective-delivery", async () => (await import("./support/effective-delivery-double")).effectiveDeliveryDouble);

/**
 * Team approvals keep their server rules (#1187): only the real coordinator, only
 * at their own event locations, only while their grant is active, only for flags
 * that are still active. A staff act-as, another location, a revoked grant, a
 * flag that no longer applies (a coach, a person who left or is not 18) are
 * refused, and a cancelled team is never listed. Only the list hides a
 * cancelled team: the decide path does not refuse it yet (see the todo below).
 * Synthetic ids only.
 */
const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  currentStaffActingContext: vi.fn(),
  grantFindUnique: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/communications/messaging-repository", () => ({ processQueuedMessageIdsAfterCommit: vi.fn() }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));

import { PUT as coordinatorPut } from "@/app/api/attendee/area-clubs/team-permissions/[permissionId]/route";
import { decideTeamPermission, listCoordinatorTeamPermissions, syncTeamMemberPermissions } from "@/modules/club-teams/permission-repository";

const request = (body: unknown) => new Request("https://events.imsda.test/api/x", { method: "PUT", headers: { "content-type": "application/json", origin: "https://events.imsda.test" }, body: JSON.stringify(body) });
const params = { params: Promise.resolve({ permissionId: "perm-a" }) };

const found = {
  id: "perm-a", eventId: "event-1", clubEventRegistrationId: "cer-1", status: "PENDING", ageOnAgeDate: 18, decidedAt: null,
  decidedByUser: null, decidedByAccount: null,
  attendee: { profileSnapshot: { firstName: "Sam", lastName: "Sample" } },
  clubEventRegistration: { registrationId: "reg-1", teamName: "Team A", organizationId: "club-1", organization: { name: "Test Pathfinders" }, registration: { location: { name: "North" }, event: { name: "Synthetic Bible Experience" } } },
};

function decideDatabase(first: unknown = found) {
  const tx = {
    clubDirectorGrant: { findFirst: vi.fn().mockResolvedValue(null) },
    clubTeamMemberPermission: {
      findFirst: vi.fn().mockResolvedValue(first),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...found, status: "GRANTED", decidedAt: new Date("2026-11-01T12:00:00Z"), decidedByAccount: { displayName: "Sample Coordinator" } }),
    },
  };
  const transaction = vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.getPrisma.mockReturnValue({ $transaction: transaction, areaCoordinatorGrant: { findUnique: mocks.grantFindUnique } });
  return { tx, transaction };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-1" }, via: "attendee", sessionId: "s1" });
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.currentStaffActingContext.mockResolvedValue(null);
  mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
});

describe("the real coordinator decides (#1187)", () => {
  it("records the decision scoped to the coordinator's own locations", async () => {
    const { tx } = decideDatabase();
    const response = await coordinatorPut(request({ decision: "GRANTED" }), params);
    expect(response.status).toBe(200);
    const where = tx.clubTeamMemberPermission.findFirst.mock.calls[0]![0].where;
    expect(where).toMatchObject({ id: "perm-a", active: true });
    expect(where.clubEventRegistration.registration.location.is.coordinatorAccountId).toBe("acct-1");
    expect(tx.clubTeamMemberPermission.update.mock.calls[0]![0].data).toMatchObject({ status: "GRANTED", decidedByAccountId: "acct-1", decidedByUserId: null });
  });
});

describe("a staff act-as cannot decide (#1187)", () => {
  it.each([
    ["acting as an Area Coordinator, no attendee account", { account: null, via: null, sessionId: null }],
    ["a staff session on an attendee account", { account: { id: "acct-1" }, via: "staff", sessionId: null }],
  ])("answers 404 and never reaches the decision for %s", async (_label, attendee) => {
    mocks.getCurrentAttendee.mockResolvedValue(attendee);
    mocks.currentStaffActingContext.mockResolvedValue({ userId: "staff-1", role: "AREA_COORDINATOR", actAsId: "act-1" });
    const { transaction, tx } = decideDatabase();
    const response = await coordinatorPut(request({ decision: "GRANTED" }), params);
    expect(response.status).toBe(404);
    expect(transaction).not.toHaveBeenCalled();
    expect(tx.clubTeamMemberPermission.update).not.toHaveBeenCalled();
  });
});

describe("a revoked or incomplete grant is refused (#1187)", () => {
  it.each([
    ["revoked", () => mocks.grantFindUnique.mockResolvedValue({ revokedAt: new Date("2026-01-01"), expiresAt: null })],
    ["expired", () => mocks.grantFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: new Date("2020-01-01") })],
    ["never granted", () => mocks.grantFindUnique.mockResolvedValue(null)],
    ["second step pending", () => mocks.accountNeedsSecondStep.mockResolvedValue("VERIFY")],
  ])("answers 404 for a %s grant and decides nothing", async (_label, arrange) => {
    arrange();
    const { transaction } = decideDatabase();
    expect((await coordinatorPut(request({ decision: "GRANTED" }), params)).status).toBe(404);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("also requires the location coordinator's own grant to be active at decision time, so a grant revoked since sign-in cannot decide", async () => {
    const { tx } = decideDatabase();
    await coordinatorPut(request({ decision: "DECLINED" }), params);
    const where = tx.clubTeamMemberPermission.findFirst.mock.calls[0]![0].where;
    const coordinator = where.clubEventRegistration.registration.location.is.coordinator.is;
    expect(coordinator).toMatchObject({ disabledAt: null });
    expect(coordinator.areaCoordinatorGrant.is).toMatchObject({ revokedAt: null });
    expect(coordinator.areaCoordinatorGrant.is.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
  });
});

describe("another location, or a flag that no longer applies, is denied (#1187)", () => {
  it("answers 404 when the request is not at one of the coordinator's locations, and touches nothing", async () => {
    const { tx } = decideDatabase(null);
    expect((await coordinatorPut(request({ decision: "GRANTED" }), params)).status).toBe(404);
    expect(tx.clubTeamMemberPermission.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("only decides active flags, so a person who became a coach, left the team or is not 18 can no longer be decided", async () => {
    const { tx } = decideDatabase(null);
    await expect(decideTeamPermission({ permissionId: "perm-a", decision: "GRANTED", actor: { accountId: "acct-1" }, scope: { coordinatorAccountId: "acct-1" } })).rejects.toMatchObject({ code: "REGISTRATION_NOT_FOUND" });
    expect(tx.clubTeamMemberPermission.findFirst.mock.calls[0]![0].where).toMatchObject({ active: true });
  });

  it("refuses a coordinator who directs the team's own club", async () => {
    const { tx } = decideDatabase();
    tx.clubDirectorGrant.findFirst.mockResolvedValue({ id: "grant-1" });
    await expect(decideTeamPermission({ permissionId: "perm-a", decision: "GRANTED", actor: { accountId: "acct-1" }, scope: { coordinatorAccountId: "acct-1" } })).rejects.toMatchObject({ code: "REGISTRATION_NOT_FOUND" });
    expect(tx.clubTeamMemberPermission.update).not.toHaveBeenCalled();
  });

  it("lists only active flags of live teams at the coordinator's own locations, never the own-club ones", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { ...found, id: "p-own", clubEventRegistration: { ...found.clubEventRegistration, organizationId: "club-own" } },
      { ...found, id: "p-other-club" },
    ]);
    const grantFindFirst = vi.fn(async ({ where }: { where: { organizationId: string } }) => (where.organizationId === "club-own" ? { id: "g" } : null));
    mocks.getPrisma.mockReturnValue({ clubTeamMemberPermission: { findMany }, clubDirectorGrant: { findFirst: grantFindFirst } });
    const rows = await listCoordinatorTeamPermissions("acct-1");
    const where = findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ active: true });
    // A cancelled team is not listed on this page. (The decide path does not filter by registration status: see the todo.)
    expect(where.clubEventRegistration.registration.status).toEqual({ in: ["SUBMITTED", "CONFIRMED", "WAITLISTED"] });
    expect(where.clubEventRegistration.registration.location.is.coordinatorAccountId).toBe("acct-1");
    expect(rows.map((row) => row.id)).toEqual(["p-other-club"]);
  });
});

describe("follow-up", () => {
  // Follow-up issue (opened by the coordinator of #1187): decideTeamPermission has no registration-status filter.
  it.todo("refuses a decision on a flag whose team registration is cancelled, as the list already hides it");
});

describe("the age rule still decides who needs approval (#1187)", () => {
  it("makes a flag only for a team member of 18 or older, never for a younger member, a coach or an unknown age", async () => {
    const tx = {
      clubTeamMemberPermission: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockImplementation(async () => ({ id: "perm-new" })), update: vi.fn(), delete: vi.fn() },
      registration: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const person = (attendeeId: string, age: number | null, role: "MEMBER" | "COACH") => ({ attendeeId, personId: `person-${attendeeId}`, name: `Person ${attendeeId}`, age, role });
    const result = await syncTeamMemberPermissions(tx as never, {
      eventId: "event-1", clubEventRegistrationId: "cer-1", registrationId: "reg-1", notifyApprovers: false,
      people: [person("a", 17, "MEMBER"), person("b", 30, "COACH"), person("c", null, "MEMBER"), person("d", 18, "MEMBER")],
    });
    expect(result.declined).toEqual([]);
    expect(tx.clubTeamMemberPermission.create).toHaveBeenCalledTimes(1);
    expect(tx.clubTeamMemberPermission.create.mock.calls[0]![0].data).toMatchObject({ registrationAttendeeId: "d", ageOnAgeDate: 18 });
  });
});
