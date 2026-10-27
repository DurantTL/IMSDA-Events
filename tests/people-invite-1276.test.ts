import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1276: the one Invite a person. The real gates, schemas and modules run; the session, the database and the outbound
 * mail are faked. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getCurrentAttendee: vi.fn(),
  configured: vi.fn(),
  writeAuditLog: vi.fn(),
  deliverAfter: vi.fn(),
  sendStaffInvitationEmail: vi.fn(),
  issueAccountToken: vi.fn(),
  clubsGrantFindFirst: vi.fn(),
  clubsGrantUpsert: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  userFindMany: vi.fn(),
  userCount: vi.fn(),
  sessionUpdateMany: vi.fn(),
  accountFindUnique: vi.fn(),
  eventFindMany: vi.fn(),
  orgFindMany: vi.fn(),
  membershipFindUnique: vi.fn(),
  membershipCreate: vi.fn(),
  clubInviteFindFirst: vi.fn(),
  clubInviteFindMany: vi.fn(),
  clubInviteCreate: vi.fn(),
  clubInviteUpdate: vi.fn(),
  acFindFirst: vi.fn(),
  acFindMany: vi.fn(),
  acFindUnique: vi.fn(),
  acCreate: vi.fn(),
  acUpdate: vi.fn(),
  acUpdateMany: vi.fn(),
  areaUpsert: vi.fn(),
  outboxCreate: vi.fn(),
  tokenUpdateMany: vi.fn(),
  credentialUpdateMany: vi.fn(),
}));

type FakeUser = { id: string; email: string; globalRole: "SYSTEM_ADMIN" | null; attendeeAccountId?: string | null; credential?: { id: string; disabledAt?: Date | null } | null; accountStatus?: string; displayName?: string };
type FakeAccount = { id: string; email: string; linkedUser: { id: string } | null };
let users: FakeUser[] = [];
let accounts: FakeAccount[] = [];

const client = {
  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => users.find((user) => (where.id ? user.id === where.id : user.email === where.email)) ?? null,
    create: mocks.userCreate,
    update: mocks.userUpdate,
    findMany: mocks.userFindMany,
    count: mocks.userCount,
  },
  authCredential: { updateMany: mocks.credentialUpdateMany, create: vi.fn() },
  passwordResetToken: { updateMany: mocks.tokenUpdateMany },
  userSession: { updateMany: mocks.sessionUpdateMany },
  clubsAdministratorGrant: { findFirst: mocks.clubsGrantFindFirst, findUnique: vi.fn(async () => null), upsert: mocks.clubsGrantUpsert },
  attendeeAccount: { findUnique: mocks.accountFindUnique },
  event: { findMany: mocks.eventFindMany },
  organization: { findMany: mocks.orgFindMany },
  eventMembership: { findUnique: mocks.membershipFindUnique, create: mocks.membershipCreate },
  clubInvite: { findFirst: mocks.clubInviteFindFirst, findMany: mocks.clubInviteFindMany, create: mocks.clubInviteCreate, update: mocks.clubInviteUpdate },
  areaCoordinatorInvite: { findFirst: mocks.acFindFirst, findMany: mocks.acFindMany, findUnique: mocks.acFindUnique, create: mocks.acCreate, update: mocks.acUpdate, updateMany: mocks.acUpdateMany },
  areaCoordinatorGrant: { upsert: mocks.areaUpsert, updateMany: vi.fn() },
  messageOutbox: { create: mocks.outboxCreate },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/passwords", () => ({ hashPassword: async () => "hash" }));
vi.mock("@/modules/coordinator-health/membership-grants", () => ({ stripHealthAccess: vi.fn() }));
vi.mock("@/modules/invoices/finalize-access", () => ({ stripInvoiceFinalizationAccess: vi.fn() }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: vi.fn() }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: vi.fn(), StaffActAsError: class StaffActAsError extends Error {} }));
vi.mock("@/modules/communications/account-email", () => ({
  isAccountEmailConfigured: mocks.configured,
  getAccountEmailSender: () => ({ name: "IMSDA Events", address: "events@example.test", replyTo: null }),
}));
vi.mock("@/modules/communications/account-email-dispatch", () => ({ sendStaffInvitationEmail: mocks.sendStaffInvitationEmail, sendAccountRecoveryEmail: vi.fn() }));
vi.mock("@/modules/access/auth-service", () => ({ issueAccountToken: mocks.issueAccountToken }));
vi.mock("@/modules/communications/queued-invite-delivery", () => ({ deliverQueuedInviteEmailsAfterResponse: mocks.deliverAfter }));
vi.mock("@/modules/account-merge/hand-link", () => ({ HandLinkError: class HandLinkError extends Error {}, requireSystemAdminActor: vi.fn() }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: vi.fn(async () => false) }));
vi.mock("@/modules/access/session-store", () => ({ revokeAllUserSessions: vi.fn() }));
vi.mock("@/modules/attendee-accounts/session-store", () => ({ revokeAllAttendeeSessions: vi.fn() }));
vi.mock("@/modules/attendee-accounts/account-service", () => ({ beginAdminVerification: vi.fn() }));
vi.mock("@/modules/attendee-accounts/attendee-email-dispatch", () => ({ queueAttendeeVerificationEmail: vi.fn(), deliverQueuedAttendeeEmail: vi.fn() }));
vi.mock("@/modules/rate-limit/service", () => ({ checkAdminVerificationEmailRateLimit: vi.fn() }));
vi.mock("@/modules/system-admin/team-directory", () => ({ getTeamDirectory: vi.fn(async () => ({ members: [] })) }));

