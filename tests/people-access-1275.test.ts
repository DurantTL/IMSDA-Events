import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1275 (decision A): who may change an Area Coordinator, and who may not do anything else on an account. The real
 * gates run (`requireClubsAdministration`, `requireSystemAdministrator`, `requirePermission`); the session, the grant
 * lookups and the data behind each route are faked. Synthetic data only.
 *
 * Refusals for the other routes the person page uses are proven where they already live: global-role
 * (tests/global-role-route.test.ts), clubs-administrator (tests/clubs-administrator-grant-1225.test.ts), health-access
 * (tests/coordinator-health-grants.test.ts), invoice-finalization-access (tests/invoices-routes.test.ts), director
 * grants (tests/club-director-routes.test.ts, tests/clubs-administrator-actions-1232.test.ts) and the staff account
 * actions route (tests/clubs-administrator-permissions-1225.test.ts). This file adds the rest.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
  userFindUnique: vi.fn(),
  clubsGrantFindFirst: vi.fn(),
  accountFindUnique: vi.fn(),
  areaUpsert: vi.fn(),
  areaUpdateMany: vi.fn(),
  writeAuditLog: vi.fn(),
  resetAttendeeTwoStep: vi.fn(),
  signOutAttendeeEverywhere: vi.fn(),
  changeAttendeeEmail: vi.fn(),
  sendAttendeeVerificationByAdmin: vi.fn(),
  linkStaffAndAttendeeByHand: vi.fn(),
  unlinkStaffAndAttendee: vi.fn(),
  findActiveMembership: vi.fn(),
  addStaffMembership: vi.fn(),
  updateStaffMembership: vi.fn(),
  setAccountDisabled: vi.fn(),
  updateTeamProfile: vi.fn(),
}));

const client = {
  user: { findUnique: mocks.userFindUnique },
  clubsAdministratorGrant: { findFirst: mocks.clubsGrantFindFirst },
  attendeeAccount: { findUnique: mocks.accountFindUnique },
  areaCoordinatorGrant: { upsert: mocks.areaUpsert, updateMany: mocks.areaUpdateMany },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: vi.fn() }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: vi.fn(), StaffActAsError: class StaffActAsError extends Error {} }));
vi.mock("@/modules/system-admin/user-admin", () => ({
  UserAdminError: class UserAdminError extends Error {},
  resetAttendeeTwoStep: mocks.resetAttendeeTwoStep,
  signOutAttendeeEverywhere: mocks.signOutAttendeeEverywhere,
  changeAttendeeEmail: mocks.changeAttendeeEmail,
  sendAttendeeVerificationByAdmin: mocks.sendAttendeeVerificationByAdmin,
}));
vi.mock("@/modules/account-merge/hand-link", () => ({
  HandLinkError: class HandLinkError extends Error {},
  findStaffUserIdByEmail: vi.fn(async () => "staff-1"),
  linkStaffAndAttendeeByHand: mocks.linkStaffAndAttendeeByHand,
  unlinkStaffAndAttendee: mocks.unlinkStaffAndAttendee,
}));
vi.mock("@/modules/attendee-accounts/attendee-email-dispatch", () => ({ deliverQueuedAttendeeEmail: vi.fn() }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/access/membership-repository", () => ({
  MembershipOperationError: class MembershipOperationError extends Error {},
  addStaffMembership: mocks.addStaffMembership,
  updateStaffMembership: mocks.updateStaffMembership,
  listStaffMemberships: vi.fn(),
}));
vi.mock("@/modules/access/auth-service", () => ({ issueAccountToken: vi.fn() }));
vi.mock("@/modules/communications/account-email-dispatch", () => ({ sendStaffInvitationEmail: vi.fn(async () => ({ configured: true, queued: true })) }));
vi.mock("@/modules/system-admin/account-status", () => ({
  AccountStatusError: class AccountStatusError extends Error {},
  setAccountDisabled: mocks.setAccountDisabled,
}));
vi.mock("@/modules/system-admin/team-profile", async (importOriginal) => ({ ...(await importOriginal<object>()), updateTeamProfile: mocks.updateTeamProfile }));
vi.mock("@/modules/system-admin/team-directory", () => ({ getTeamDirectory: vi.fn(async () => ({ members: [] })) }));

import { POST as accountAction } from "@/app/api/admin/accounts/[accountId]/route";
import { POST as addMembership } from "@/app/api/events/[eventId]/memberships/route";
import { PATCH as updateMembership } from "@/app/api/events/[eventId]/memberships/[membershipId]/route";
import { PATCH as updateUser } from "@/app/api/admin/users/[userId]/route";
import { setAreaCoordinator } from "@/modules/organizations/area-coordinators";

type Viewer = "systemAdmin" | "clubsAdmin" | "revokedClubsAdmin" | "eventAdmin" | "areaCoordinator";

const users: Record<Exclude<Viewer, "areaCoordinator">, { id: string; globalRole: "SYSTEM_ADMIN" | null }> = {
  systemAdmin: { id: "u-sys", globalRole: "SYSTEM_ADMIN" },
  clubsAdmin: { id: "u-clubs", globalRole: null },
  revokedClubsAdmin: { id: "u-revoked", globalRole: null },
  eventAdmin: { id: "u-event", globalRole: null },
};

