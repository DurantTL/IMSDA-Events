/* eslint-disable @typescript-eslint/no-explicit-any -- the in-memory fake database receives loosely typed Prisma arguments */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #835: visiting club invites. Who may send, read and decide; what the link does and does not grant; what an approval
 * creates and that it happens exactly once; what the emails and the audit trail may contain. The fake database keeps
 * rows in memory and the outbox is the local capture: nothing leaves the process and no real person exists. Synthetic
 * data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  isAccountEmailConfigured: vi.fn(),
  processAccountEmailQueue: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/communications/account-email", () => ({
  AccountEmailNotConfiguredError: class extends Error {},
  getAccountEmailSender: () => ({ name: "IMAdventist", address: "events@imsda.test", replyTo: null }),
  isAccountEmailConfigured: mocks.isAccountEmailConfigured,
}));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: mocks.processAccountEmailQueue }));

import { AccessDeniedError, type AuthenticatedUser } from "@/modules/access/authorization";
import { hashOpaqueToken } from "@/modules/access/tokens";
import { visitingClubRequestInputSchema } from "@/modules/visiting-clubs/domain";
import {
  VISITING_CLUB_LINK_SENTINEL,
  prepareVisitingInviteBodyForDelivery,
  retireVisitingInviteForMessage,
} from "@/modules/visiting-clubs/email";
import {
  VisitingClubError,
  cancelVisitingClubInvite,
  countWaitingVisitingClubRequests,
  createVisitingClubInvite,
  decideVisitingClubRequest,
  getVisitingClubRequest,
  listVisitingClubEventOptions,
  listVisitingClubInvites,
  listVisitingClubRequests,
  submitVisitingClubRequest,
  viewVisitingInvite,
} from "@/modules/visiting-clubs/repository";

const systemAdmin: AuthenticatedUser = { id: "user-admin", email: "admin@imsda-events.test", displayName: "Alex Admin", globalRole: "SYSTEM_ADMIN" } as AuthenticatedUser;
const clubsAdmin: AuthenticatedUser = { id: "user-clubs", email: "clubs@imsda-events.test", displayName: "Cam ClubsAdmin", globalRole: null } as AuthenticatedUser;
const areaCoordinator: AuthenticatedUser = { id: "user-area", email: "area@imsda-events.test", displayName: "Ari Area", globalRole: null } as AuthenticatedUser;

const NOW = new Date("2027-02-01T15:00:00Z");
const TOKEN = "synthetic-token-one";
const account = { id: "acct-1", verifiedEmail: "vera.visitor@example.test", displayName: "Vera Visitor" };

function answers(overrides: Record<string, unknown> = {}) {
  return visitingClubRequestInputSchema.parse({
    clubName: "Synthetic Out-of-State Eagles",
    clubType: "PATHFINDER",
    homeConference: "Synthetic Conference",
    homeChurch: "Synthetic Home Church",
    directorPhone: "(515) 555-0100",
    screeningConfirmed: true,
    ...overrides,
  });
}