import { POST as inviteRoute } from "@/app/api/admin/people/invite/route";
import { POST as usersRoute } from "@/app/api/admin/users/route";
import { POST as staffActions } from "@/app/api/admin/users/[userId]/actions/route";
import { POST as areaInviteAction } from "@/app/api/admin/area-coordinator-invites/[inviteId]/route";
import { POST as areaInviteAccept } from "@/app/api/attendee/area-coordinator-invites/[inviteId]/accept/route";
import { acceptAreaCoordinatorInvite, cancelAreaCoordinatorInvite, resendAreaCoordinatorInvite } from "@/modules/organizations/area-coordinator-invites";
import { invitePerson } from "@/modules/system-admin/people-invite";
import { listPendingInvites } from "@/modules/system-admin/pending-invites";
import { cancelStaffInvite, resendStaffInvite } from "@/modules/system-admin/user-admin";

type Viewer = "systemAdmin" | "clubsAdmin" | "eventAdmin" | "signedOut";
const viewers: Record<Exclude<Viewer, "signedOut">, { id: string; globalRole: "SYSTEM_ADMIN" | null }> = {
  systemAdmin: { id: "u-sys", globalRole: "SYSTEM_ADMIN" },
  clubsAdmin: { id: "u-clubs", globalRole: null },
  eventAdmin: { id: "u-event", globalRole: null },
};

function signInAs(viewer: Viewer) {
  users = users.filter((user) => !Object.values(viewers).some((entry) => entry.id === user.id));
  if (viewer === "signedOut") {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    return;
  }
  users.push({ ...viewers[viewer], email: `${viewer}@imsda-events.test` });
  mocks.getCurrentSession.mockResolvedValue({ user: { ...viewers[viewer], email: `${viewer}@imsda-events.test`, displayName: viewer } });
  mocks.clubsGrantFindFirst.mockImplementation(async ({ where }: { where: { userId: string } }) => (viewer === "clubsAdmin" && where.userId === "u-clubs" ? { id: "grant-1" } : null));
}

const post = (url: string, body: unknown) => new Request(`https://events.imsda.test${url}`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const now = new Date("2026-10-27T15:00:00Z");

const person = { name: "Pat Example", email: "Pat@Example.test" };
const invite = (access: Record<string, unknown>, extra: Record<string, unknown> = {}) => inviteRoute(post("/api/admin/people/invite", { ...person, access, ...extra }));

beforeEach(() => {
  vi.clearAllMocks();
  users = [];
  accounts = [];
  signInAs("systemAdmin");
  mocks.configured.mockReturnValue(true);
  mocks.sendStaffInvitationEmail.mockResolvedValue({ configured: true, queued: true });
  mocks.issueAccountToken.mockResolvedValue({ token: "one-time-token", purpose: "ACCOUNT_ACTIVATION", expiresAt: new Date("2026-11-03T15:00:00Z") });
  mocks.userCreate.mockImplementation(async ({ data }: { data: { email: string; displayName: string } }) => {
    const created = { id: "u-new", email: data.email, globalRole: null, credential: { id: "cred-1" } } satisfies FakeUser;
    users.push(created);
    return created;
  });
  mocks.userUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: { globalRole?: "SYSTEM_ADMIN" | null } }) => {
    const user = users.find((entry) => entry.id === where.id)!;
    Object.assign(user, data);
    return { ...user, displayName: "Pat Example" };
  });
  mocks.eventFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => id.startsWith("evt_")).map((id) => ({ id })));
  mocks.orgFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => id.startsWith("club_")).map((id) => ({ id, name: `Club ${id}` })));
  mocks.membershipFindUnique.mockResolvedValue(null);
  mocks.membershipCreate.mockResolvedValue({ id: "m-1" });
  mocks.clubInviteFindFirst.mockResolvedValue(null);
  mocks.clubInviteCreate.mockImplementation(async () => ({ id: `ci-${mocks.clubInviteCreate.mock.calls.length}` }));
  mocks.acFindFirst.mockResolvedValue(null);
  mocks.acCreate.mockResolvedValue({ id: "ac-1" });
  mocks.outboxCreate.mockImplementation(async () => ({ id: `msg-${mocks.outboxCreate.mock.calls.length}` }));
  mocks.acUpdateMany.mockResolvedValue({ count: 1 });
  mocks.accountFindUnique.mockImplementation(async ({ where }: { where: { id?: string; email?: string } }) => accounts.find((account) => (where.id ? account.id === where.id : account.email === where.email)) ?? (where.id === "acct-acc" ? { id: "acct-acc" } : null));
});