/** Signs in as a role. An Area Coordinator holds an attendee session only, so there is no staff user at all. */
function signInAs(viewer: Viewer) {
  if (viewer === "areaCoordinator") {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-ac" }, via: "attendee", sessionId: "s1" });
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.clubsGrantFindFirst.mockResolvedValue(null);
    return;
  }
  const user = { ...users[viewer], email: `${viewer}@imsda-events.test`, displayName: viewer };
  mocks.getCurrentSession.mockResolvedValue({ user });
  mocks.userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === user.id ? { globalRole: user.globalRole } : null));
  mocks.clubsGrantFindFirst.mockImplementation(async ({ where }: { where: { userId: string; revokedAt: null } }) => (
    viewer === "clubsAdmin" && where.userId === user.id && where.revokedAt === null ? { id: "grant-1" } : null
  ));
  // An Event Admin of one event only: no membership on the event the request names, no other grants.
  mocks.findActiveMembership.mockResolvedValue(viewer === "eventAdmin" ? { role: "EVENT_ADMIN", permissions: [], status: "ACTIVE" } : null);
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const json = (url: string, method: string, body?: unknown) => new Request(`https://events.imsda.test${url}`, {
  method,
  headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const accountCall = (body: unknown) => accountAction(json("/api/admin/accounts/acct-1", "POST", body), ctx({ accountId: "acct-1" }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountFindUnique.mockResolvedValue({ id: "acct-1" });
  mocks.resetAttendeeTwoStep.mockResolvedValue(undefined);
  mocks.signOutAttendeeEverywhere.mockResolvedValue(undefined);
  mocks.changeAttendeeEmail.mockResolvedValue(undefined);
  mocks.sendAttendeeVerificationByAdmin.mockResolvedValue({ messageId: null });
  mocks.linkStaffAndAttendeeByHand.mockResolvedValue(undefined);
  mocks.unlinkStaffAndAttendee.mockResolvedValue(undefined);
  mocks.addStaffMembership.mockResolvedValue({ membership: { user: { id: "u-new" } }, credentialCreated: false });
  mocks.updateStaffMembership.mockResolvedValue({ id: "m-1" });
});

describe("the Area Coordinator gate (decision A)", () => {
  const grantBody = { action: "area-coordinator", on: true };

  it("admits a system administrator and an active Clubs Administrator at the route", async () => {
    for (const viewer of ["systemAdmin", "clubsAdmin"] as const) {
      signInAs(viewer);
      mocks.areaUpsert.mockClear();
      expect((await accountCall(grantBody)).status, viewer).toBe(200);
      expect(mocks.areaUpsert, viewer).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses an Event Admin, a revoked Clubs Administrator and an Area Coordinator at the route, changing nothing", async () => {
    for (const viewer of ["eventAdmin", "revokedClubsAdmin"] as const) {
      signInAs(viewer);
      expect((await accountCall(grantBody)).status, viewer).toBe(403);
    }
    signInAs("areaCoordinator");
    expect((await accountCall(grantBody)).status).toBe(401);
    expect(mocks.areaUpsert).not.toHaveBeenCalled();
    expect(mocks.areaUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("applies the same check inside setAreaCoordinator, read from the database by actor id", async () => {
    signInAs("clubsAdmin");
    await expect(setAreaCoordinator("acct-1", true, "u-clubs")).resolves.toBeUndefined();
    await expect(setAreaCoordinator("acct-1", true, "u-event")).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
    await expect(setAreaCoordinator("acct-1", true, "u-revoked")).rejects.toMatchObject({ status: 403 });
    await expect(setAreaCoordinator("acct-1", true, "acct-ac")).rejects.toMatchObject({ status: 403 });
    await expect(setAreaCoordinator("acct-1", false, "u-event")).rejects.toMatchObject({ status: 403 });
    signInAs("systemAdmin");
    await expect(setAreaCoordinator("acct-1", true, "u-sys")).resolves.toBeUndefined();
    expect(mocks.areaUpsert).toHaveBeenCalledTimes(2);
  });

  it("audits with the same action names, and marks a Clubs Administrator's change", async () => {
    signInAs("systemAdmin");
    await setAreaCoordinator("acct-1", true, "u-sys");
    await setAreaCoordinator("acct-1", false, "u-sys");
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "AREA_COORDINATOR_GRANTED", actorUserId: "u-sys", entityId: "acct-1", metadata: { attendeeAccountId: "acct-1" } });
    expect(mocks.writeAuditLog.mock.calls[1]![0]).toMatchObject({ action: "AREA_COORDINATOR_REVOKED" });
    expect(mocks.writeAuditLog.mock.calls[0]![0].metadata).not.toHaveProperty("viaClubsAdministrator");

    mocks.writeAuditLog.mockClear();
    signInAs("clubsAdmin");
    await setAreaCoordinator("acct-1", true, "u-clubs");
    await setAreaCoordinator("acct-1", false, "u-clubs");
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "AREA_COORDINATOR_GRANTED", actorUserId: "u-clubs", metadata: { attendeeAccountId: "acct-1", viaClubsAdministrator: true } });
    expect(mocks.writeAuditLog.mock.calls[1]![0]).toMatchObject({ action: "AREA_COORDINATOR_REVOKED", metadata: { viaClubsAdministrator: true } });
  });
});

describe("every other account action stays system administrator only", () => {
  const actions: Array<[string, unknown, () => ReturnType<typeof vi.fn>]> = [
    ["reset-two-step", { action: "reset-two-step" }, () => mocks.resetAttendeeTwoStep],
    ["sign-out", { action: "sign-out" }, () => mocks.signOutAttendeeEverywhere],
    ["change-email", { action: "change-email", email: "new@example.test" }, () => mocks.changeAttendeeEmail],
    ["send-verification", { action: "send-verification" }, () => mocks.sendAttendeeVerificationByAdmin],
    ["link-staff", { action: "link-staff", staffEmail: "staff@example.test", reason: { code: "DIFFERENT_STAFF_EMAIL" } }, () => mocks.linkStaffAndAttendeeByHand],
    ["unlink-staff", { action: "unlink-staff", reason: { code: "WRONG_PERSON_LINKED" } }, () => mocks.unlinkStaffAndAttendee],
  ];
  for (const [name, body, effect] of actions) {
    it(`${name}: a system administrator is admitted, a Clubs Administrator and an Event Admin get 403`, async () => {
      signInAs("systemAdmin");
      expect((await accountCall(body)).status).toBe(200);
      expect(effect()).toHaveBeenCalledTimes(1);
      effect().mockClear();
      for (const viewer of ["clubsAdmin", "eventAdmin"] as const) {
        signInAs(viewer);
        expect((await accountCall(body)).status, viewer).toBe(403);
      }
      expect(effect()).not.toHaveBeenCalled();
    });
  }
});

describe("the other routes the person page uses refuse non-holders", () => {
  it("event memberships POST and PATCH need MANAGE_STAFF on that event: a Clubs Administrator and a stranger are refused", async () => {
    // The page draws these controls for a system administrator only; the route additionally admits a staff manager of that event.
    for (const viewer of ["clubsAdmin", "revokedClubsAdmin"] as const) {
      signInAs(viewer);
      const post = await addMembership(json("/api/events/evt-1/memberships", "POST", { email: "a@example.test", displayName: "Sample Person", role: "READ_ONLY_STAFF" }), ctx({ eventId: "evt-1" }));
      expect(post.status, viewer).toBe(403);
      const patch = await updateMembership(json("/api/events/evt-1/memberships/m-1", "PATCH", { role: "READ_ONLY_STAFF", status: "INACTIVE" }), ctx({ eventId: "evt-1", membershipId: "m-1" }));
      expect(patch.status, viewer).toBe(403);
    }
    signInAs("areaCoordinator");
    expect((await addMembership(json("/api/events/evt-1/memberships", "POST", { email: "a@example.test", displayName: "Sample Person", role: "READ_ONLY_STAFF" }), ctx({ eventId: "evt-1" }))).status).toBe(401);
    expect(mocks.addStaffMembership).not.toHaveBeenCalled();
    expect(mocks.updateStaffMembership).not.toHaveBeenCalled();
  });

  it("removing event access sends status INACTIVE through the membership update, never a delete", async () => {
    signInAs("systemAdmin");
    const response = await updateMembership(json("/api/events/evt-1/memberships/m-1", "PATCH", { role: "READ_ONLY_STAFF", status: "INACTIVE" }), ctx({ eventId: "evt-1", membershipId: "m-1" }));
    expect(response.status).toBe(200);
    expect(mocks.updateStaffMembership).toHaveBeenCalledWith("evt-1", "m-1", "u-sys", { role: "READ_ONLY_STAFF", status: "INACTIVE" });
  });

  it("the staff sign-in and profile route (PATCH /api/admin/users/[userId]) is for a system administrator only", async () => {
    for (const viewer of ["clubsAdmin", "eventAdmin"] as const) {
      signInAs(viewer);
      expect((await updateUser(json("/api/admin/users/u-x", "PATCH", { disabled: true }), ctx({ userId: "u-x" }))).status, viewer).toBe(403);
      expect((await updateUser(json("/api/admin/users/u-x", "PATCH", { displayName: "Sample Person" }), ctx({ userId: "u-x" }))).status, viewer).toBe(403);
    }
    signInAs("areaCoordinator");
    expect((await updateUser(json("/api/admin/users/u-x", "PATCH", { disabled: true }), ctx({ userId: "u-x" }))).status).toBe(403);
    expect(mocks.setAccountDisabled).not.toHaveBeenCalled();
    expect(mocks.updateTeamProfile).not.toHaveBeenCalled();
    signInAs("systemAdmin");
    expect((await updateUser(json("/api/admin/users/u-x", "PATCH", { disabled: true }), ctx({ userId: "u-x" }))).status).toBe(200);
    expect(mocks.setAccountDisabled).toHaveBeenCalledWith("u-x", true, "u-sys");
  });
});