function fakeDatabase() {
  const events = new Map<string, any>([
    ["event-1", { id: "event-1", name: "Synthetic Camporee", startsAt: new Date("2027-04-10T15:00:00Z"), endsAt: new Date("2027-04-12T15:00:00Z"), isPublished: true, archivedAt: null, audience: "CLUB", billingMode: "DEFERRED_ORGANIZATION_INVOICE" }],
    ["event-general", { id: "event-general", name: "Synthetic Family Weekend", startsAt: new Date("2027-04-10T15:00:00Z"), endsAt: new Date("2027-04-12T15:00:00Z"), isPublished: true, archivedAt: null, audience: "GENERAL", billingMode: "PAY_ONLINE" }],
  ]);
  const accounts = new Map<string, any>([["acct-1", { id: "acct-1", disabledAt: null }], ["acct-gone", { id: "acct-gone", disabledAt: new Date() }]]);
  const invites: any[] = [];
  const requests: any[] = [];
  const organizations: any[] = [];
  const grants: any[] = [];
  const outbox: any[] = [];
  const clubsAdminGrants = new Map<string, { revokedAt: Date | null }>();
  let sequence = 0;
  const next = (prefix: string) => `${prefix}-${++sequence}`;
  const gateOk = (event: any, where: any) => event
    && event.id === where.id
    && event.isPublished === where.isPublished
    && event.archivedAt === where.archivedAt
    && event.audience === where.audience
    && event.billingMode === where.billingMode;

  const tx: any = {
    event: {
      findFirst: vi.fn(async ({ where }: any) => { const event = events.get(where.id); return gateOk(event, where) ? event : null; }),
      findMany: vi.fn(async ({ where }: any) => [...events.values()].filter((event) => event.audience === where.audience && event.archivedAt === where.archivedAt && event.endsAt >= where.endsAt.gte)),
    },
    attendeeAccount: { findUnique: vi.fn(async ({ where }: any) => accounts.get(where.id) ?? null) },
    visitingClubInvite: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: next("inv"), tokenHash: null, messageId: null, usedAt: null, cancelledAt: null, createdAt: NOW, ...data };
        invites.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: any) => { Object.assign(invites.find((row) => row.id === where.id), data); return {}; }),
      findUnique: vi.fn(async ({ where }: any) => {
        const row = invites.find((candidate) => (where.tokenHash ? candidate.tokenHash === where.tokenHash : candidate.messageId === where.messageId));
        return row ? { ...row, event: { name: events.get(row.eventId).name } } : null;
      }),
      findMany: vi.fn(async () => invites.map((row) => ({ ...row, event: { name: events.get(row.eventId).name } }))),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matches = invites.filter((row) => (where.id === undefined || row.id === where.id)
          && (where.messageId === undefined || row.messageId === where.messageId)
          && (where.usedAt === undefined || row.usedAt === where.usedAt)
          && (where.cancelledAt === undefined || row.cancelledAt === where.cancelledAt)
          && (where.expiresAt === undefined || row.expiresAt > where.expiresAt.gt));
        for (const row of matches) Object.assign(row, data);
        return { count: matches.length };
      }),
    },
    visitingClubRequest: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: next("req"), status: "PENDING", decidedByUserId: null, decidedAt: null, declineReason: null, createdOrganizationId: null, createdAt: new Date(NOW.getTime() + sequence * 1000), ...data };
        requests.push(row);
        return { id: row.id };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const row = requests.find((candidate) => candidate.id === where.id);
        return row ? { ...row, event: { id: row.eventId, name: events.get(row.eventId).name }, decidedBy: row.decidedByUserId ? { displayName: "Alex Admin" } : null } : null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const invite = invites.find((row) => row.tokenHash === where.invite.tokenHash);
        const row = invite && requests.find((candidate) => candidate.inviteId === invite.id && candidate.submittedByAccountId === where.submittedByAccountId);
        return row ? { status: row.status, event: { name: events.get(row.eventId).name } } : null;
      }),
      findMany: vi.fn(async ({ where }: any) => requests
        .filter((row) => (typeof where.status === "string" ? row.status === where.status : row.status !== where.status.not))
        .map((row) => ({ ...row, event: { id: row.eventId, name: events.get(row.eventId).name }, decidedBy: null }))),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = requests.find((candidate) => candidate.id === where.id && candidate.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => { Object.assign(requests.find((row) => row.id === where.id), data); return {}; }),
      count: vi.fn(async () => requests.filter((row) => row.status === "PENDING").length),
    },
    organization: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: next("org"), ...data };
        organizations.push(row);
        return { id: row.id };
      }),
    },
    clubDirectorGrant: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: next("grant"), ...data };
        grants.push(row);
        return { id: row.id };
      }),
    },
    clubsAdministratorGrant: {
      findFirst: vi.fn(async ({ where }: any) => {
        const grant = clubsAdminGrants.get(where.userId);
        return grant && grant.revokedAt === null ? { id: `grant-${where.userId}` } : null;
      }),
    },
    messageOutbox: { create: vi.fn(async ({ data }: any) => { outbox.push(data); return { id: `msg-${outbox.length}` }; }) },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
  return { prisma, events, accounts, invites, requests, organizations, grants, outbox, clubsAdminGrants };
}