describe("each kind of access alone", () => {
  it("creates a staff login with a system administrator role and sends the activation email", async () => {
    const response = await invite({ systemAdmin: true });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.created).toMatchObject({ staffLogin: true, invitationEmailed: true, clubInviteIds: [] });
    expect(body.created.setupUrl).toBeUndefined();
    expect(body.deferred).toBeNull();
    expect(mocks.userCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: "pat@example.test", accountStatus: "PENDING_ACTIVATION" }) }));
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { globalRole: "SYSTEM_ADMIN" } }));
    expect(mocks.sendStaffInvitationEmail).toHaveBeenCalledWith({ userId: "u-new", email: "pat@example.test", displayName: "Pat Example" });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "SYSTEM_ADMIN_GRANTED", actorUserId: "u-sys" }), expect.anything());
  });

  it("creates a staff login with a Clubs Administrator role and no event", async () => {
    const body = await (await invite({ clubsAdministrator: true })).json();
    expect(body.created.staffLogin).toBe(true);
    expect(mocks.clubsGrantUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.membershipCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CLUBS_ADMINISTRATOR_GRANTED" }), expect.anything());
  });

  it("creates a staff login with event roles", async () => {
    const body = await (await invite({ events: [{ eventId: "evt_1", role: "REGISTRATION_MANAGER" }, { eventId: "evt_2", role: "READ_ONLY_STAFF" }] })).json();
    expect(body.created.staffLogin).toBe(true);
    expect(mocks.membershipCreate).toHaveBeenCalledTimes(2);
    expect(mocks.membershipCreate).toHaveBeenCalledWith({ data: { eventId: "evt_1", userId: "u-new", role: "REGISTRATION_MANAGER", status: "ACTIVE" } });
  });

  it("invites a club role and queues one email with the PEOPLE wording", async () => {
    const response = await invite({ clubs: [{ organizationId: "club_1", role: "REGISTRAR" }] });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.created).toMatchObject({ staffLogin: false, clubInviteIds: ["ci-1"] });
    expect(body.created.signUpUrl).toBeUndefined();
    expect(mocks.clubInviteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "club_1", email: "pat@example.test", role: "REGISTRAR", source: "PEOPLE", createdByUserId: "u-sys", status: "SENT", sentCount: 1 }),
      select: { id: true },
    });
    expect(mocks.clubInviteCreate.mock.calls[0]![0].data.expiresAt).toBeInstanceOf(Date);
    const message = mocks.outboxCreate.mock.calls[0]![0].data;
    expect(message).toMatchObject({ templateKey: "CLUB_INVITE", recipientEmail: "pat@example.test", eventId: null });
    expect(message.bodyTextSnapshot).toContain("The Iowa-Missouri Conference has invited you as Club club_1's registrar on IMSDA Events.");
    expect(message.metadata).toMatchObject({ trigger: "CLUB_INVITE_SENT", accountEmail: true, clubInviteId: "ci-1" });
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CLUB_INVITE_CREATED", actorUserId: "u-sys" }), expect.anything());
    expect(mocks.deliverAfter).toHaveBeenCalledWith(["msg-1"]);
  });

  it("invites an Area Coordinator with its own email and audit entry", async () => {
    const body = await (await invite({ areaCoordinator: true })).json();
    expect(body.created).toMatchObject({ staffLogin: false, areaCoordinatorInviteId: "ac-1" });
    expect(mocks.acCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "pat@example.test", status: "SENT", createdByUserId: "u-sys", sentCount: 1 }),
      select: { id: true },
    });
    expect(mocks.outboxCreate.mock.calls[0]![0].data).toMatchObject({ templateKey: "CLUB_INVITE", metadata: expect.objectContaining({ trigger: "AREA_COORDINATOR_INVITE_SENT", areaCoordinatorInviteId: "ac-1" }) });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "AREA_COORDINATOR_INVITE_CREATED" }), expect.anything());
  });

  it("does a mix: staff login with roles, a club invite and an Area Coordinator invite", async () => {
    const body = await (await invite({ systemAdmin: true, areaCoordinator: true, events: [{ eventId: "evt_1", role: "EVENT_ADMIN" }], clubs: [{ organizationId: "club_1", role: "DIRECTOR" }] })).json();
    expect(body.created).toMatchObject({ staffLogin: true, invitationEmailed: true, clubInviteIds: ["ci-1"], areaCoordinatorInviteId: "ac-1" });
    expect(body.deferred).toBeNull();
    expect(mocks.userCreate).toHaveBeenCalledTimes(1);
    expect(mocks.membershipCreate).toHaveBeenCalledTimes(1);
    expect(mocks.deliverAfter).toHaveBeenCalledWith(["msg-1", "msg-2"]);
  });
});

describe("an email that already has an account (no duplicates, no linking)", () => {
  it("defers everything for an existing staff login and an existing website account", async () => {
    users.push({ id: "u-pat", email: "pat@example.test", globalRole: null, attendeeAccountId: "acct-pat", credential: { id: "c" } });
    accounts.push({ id: "acct-pat", email: "pat@example.test", linkedUser: { id: "u-pat" } });
    const body = await (await invite({ systemAdmin: true, areaCoordinator: true, events: [{ eventId: "evt_1", role: "EVENT_ADMIN" }], clubs: [{ organizationId: "club_1", role: "DIRECTOR" }] })).json();
    expect(body.created).toMatchObject({ staffLogin: false, clubInviteIds: [] });
    expect(body.deferred.personHref).toBe("/admin/people/staff/u-pat?grant=" + encodeURIComponent("sa,e:evt_1:EVENT_ADMIN,ac,c:club_1:DIRECTOR"));
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.clubInviteCreate).not.toHaveBeenCalled();
    expect(mocks.acCreate).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
    expect(mocks.sendStaffInvitationEmail).not.toHaveBeenCalled();
  });

  it("defers family-side items to the account page for an existing website account, with no invite", async () => {
    accounts.push({ id: "acct-pat", email: "pat@example.test", linkedUser: null });
    const body = await (await invite({ areaCoordinator: true, clubs: [{ organizationId: "club_1", role: "REPORTER" }] })).json();
    expect(body.deferred.personHref).toBe("/admin/people/account/acct-pat?grant=" + encodeURIComponent("ac,c:club_1:REPORTER"));
    expect(mocks.clubInviteCreate).not.toHaveBeenCalled();
    expect(mocks.acCreate).not.toHaveBeenCalled();
  });

  it("creates the staff login when only a family account exists, and defers the family side", async () => {
    accounts.push({ id: "acct-pat", email: "pat@example.test", linkedUser: null });
    const body = await (await invite({ clubsAdministrator: true, areaCoordinator: true })).json();
    expect(body.created.staffLogin).toBe(true);
    expect(body.deferred.personHref).toBe("/admin/people/account/acct-pat?grant=ac");
    expect(mocks.userCreate).toHaveBeenCalledTimes(1);
    expect(mocks.acCreate).not.toHaveBeenCalled();
  });

  it("invites the family side and defers the staff side when only a staff login exists", async () => {
    users.push({ id: "u-pat", email: "pat@example.test", globalRole: null, attendeeAccountId: null, credential: { id: "c" } });
    const body = await (await invite({ systemAdmin: true, areaCoordinator: true })).json();
    expect(body.created).toMatchObject({ staffLogin: false, areaCoordinatorInviteId: "ac-1" });
    expect(body.deferred.personHref).toBe("/admin/people/staff/u-pat?grant=sa");
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("counts a website account linked to a staff login with another email as that staff login", async () => {
    accounts.push({ id: "acct-pat", email: "pat@example.test", linkedUser: { id: "u-other" } });
    const body = await (await invite({ systemAdmin: true })).json();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(body.deferred.personHref).toBe("/admin/people/staff/u-other?grant=sa");
  });

  it("never uses a login that appeared after the check: it rolls back and defers instead", async () => {
    // The first lookups (actor, existing person) see nothing; by the write the login exists and is not newly created.
    let sawEmail = 0;
    users.push({ id: "u-raced", email: "other@example.test", globalRole: null, attendeeAccountId: null, credential: { id: "c" } });
    const real = client.user.findUnique;
    client.user.findUnique = async (args: { where: { id?: string; email?: string } }) => {
      if (args.where.email === "pat@example.test" && ++sawEmail > 2) return { id: "u-raced", email: "pat@example.test", globalRole: null, attendeeAccountId: null, credential: { id: "c" } } as never;
      return real(args);
    };
    try {
      const body = await (await invite({ systemAdmin: true, events: [{ eventId: "evt_1", role: "EVENT_ADMIN" }] })).json();
      expect(body.created.staffLogin).toBe(false);
      expect(body.deferred.personHref).toBe("/admin/people/staff/u-raced?grant=" + encodeURIComponent("sa,e:evt_1:EVENT_ADMIN"));
      expect(mocks.userCreate).not.toHaveBeenCalled();
      // No role was applied and nothing was emailed (the rename inside the transaction is rolled back with it).
      expect(mocks.userUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: { globalRole: "SYSTEM_ADMIN" } }));
      expect(mocks.membershipCreate).not.toHaveBeenCalled();
      expect(mocks.sendStaffInvitationEmail).not.toHaveBeenCalled();
    } finally {
      client.user.findUnique = real;
    }
  });

  it("POST /api/admin/users answers an existing login with 409 and the person's page", async () => {
    users.push({ id: "u-pat", email: "pat@example.test", globalRole: null, credential: { id: "c" } });
    const response = await usersRoute(post("/api/admin/users", { ...person, access: { systemAdmin: true } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "STAFF_LOGIN_EXISTS", personHref: "/admin/people/staff/u-pat?grant=sa" });
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });
});