let db: ReturnType<typeof fakeDatabase>;

/** An open invite with a known token, as if its email had been delivered. */
function openInvite(overrides: Record<string, unknown> = {}) {
  const row = { id: `inv-seed-${db.invites.length + 1}`, eventId: "event-1", email: account.verifiedEmail, name: "Vera", tokenHash: hashOpaqueToken(TOKEN), messageId: "msg-seed", usedAt: null, cancelledAt: null, createdAt: NOW, expiresAt: new Date(NOW.getTime() + 86_400_000), ...overrides };
  db.invites.push(row);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDatabase();
  db.clubsAdminGrants.set(clubsAdmin.id, { revokedAt: null });
  mocks.getPrisma.mockReturnValue(db.prisma);
  mocks.isAccountEmailConfigured.mockReturnValue(true);
  mocks.processAccountEmailQueue.mockResolvedValue(undefined);
});

describe("sending a link (#835)", () => {
  it("creates one link for one club event, lower-cases the address and queues an email that holds no token", async () => {
    await createVisitingClubInvite(systemAdmin, { eventId: "event-1", email: "Vera.Visitor@Example.test", name: "  Vera   Visitor " }, NOW);
    expect(db.invites).toHaveLength(1);
    expect(db.invites[0]).toMatchObject({ eventId: "event-1", email: "vera.visitor@example.test", name: "Vera Visitor", createdByUserId: "user-admin", tokenHash: null });
    expect(db.invites[0].expiresAt.getTime() - NOW.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0].bodyTextSnapshot).toContain(VISITING_CLUB_LINK_SENTINEL);
    expect(db.outbox[0].bodyTextSnapshot).not.toContain(db.invites[0].id);
    expect(db.invites[0].messageId).toBe("msg-1");
    expect(mocks.processAccountEmailQueue).toHaveBeenCalledWith({ messageIds: ["msg-1"] });
    const audit = mocks.writeAuditLog.mock.calls.map(([entry]) => entry);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("vera");
  });

  it("refuses an event that is archived, unpublished or not a church-billed club event", async () => {
    db.events.get("event-1").archivedAt = NOW;
    await expect(createVisitingClubInvite(systemAdmin, { eventId: "event-1", email: "v@example.test" }, NOW)).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    await expect(createVisitingClubInvite(systemAdmin, { eventId: "event-general", email: "v@example.test" }, NOW)).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    db.events.get("event-1").archivedAt = null;
    db.events.get("event-1").isPublished = false;
    await expect(createVisitingClubInvite(systemAdmin, { eventId: "event-1", email: "v@example.test" }, NOW)).rejects.toBeInstanceOf(VisitingClubError);
    expect(db.invites).toHaveLength(0);
  });

  it("says so when account email isn't set up, and queues nothing", async () => {
    mocks.isAccountEmailConfigured.mockReturnValue(false);
    await expect(createVisitingClubInvite(systemAdmin, { eventId: "event-1", email: "v@example.test" }, NOW)).rejects.toMatchObject({ code: "EMAIL_NOT_CONFIGURED" });
    expect(db.invites).toHaveLength(0);
  });

  it("offers only club events that are still ahead", async () => {
    const options = await listVisitingClubEventOptions(clubsAdmin, NOW);
    expect(options.map((option) => option.id)).toEqual(["event-1"]);
  });
});