describe("who may invite what", () => {
  const staffSide = [
    { systemAdmin: true },
    { clubsAdministrator: true },
    { events: [{ eventId: "evt_1", role: "EVENT_ADMIN" }] },
    { areaCoordinator: true, systemAdmin: true },
  ];

  it("refuses a Clubs Administrator any staff-side item, writing nothing", async () => {
    signInAs("clubsAdmin");
    for (const access of staffSide) expect((await invite(access)).status, JSON.stringify(access)).toBe(403);
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.clubInviteCreate).not.toHaveBeenCalled();
    expect(mocks.acCreate).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("allows a Clubs Administrator Area Coordinator and club roles", async () => {
    signInAs("clubsAdmin");
    const response = await invite({ areaCoordinator: true, clubs: [{ organizationId: "club_1", role: "DEPUTY" }] });
    expect(response.status).toBe(201);
    expect((await response.json()).created).toMatchObject({ clubInviteIds: ["ci-1"], areaCoordinatorInviteId: "ac-1" });
    expect(mocks.clubInviteCreate.mock.calls[0]![0].data.createdByUserId).toBe("u-clubs");
  });

  it("re-checks the actor in the module, from the database", async () => {
    const input = { name: "Pat Example", email: "pat@example.test", access: { systemAdmin: true, clubsAdministrator: false, areaCoordinator: false, events: [], clubs: [] } };
    await expect(invitePerson("u-clubs", input, now)).rejects.toMatchObject({ status: 403 });
    await expect(invitePerson("u-event", input, now)).rejects.toMatchObject({ status: 403 });
    await expect(invitePerson("nobody", input, now)).rejects.toMatchObject({ status: 403 });
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("refuses an Event Admin and a signed-out caller on every route", async () => {
    signInAs("eventAdmin");
    expect((await invite({ areaCoordinator: true })).status).toBe(403);
    expect((await usersRoute(post("/api/admin/users", { ...person, access: { systemAdmin: true } }))).status).toBe(403);
    signInAs("signedOut");
    expect((await invite({ areaCoordinator: true })).status).toBe(401);
    expect((await usersRoute(post("/api/admin/users", { ...person, access: { systemAdmin: true } }))).status).toBe(401);
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.acCreate).not.toHaveBeenCalled();
  });

  it("limits POST /api/admin/users to system administrators and to staff-side access", async () => {
    signInAs("clubsAdmin");
    expect((await usersRoute(post("/api/admin/users", { ...person, access: { clubsAdministrator: true } }))).status).toBe(403);
    signInAs("systemAdmin");
    expect((await usersRoute(post("/api/admin/users", { ...person, access: { areaCoordinator: true } }))).status).toBe(400);
    const created = await usersRoute(post("/api/admin/users", { ...person, access: { clubsAdministrator: true } }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ userId: "u-new", invitationEmailed: true });
  });
});

describe("validation happens before anything is written", () => {
  it("answers bad JSON and bad input with 400", async () => {
    expect((await inviteRoute(post("/api/admin/people/invite", "{not json"))).status).toBe(400);
    expect((await invite({})).status).toBe(400);
    expect((await invite({ systemAdmin: true, surprise: true })).status).toBe(400);
    expect((await inviteRoute(post("/api/admin/people/invite", { name: "P", email: "nope", access: { systemAdmin: true } }))).status).toBe(400);
    expect((await invite({ clubs: [{ organizationId: "club_1", role: "BOSS" }] })).status).toBe(400);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("refuses an unknown event or club, writing nothing even for the part that was valid", async () => {
    expect((await invite({ systemAdmin: true, events: [{ eventId: "missing", role: "EVENT_ADMIN" }] })).status).toBe(400);
    expect((await invite({ systemAdmin: true, clubs: [{ organizationId: "church_1", role: "DIRECTOR" }] })).status).toBe(400);
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.clubInviteCreate).not.toHaveBeenCalled();
  });

  it("refuses a duplicate open invite for the same email, club and role, writing nothing", async () => {
    mocks.clubInviteFindFirst.mockResolvedValue({ id: "ci-old" });
    const response = await invite({ systemAdmin: true, clubs: [{ organizationId: "club_1", role: "DIRECTOR" }] });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "ALREADY_INVITED" });
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.clubInviteCreate).not.toHaveBeenCalled();
  });

  it("maps the open-invite unique index to ALREADY_INVITED and creates no staff login", async () => {
    const { Prisma } = await import("@prisma/client");
    mocks.acCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    const response = await invite({ systemAdmin: true, areaCoordinator: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "ALREADY_INVITED" });
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.sendStaffInvitationEmail).not.toHaveBeenCalled();
  });

  it("refuses a second open Area Coordinator invite for the same email", async () => {
    mocks.acFindFirst.mockResolvedValue({ id: "ac-old" });
    const response = await invite({ areaCoordinator: true });
    expect(response.status).toBe(409);
    expect(mocks.acCreate).not.toHaveBeenCalled();
  });
});

describe("no email configured", () => {
  beforeEach(() => {
    mocks.configured.mockReturnValue(false);
    mocks.sendStaffInvitationEmail.mockResolvedValue({ configured: false, queued: false });
  });

  it("returns a one-time setup link for the staff login", async () => {
    const body = await (await invite({ systemAdmin: true })).json();
    expect(body.created).toMatchObject({
      staffLogin: true,
      invitationEmailed: false,
      setupUrl: "https://events.imsda.test/reset-password?token=one-time-token",
      setupExpiresAt: "2026-11-03T15:00:00.000Z",
    });
  });

  it("still creates the family invites as SENT, queues nothing, and returns the sign-up link", async () => {
    const body = await (await invite({ areaCoordinator: true, clubs: [{ organizationId: "club_1", role: "DIRECTOR" }] })).json();
    expect(body.created.signUpUrl).toBe("https://events.imsda.test/account/sign-up#email=pat%40example.test");
    expect(body.created.clubInviteIds).toEqual(["ci-1"]);
    expect(mocks.clubInviteCreate.mock.calls[0]![0].data).toMatchObject({ status: "SENT", sentCount: 0 });
    expect(mocks.acCreate.mock.calls[0]![0].data).toMatchObject({ status: "SENT", sentCount: 0 });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
    expect(mocks.deliverAfter).toHaveBeenCalledWith([]);
  });
});

describe("accepting an Area Coordinator invite", () => {
  const open = { id: "aci-1", email: "pat@example.test", status: "SENT", expiresAt: new Date("2026-11-10T00:00:00Z"), createdByUserId: "u-sys" };
  const account = { id: "acct-acc", verifiedEmail: "Pat@Example.test" };

  beforeEach(() => {
    mocks.acFindUnique.mockResolvedValue(open);
    users.push({ id: "u-sys", email: "sys@imsda-events.test", globalRole: "SYSTEM_ADMIN" });
  });

  it("creates the grant for the account whose verified email matches, guarded and audited", async () => {
    await acceptAreaCoordinatorInvite("aci-1", account, now);
    expect(mocks.acUpdateMany).toHaveBeenCalledWith({ where: { id: "aci-1", status: "SENT" }, data: expect.objectContaining({ status: "ACCEPTED", acceptedAccountId: "acct-acc" }) });
    expect(mocks.areaUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { attendeeAccountId: "acct-acc" } }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "AREA_COORDINATOR_GRANTED", actorUserId: "u-sys", metadata: { attendeeAccountId: "acct-acc", viaInviteId: "aci-1" } }), expect.anything());
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "AREA_COORDINATOR_INVITE_ACCEPTED", entityId: "aci-1" }), expect.anything());
  });

  it("answers the wrong email exactly like a missing invite, and grants nothing", async () => {
    await expect(acceptAreaCoordinatorInvite("aci-1", { id: "acct-x", verifiedEmail: "other@example.test" }, now)).rejects.toMatchObject({ code: "INVITE_NOT_FOUND" });
    mocks.acFindUnique.mockResolvedValue(null);
    await expect(acceptAreaCoordinatorInvite("aci-1", account, now)).rejects.toMatchObject({ code: "INVITE_NOT_FOUND" });
    expect(mocks.areaUpsert).not.toHaveBeenCalled();
  });

  it("refuses an expired, cancelled or already accepted invite", async () => {
    mocks.acFindUnique.mockResolvedValue({ ...open, expiresAt: new Date("2026-10-27T14:00:00Z") });
    await expect(acceptAreaCoordinatorInvite("aci-1", account, now)).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
    mocks.acFindUnique.mockResolvedValue({ ...open, status: "CANCELLED" });
    await expect(acceptAreaCoordinatorInvite("aci-1", account, now)).rejects.toMatchObject({ code: "INVITE_NOT_OPEN" });
    mocks.acFindUnique.mockResolvedValue(open);
    mocks.acUpdateMany.mockResolvedValue({ count: 0 });
    await expect(acceptAreaCoordinatorInvite("aci-1", account, now)).rejects.toMatchObject({ code: "INVITE_NOT_OPEN" });
    expect(mocks.areaUpsert).not.toHaveBeenCalled();
  });

  it("refuses when the inviter has lost the role, and accepts for an active Clubs Administrator", async () => {
    users = [{ id: "u-sys", email: "sys@imsda-events.test", globalRole: null }];
    mocks.clubsGrantFindFirst.mockResolvedValue(null);
    await expect(acceptAreaCoordinatorInvite("aci-1", account, now)).rejects.toMatchObject({ code: "INVITE_NOT_OPEN" });
    expect(mocks.acUpdateMany).not.toHaveBeenCalled();
    expect(mocks.areaUpsert).not.toHaveBeenCalled();
    mocks.clubsGrantFindFirst.mockResolvedValue({ id: "grant-1" });
    await acceptAreaCoordinatorInvite("aci-1", account, now);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "AREA_COORDINATOR_GRANTED", metadata: expect.objectContaining({ viaClubsAdministrator: true }) }), expect.anything());
  });

  it("is reachable only from the person's own signed-in account", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null });
    expect((await areaInviteAccept(post("/api/attendee/area-coordinator-invites/aci-1/accept", {}), ctx({ inviteId: "aci-1" }))).status).toBe(401);
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-acc", verifiedEmail: "pat@example.test" }, via: "staff" });
    expect((await areaInviteAccept(post("/api/attendee/area-coordinator-invites/aci-1/accept", {}), ctx({ inviteId: "aci-1" }))).status).toBe(401);
    mocks.getCurrentAttendee.mockResolvedValue({ account: { id: "acct-acc", verifiedEmail: "pat@example.test" }, via: "attendee" });
    const ok = await areaInviteAccept(post("/api/attendee/area-coordinator-invites/aci-1/accept", {}), ctx({ inviteId: "aci-1" }));
    expect(ok.status).toBe(200);
    expect(mocks.areaUpsert).toHaveBeenCalledTimes(1);
    expect(await ok.json()).toEqual({ ok: true, nextUrl: "/account/area-clubs/overview" });
  });
});