describe("only a system administrator or Clubs Administrator may manage visiting clubs (#835)", () => {
  it("refuses everyone else on every staff function, including an Area Coordinator and a revoked Clubs Administrator", async () => {
    db.clubsAdminGrants.set("user-revoked", { revokedAt: NOW });
    const revoked = { id: "user-revoked", globalRole: null } as AuthenticatedUser;
    for (const actor of [areaCoordinator, revoked]) {
      await expect(createVisitingClubInvite(actor, { eventId: "event-1", email: "v@example.test" }, NOW)).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(cancelVisitingClubInvite(actor, "inv-1", NOW)).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(listVisitingClubInvites(actor, NOW)).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(listVisitingClubRequests(actor)).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(getVisitingClubRequest(actor, "req-1")).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(countWaitingVisitingClubRequests(actor)).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(listVisitingClubEventOptions(actor, NOW)).rejects.toBeInstanceOf(AccessDeniedError);
      await expect(decideVisitingClubRequest(actor, "req-1", { decision: "approve" }, NOW)).rejects.toBeInstanceOf(AccessDeniedError);
    }
    await expect(decideVisitingClubRequest(null, "req-1", { decision: "approve" }, NOW)).rejects.toMatchObject({ status: 401 });
    expect(db.organizations).toHaveLength(0);
    expect(db.invites).toHaveLength(0);
  });

  it("lets a Clubs Administrator and a system administrator act", async () => {
    await createVisitingClubInvite(clubsAdmin, { eventId: "event-1", email: "v@example.test" }, NOW);
    expect(db.invites).toHaveLength(1);
    await expect(listVisitingClubInvites(systemAdmin, NOW)).resolves.toHaveLength(1);
  });
});

describe("the link's states (#835)", () => {
  it("opens for the matching account while it is unused, unexpired and unwithdrawn", async () => {
    openInvite();
    await expect(viewVisitingInvite(TOKEN, account, NOW)).resolves.toMatchObject({ status: "READY", eventName: "Synthetic Camporee" });
  });

  it("is unusable once expired, withdrawn, used or unknown", async () => {
    const invite = openInvite({ expiresAt: new Date(NOW.getTime() - 1000) });
    await expect(viewVisitingInvite(TOKEN, account, NOW)).resolves.toEqual({ status: "UNAVAILABLE" });
    await expect(submitVisitingClubRequest(account, TOKEN, answers(), NOW)).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
    Object.assign(invite, { expiresAt: new Date(NOW.getTime() + 1000), cancelledAt: NOW });
    await expect(viewVisitingInvite(TOKEN, account, NOW)).resolves.toEqual({ status: "UNAVAILABLE" });
    Object.assign(invite, { cancelledAt: null, usedAt: NOW });
    await expect(viewVisitingInvite(TOKEN, account, NOW)).resolves.toEqual({ status: "UNAVAILABLE" });
    await expect(viewVisitingInvite("not-a-token", account, NOW)).resolves.toEqual({ status: "UNAVAILABLE" });
    await expect(viewVisitingInvite("x".repeat(500), account, NOW)).resolves.toEqual({ status: "UNAVAILABLE" });
    expect(db.requests).toHaveLength(0);
  });

  it("shows a different account only that the link went to another address", async () => {
    openInvite();
    const other = { ...account, id: "acct-2", verifiedEmail: "someone.else@example.test" };
    expect(await viewVisitingInvite(TOKEN, other, NOW)).toEqual({ status: "EMAIL_MISMATCH" });
    await expect(submitVisitingClubRequest(other, TOKEN, answers(), NOW)).rejects.toMatchObject({ code: "EMAIL_MISMATCH" });
    expect(db.requests).toHaveLength(0);
    expect(db.invites[0].usedAt).toBeNull();
  });

  it("can be withdrawn once, and a used link can't be", async () => {
    await createVisitingClubInvite(systemAdmin, { eventId: "event-1", email: "v@example.test" }, NOW);
    const id = db.invites[0].id;
    await cancelVisitingClubInvite(systemAdmin, id, NOW);
    expect(db.invites[0]).toMatchObject({ cancelledAt: NOW, tokenHash: null });
    await expect(cancelVisitingClubInvite(systemAdmin, id, NOW)).rejects.toMatchObject({ code: "INVITE_NOT_FOUND" });
    const records = await listVisitingClubInvites(systemAdmin, NOW);
    expect(records[0].state).toBe("CANCELLED");
  });

  it("mints the token at delivery, stores only its hash, and refuses a link that was withdrawn meanwhile", async () => {
    const invite = openInvite({ tokenHash: null, messageId: "msg-9" });
    const prepared = await prepareVisitingInviteBodyForDelivery({ messageId: "msg-9", bodyText: `Open:\n${VISITING_CLUB_LINK_SENTINEL}`, now: NOW });
    const url = prepared.bodyText.split("\n")[1];
    expect(url).toMatch(/^https:\/\/events\.imsda\.test\/account\/visiting-club\/[A-Za-z0-9_-]{40,}$/);
    const token = decodeURIComponent(url.split("/").pop()!);
    expect(invite.tokenHash).toBe(hashOpaqueToken(token));
    expect(JSON.stringify(invite)).not.toContain(token);
    // A definitive failure withdraws the link.
    await (prepared as { revokeOnDefinitiveFailure: () => Promise<void> }).revokeOnDefinitiveFailure();
    expect(invite).toMatchObject({ cancelledAt: NOW, tokenHash: null });
    await expect(prepareVisitingInviteBodyForDelivery({ messageId: "msg-9", bodyText: VISITING_CLUB_LINK_SENTINEL, now: NOW })).rejects.toThrow(/withdrawn, used or has expired/);
  });

  it("retires the link of a message that finally failed, and only an unused one", async () => {
    openInvite({ messageId: "msg-fail" });
    expect(await retireVisitingInviteForMessage(db.prisma as any, "msg-fail", NOW)).toBe(1);
    expect(await retireVisitingInviteForMessage(db.prisma as any, "msg-fail", NOW)).toBe(0);
  });
});