describe("resending and cancelling an Area Coordinator invite", () => {
  const open = { id: "aci-1", email: "pat@example.test", name: "Pat Example", status: "SENT", sentAt: new Date("2026-10-27T10:00:00Z") };

  beforeEach(() => mocks.acFindUnique.mockResolvedValue(open));

  it("resends with a fresh expiry, a new email and an audit entry", async () => {
    signInAs("clubsAdmin");
    const response = await areaInviteAction(post("/api/admin/area-coordinator-invites/aci-1", { action: "resend" }), ctx({ inviteId: "aci-1" }));
    expect(response.status).toBe(200);
    expect(mocks.acUpdateMany).toHaveBeenCalledWith({ where: { id: "aci-1", status: { in: ["PENDING", "SENT"] } }, data: expect.objectContaining({ status: "SENT", sentCount: { increment: 1 }, expiresAt: expect.any(Date) }) });
    expect(mocks.outboxCreate).toHaveBeenCalledTimes(1);
    expect(mocks.deliverAfter).toHaveBeenCalledWith(["msg-1"]);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "AREA_COORDINATOR_INVITE_RESENT", actorUserId: "u-clubs" }), expect.anything());
  });

  it("holds a resend to the cooldown, and says so when email isn't set up", async () => {
    mocks.acFindUnique.mockResolvedValue({ ...open, sentAt: new Date() });
    await expect(resendAreaCoordinatorInvite("aci-1", "u-sys")).rejects.toMatchObject({ code: "INVITE_RESEND_TOO_SOON" });
    mocks.configured.mockReturnValue(false);
    await expect(resendAreaCoordinatorInvite("aci-1", "u-sys", now)).rejects.toMatchObject({ code: "EMAIL_NOT_CONFIGURED" });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("cancels with a guarded write and an audit entry", async () => {
    await cancelAreaCoordinatorInvite("aci-1", "u-sys", now);
    expect(mocks.acUpdateMany).toHaveBeenCalledWith({ where: { id: "aci-1", status: { in: ["PENDING", "SENT"] } }, data: { status: "CANCELLED", cancelledAt: now } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "AREA_COORDINATOR_INVITE_CANCELLED", actorUserId: "u-sys" }), expect.anything());
    mocks.acFindUnique.mockResolvedValue({ ...open, status: "ACCEPTED" });
    await expect(cancelAreaCoordinatorInvite("aci-1", "u-sys", now)).rejects.toMatchObject({ code: "INVITE_NOT_OPEN" });
  });

  it("refuses everyone who is not a system administrator or an active Clubs Administrator, at the route and in the module", async () => {
    signInAs("eventAdmin");
    expect((await areaInviteAction(post("/api/admin/area-coordinator-invites/aci-1", { action: "cancel" }), ctx({ inviteId: "aci-1" }))).status).toBe(403);
    signInAs("signedOut");
    expect((await areaInviteAction(post("/api/admin/area-coordinator-invites/aci-1", { action: "cancel" }), ctx({ inviteId: "aci-1" }))).status).toBe(401);
    await expect(cancelAreaCoordinatorInvite("aci-1", "u-event", now)).rejects.toMatchObject({ status: 403 });
    expect(mocks.acUpdateMany).not.toHaveBeenCalled();
  });
});

describe("resending and cancelling a staff invite", () => {
  const pending = { id: "u-pend", email: "pend@example.test", displayName: "Pend Example", globalRole: null, accountStatus: "PENDING_ACTIVATION", credential: { id: "c", disabledAt: null } };

  beforeEach(() => {
    users.push(pending);
    mocks.credentialUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("resends the activation email and audits it", async () => {
    const delivery = await resendStaffInvite("u-pend", "u-sys");
    expect(delivery).toEqual({ invitationEmailed: true });
    expect(mocks.sendStaffInvitationEmail).toHaveBeenCalledWith({ userId: "u-pend", email: "pend@example.test", displayName: "Pend Example" });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "STAFF_INVITE_RESENT", actorUserId: "u-sys", entityId: "u-pend" }));
  });

  it("hands back a one-time link when email isn't configured", async () => {
    mocks.sendStaffInvitationEmail.mockResolvedValue({ configured: false, queued: false });
    expect(await resendStaffInvite("u-pend", "u-sys")).toMatchObject({ invitationEmailed: false, setupUrl: "https://events.imsda.test/reset-password?token=one-time-token" });
  });

  it("removes a system administrator and Clubs Administrator role on cancel, audited, when another working admin exists", async () => {
    users.push({ id: "u-pend-admin", email: "pa@example.test", displayName: "Pa", globalRole: "SYSTEM_ADMIN", accountStatus: "PENDING_ACTIVATION", credential: { id: "c", disabledAt: null } });
    mocks.userCount.mockResolvedValue(1);
    mocks.clubsGrantFindFirst.mockResolvedValue(null);
    await cancelStaffInvite("u-pend-admin", "u-sys", now);
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u-pend-admin" }, data: { globalRole: null } }));
    expect(mocks.userCount).toHaveBeenCalledWith({ where: expect.objectContaining({ globalRole: "SYSTEM_ADMIN", id: { not: "u-pend-admin" }, NOT: { credential: { is: { disabledAt: { not: null } } } } }) });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "SYSTEM_ADMIN_REVOKED" }), expect.anything());
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "STAFF_INVITE_CANCELLED" }), expect.anything());
  });

  it("refuses to cancel when it would leave no working system administrator", async () => {
    users.push({ id: "u-pend-admin", email: "pa@example.test", displayName: "Pa", globalRole: "SYSTEM_ADMIN", accountStatus: "PENDING_ACTIVATION", credential: { id: "c", disabledAt: null } });
    mocks.userCount.mockResolvedValue(0);
    await expect(cancelStaffInvite("u-pend-admin", "u-sys", now)).rejects.toMatchObject({ code: "LAST_SYSTEM_ADMIN" });
  });

  it("cancels by spending unused links and switching the sign-in off", async () => {
    await cancelStaffInvite("u-pend", "u-sys", now);
    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith({ where: { userId: "u-pend", usedAt: null }, data: { usedAt: now } });
    expect(mocks.credentialUpdateMany).toHaveBeenCalledWith({ where: { userId: "u-pend", disabledAt: null }, data: { disabledAt: now } });
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "STAFF_INVITE_CANCELLED", actorUserId: "u-sys" }), expect.anything());
  });

  it("only applies to a login waiting for activation with its sign-in on", async () => {
    users.push({ ...pending, id: "u-active", accountStatus: "ACTIVE" }, { ...pending, id: "u-off", credential: { id: "c", disabledAt: now } });
    await expect(resendStaffInvite("u-active", "u-sys")).rejects.toMatchObject({ code: "ACCOUNT_NOT_USABLE" });
    await expect(cancelStaffInvite("u-off", "u-sys", now)).rejects.toMatchObject({ code: "ACCOUNT_NOT_USABLE" });
    await expect(resendStaffInvite("missing", "u-sys")).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
  });

  it("is a system administrator action on the route; a Clubs Administrator is refused", async () => {
    const call = (action: string) => staffActions(post("/api/admin/users/u-pend/actions", { action }), ctx({ userId: "u-pend" }));
    expect((await call("resend-invite")).status).toBe(200);
    expect((await call("cancel-invite")).status).toBe(200);
    mocks.writeAuditLog.mockClear();
    signInAs("clubsAdmin");
    expect((await call("resend-invite")).status).toBe(403);
    expect((await call("cancel-invite")).status).toBe(403);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("the pending invites list", () => {
  beforeEach(() => {
    mocks.clubInviteFindMany.mockResolvedValue([
      { id: "ci-1", email: "pat@example.test", name: "Pat Example", role: "DIRECTOR", sentAt: new Date("2026-10-20T00:00:00Z"), createdAt: new Date("2026-10-20T00:00:00Z"), expiresAt: new Date("2026-10-25T00:00:00Z"), organization: { name: "Example Pathfinders" } },
    ]);
    mocks.acFindMany.mockResolvedValue([
      { id: "aci-1", email: "pat@example.test", name: "Pat Example", sentAt: new Date("2026-10-26T00:00:00Z"), createdAt: new Date("2026-10-26T00:00:00Z"), expiresAt: new Date("2026-11-09T00:00:00Z") },
    ]);
    mocks.userFindMany.mockResolvedValue([
      { id: "u-pend", email: "pend@example.test", displayName: "Pend Example", createdAt: new Date("2026-10-27T00:00:00Z"), resetTokens: [{ createdAt: new Date("2026-10-27T00:00:00Z"), expiresAt: new Date("2026-11-03T00:00:00Z"), usedAt: null }] },
    ]);
  });

  it("lists club, Area Coordinator and staff invites for the full scope, marking an expired one", async () => {
    const { invites } = await listPendingInvites({ scope: "full" }, now);
    expect(invites.map((entry) => [entry.kind, entry.what, entry.expired])).toEqual([
      ["staff", "Staff login, not activated yet", false],
      ["area", "Area Coordinator", false],
      ["club", "Director of Example Pathfinders", true],
    ]);
    expect(invites.find((entry) => entry.kind === "club")!.signUpUrl).toBe("https://events.imsda.test/account/sign-up#email=pat%40example.test");
  });

  it("never reads or shows staff logins to a Clubs Administrator", async () => {
    const { invites } = await listPendingInvites({ scope: "clubs" }, now);
    expect(invites.map((entry) => entry.kind)).toEqual(["area", "club"]);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });

  it("filters by search text or by the person's own emails", async () => {
    await listPendingInvites({ scope: "full", query: "pat" }, now);
    expect(mocks.acFindMany.mock.calls[0]![0].where.OR).toEqual([{ email: { contains: "pat", mode: "insensitive" } }, { name: { contains: "pat", mode: "insensitive" } }]);
    await listPendingInvites({ scope: "full", emails: ["Pat@Example.test"] }, now);
    expect(mocks.acFindMany.mock.calls[1]![0].where.email).toEqual({ in: ["pat@example.test"] });
    mocks.acFindMany.mockClear();
    expect((await listPendingInvites({ scope: "full", emails: [] }, now)).invites).toEqual([]);
    expect(mocks.acFindMany).not.toHaveBeenCalled();
  });
});