describe("the director's request (#835)", () => {
  it("creates a waiting request and nothing else: no club, no grant, and the link is used up", async () => {
    openInvite();
    const { id } = await submitVisitingClubRequest(account, TOKEN, answers({ clubName: "  Synthetic   Eagles " }), NOW);
    expect(db.requests).toHaveLength(1);
    expect(db.requests[0]).toMatchObject({
      id, status: "PENDING", eventId: "event-1", submittedByAccountId: "acct-1", clubName: "Synthetic Eagles",
      directorName: "Vera Visitor", directorEmail: "vera.visitor@example.test", directorPhone: "(515) 555-0100", screeningConfirmedAt: NOW,
    });
    expect(db.invites[0].usedAt).toEqual(NOW);
    expect(db.organizations).toHaveLength(0);
    expect(db.grants).toHaveLength(0);
    const audit = mocks.writeAuditLog.mock.calls.map(([entry]) => entry);
    expect(audit.map((entry) => entry.action)).toEqual(["VISITING_CLUB_REQUEST_SUBMITTED"]);
    expect(JSON.stringify(audit)).not.toMatch(/Vera|vera\.|555|Eagles|Synthetic Conference/);
  });

  it("shows the confirmation to the account that sent it, after the link is used, and a 404 to everyone else", async () => {
    openInvite();
    await submitVisitingClubRequest(account, TOKEN, answers(), NOW);
    expect(await viewVisitingInvite(TOKEN, account, NOW)).toEqual({ status: "SENT", eventName: "Synthetic Camporee", requestStatus: "PENDING" });
    expect(await viewVisitingInvite(TOKEN, { ...account, id: "acct-2", verifiedEmail: "someone.else@example.test" }, NOW)).toEqual({ status: "UNAVAILABLE" });
    expect(await viewVisitingInvite("not-a-token", account, NOW)).toEqual({ status: "UNAVAILABLE" });
  });

  it("can't be replayed: the second submit on one link is refused and creates nothing", async () => {
    openInvite();
    await submitVisitingClubRequest(account, TOKEN, answers(), NOW);
    await expect(submitVisitingClubRequest(account, TOKEN, answers(), NOW)).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
    expect(db.requests).toHaveLength(1);
  });

  it("loses a race on the claim without creating a second request", async () => {
    openInvite();
    // Another submission claims the link between this one's read and its claim.
    const original = db.prisma.visitingClubInvite.updateMany.getMockImplementation()!;
    db.prisma.visitingClubInvite.updateMany.mockImplementationOnce(async (args: any) => { await original({ where: { id: args.where.id, usedAt: null }, data: { usedAt: NOW } }); return original(args); });
    await expect(submitVisitingClubRequest(account, TOKEN, answers(), NOW)).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
    expect(db.requests).toHaveLength(0);
  });

  it("re-checks the event: an archived or no-longer-club event refuses and leaves the link unused", async () => {
    openInvite();
    db.events.get("event-1").archivedAt = NOW;
    await expect(submitVisitingClubRequest(account, TOKEN, answers(), NOW)).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    expect(await viewVisitingInvite(TOKEN, account, NOW)).toEqual({ status: "UNAVAILABLE" });
    db.events.get("event-1").archivedAt = null;
    db.events.get("event-1").audience = "GENERAL";
    await expect(submitVisitingClubRequest(account, TOKEN, answers(), NOW)).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    expect(db.requests).toHaveLength(0);
    expect(db.invites[0].usedAt).toBeNull();
  });

  it("lets a director who already runs another club ask for another, taking the event from the link and never the form", async () => {
    // The account may already hold a grant on a conference club; nothing about that blocks the request.
    db.grants.push({ id: "grant-existing", organizationId: "org-conference", attendeeAccountId: "acct-1", role: "DIRECTOR" });
    openInvite();
    await submitVisitingClubRequest(account, TOKEN, answers(), NOW);
    expect(db.requests).toHaveLength(1);
    expect(db.requests[0].eventId).toBe("event-1");
    expect(visitingClubRequestInputSchema.safeParse({ ...answers(), eventId: "event-other" }).success).toBe(false);
  });
});

describe("deciding a request (#835)", () => {
  async function waitingRequest() {
    openInvite();
    const { id } = await submitVisitingClubRequest(account, TOKEN, answers(), NOW);
    vi.clearAllMocks();
    mocks.processAccountEmailQueue.mockResolvedValue(undefined);
    return id;
  }

  it("approving creates a guest club with no sponsoring church, the director's grant, ids-only audit and a notice", async () => {
    const id = await waitingRequest();
    const result = await decideVisitingClubRequest(systemAdmin, id, { decision: "approve" }, NOW);
    expect(result.status).toBe("APPROVED");
    expect(db.organizations).toHaveLength(1);
    expect(db.organizations[0]).toMatchObject({
      type: "CLUB", name: "Synthetic Out-of-State Eagles", parentOrganizationId: null, guestEventId: "event-1", isActive: true, sourceOrgType: "Visiting Pathfinder Club",
    });
    expect(db.requests[0]).toMatchObject({ status: "APPROVED", createdOrganizationId: result.organizationId, decidedByUserId: "user-admin" });
    expect(db.grants).toEqual([expect.objectContaining({ organizationId: result.organizationId, attendeeAccountId: "acct-1", role: "DIRECTOR", reason: "Approved visiting club request.", grantedByUserId: "user-admin" })]);
    const audit = mocks.writeAuditLog.mock.calls.map(([entry]) => entry);
    expect(audit.map((entry) => entry.action)).toEqual(["ORGANIZATION_CREATED", "VISITING_CLUB_REQUEST_APPROVED"]);
    expect(JSON.stringify(audit)).not.toMatch(/Vera|vera\.|555|Eagles/);
    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0]).toMatchObject({ templateKey: "VISITING_CLUB_APPROVED", recipientEmail: "vera.visitor@example.test" });
    expect(db.outbox[0].bodyTextSnapshot).toContain("https://events.imsda.test/account");
    expect(mocks.processAccountEmailQueue).toHaveBeenCalledTimes(1);
  });

  it("labels an Adventurer request as a visiting Adventurer club", async () => {
    openInvite({ id: "inv-adv", tokenHash: hashOpaqueToken("token-adv") });
    const { id } = await submitVisitingClubRequest(account, "token-adv", answers({ clubType: "ADVENTURER" }), NOW);
    await decideVisitingClubRequest(clubsAdmin, id, { decision: "approve" }, NOW);
    expect(db.organizations[0].sourceOrgType).toBe("Visiting Adventurer Club");
  });

  it("a second approval, or a decline after an approval, gets ALREADY_DECIDED and creates nothing twice", async () => {
    const id = await waitingRequest();
    await decideVisitingClubRequest(systemAdmin, id, { decision: "approve" }, NOW);
    await expect(decideVisitingClubRequest(systemAdmin, id, { decision: "approve" }, NOW)).rejects.toMatchObject({ code: "ALREADY_DECIDED" });
    await expect(decideVisitingClubRequest(clubsAdmin, id, { decision: "decline" }, NOW)).rejects.toMatchObject({ code: "ALREADY_DECIDED" });
    expect(db.organizations).toHaveLength(1);
    expect(db.grants).toHaveLength(1);
  });

  it("loses a race on the claim without creating a club", async () => {
    const id = await waitingRequest();
    const original = db.prisma.visitingClubRequest.updateMany.getMockImplementation()!;
    db.prisma.visitingClubRequest.updateMany.mockImplementationOnce(async (args: any) => { await original({ where: { id, status: "PENDING" }, data: { status: "APPROVED" } }); return original(args); });
    await expect(decideVisitingClubRequest(systemAdmin, id, { decision: "approve" }, NOW)).rejects.toMatchObject({ code: "ALREADY_DECIDED" });
    expect(db.organizations).toHaveLength(0);
  });

  it("declining emails the director with the reason and keeps the reason out of the audit trail", async () => {
    const id = await waitingRequest();
    const result = await decideVisitingClubRequest(clubsAdmin, id, { decision: "decline", declineReason: "We are full for {{this}} year." }, NOW);
    expect(result).toEqual({ status: "DECLINED", organizationId: null });
    expect(db.requests[0]).toMatchObject({ status: "DECLINED", declineReason: "We are full for {{this}} year." });
    expect(db.organizations).toHaveLength(0);
    expect(db.grants).toHaveLength(0);
    expect(db.outbox[0]).toMatchObject({ templateKey: "VISITING_CLUB_DECLINED", recipientEmail: "vera.visitor@example.test" });
    expect(db.outbox[0].bodyTextSnapshot).toContain("We are full for { {this} } year.");
    const audit = mocks.writeAuditLog.mock.calls.map(([entry]) => entry);
    expect(audit.map((entry) => entry.action)).toEqual(["VISITING_CLUB_REQUEST_DECLINED"]);
    expect(JSON.stringify(audit)).not.toContain("full for");
  });

  it("refuses a reason that is too long", async () => {
    const id = await waitingRequest();
    await expect(decideVisitingClubRequest(systemAdmin, id, { decision: "decline", declineReason: "x".repeat(501) }, NOW)).rejects.toMatchObject({ code: "INVALID_REASON" });
    expect(db.requests[0].status).toBe("PENDING");
  });

  it("re-checks the event and the account at approval time", async () => {
    const id = await waitingRequest();
    db.events.get("event-1").archivedAt = NOW;
    await expect(decideVisitingClubRequest(systemAdmin, id, { decision: "approve" }, NOW)).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    db.events.get("event-1").archivedAt = null;
    db.requests[0].submittedByAccountId = "acct-gone";
    await expect(decideVisitingClubRequest(systemAdmin, id, { decision: "approve" }, NOW)).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
    expect(db.requests[0].status).toBe("PENDING");
    expect(db.organizations).toHaveLength(0);
  });

  it("answers an unknown request with REQUEST_NOT_FOUND", async () => {
    await expect(decideVisitingClubRequest(systemAdmin, "nope", { decision: "approve" }, NOW)).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
  });

  it("lists waiting requests first and counts them", async () => {
    const id = await waitingRequest();
    openInvite({ id: "inv-2", tokenHash: hashOpaqueToken("token-two") });
    const second = await submitVisitingClubRequest(account, "token-two", answers({ clubName: "Second Synthetic Club" }), NOW);
    await decideVisitingClubRequest(systemAdmin, id, { decision: "approve" }, NOW);
    const list = await listVisitingClubRequests(systemAdmin);
    expect(list.map((row) => row.id)).toEqual([second.id, id]);
    expect(await countWaitingVisitingClubRequests(systemAdmin)).toBe(1);
    expect((await getVisitingClubRequest(systemAdmin, id))?.createdOrganizationId).toBe(db.organizations[0].id);
  });
});
