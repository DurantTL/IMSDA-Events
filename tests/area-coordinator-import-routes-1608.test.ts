import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1608: the import and send routes. The real gates and modules run; the session, database and mail are faked. Synthetic data only. */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  configured: vi.fn(),
  writeAuditLog: vi.fn(),
  deliverAfter: vi.fn(),
  accountFindMany: vi.fn(),
  inviteFindFirst: vi.fn(),
  inviteFindMany: vi.fn(),
  inviteCreate: vi.fn(),
  inviteUpdate: vi.fn(),
  inviteUpdateMany: vi.fn(),
  inviteCount: vi.fn(),
  outboxCreate: vi.fn(),
  clubsGrantFindFirst: vi.fn(),
}));

const client = {
  user: { findUnique: async () => ({ globalRole: null }) },
  attendeeAccount: { findMany: mocks.accountFindMany },
  areaCoordinatorInvite: {
    findFirst: mocks.inviteFindFirst,
    findMany: mocks.inviteFindMany,
    create: mocks.inviteCreate,
    update: mocks.inviteUpdate,
    updateMany: mocks.inviteUpdateMany,
    count: mocks.inviteCount,
  },
  clubsAdministratorGrant: { findFirst: mocks.clubsGrantFindFirst },
  messageOutbox: { create: mocks.outboxCreate },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/communications/queued-invite-delivery", () => ({ deliverQueuedInviteEmailsAfterResponse: mocks.deliverAfter }));
vi.mock("@/modules/communications/account-email", () => ({
  isAccountEmailConfigured: mocks.configured,
  getAccountEmailSender: () => ({ name: "IMAdventist", address: "events@example.test", replyTo: null }),
}));

import { POST as importRoute } from "@/app/api/admin/area-coordinator-invites/import/route";
import { resendAreaCoordinatorInvite } from "@/modules/organizations/area-coordinator-invites";
import { listPendingInvites } from "@/modules/system-admin/pending-invites";
import { POST as sendRoute } from "@/app/api/admin/area-coordinator-invites/send/route";
import { GET as templateRoute } from "@/app/api/admin/area-coordinator-invites/template/route";

const post = (url: string, body: unknown) => new Request(`https://events.imsda.test${url}`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://events.imsda.test" },
  body: JSON.stringify(body),
});
const csv = "First name,Last name,Email\nPat,Example,pat@example.test\nSam,Example,sam@example.test\n";

function signInAs(role: "SYSTEM_ADMIN" | null | "signedOut") {
  mocks.getCurrentSession.mockResolvedValue(role === "signedOut" ? { user: null } : { user: { id: "u-1", email: "admin@example.test", displayName: "Admin", globalRole: role } });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.configured.mockReturnValue(true);
  mocks.accountFindMany.mockResolvedValue([]);
  mocks.inviteFindFirst.mockResolvedValue(null);
  mocks.inviteFindMany.mockResolvedValue([]);
  mocks.inviteCreate.mockImplementation(async ({ data }: { data: { email: string } }) => ({ id: `inv-${data.email}` }));
  mocks.inviteUpdateMany.mockResolvedValue({ count: 1 });
  mocks.clubsGrantFindFirst.mockResolvedValue(null);
  mocks.outboxCreate.mockImplementation(async () => ({ id: "msg-1" }));
  signInAs("SYSTEM_ADMIN");
});

describe("Area Coordinator import and send routes (#1608)", () => {
  it.each(["signedOut", null] as const)("refuses %s on all three routes", async (who) => {
    signInAs(who);
    const responses = [
      await importRoute(post("/api/admin/area-coordinator-invites/import", { csv, confirm: false })),
      await sendRoute(post("/api/admin/area-coordinator-invites/send", { expectedCount: 2 })),
      await templateRoute(new Request("https://events.imsda.test/api/admin/area-coordinator-invites/template")),
    ];
    expect(responses.map((response) => response.status)).toEqual(who === "signedOut" ? [401, 401, 401] : [403, 403, 403]);
    expect(mocks.inviteCreate).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("refuses a Clubs Administrator who is not a system administrator on all three routes", async () => {
    signInAs(null);
    mocks.clubsGrantFindFirst.mockResolvedValue({ id: "grant-1" });
    const responses = [
      await importRoute(post("/api/admin/area-coordinator-invites/import", { csv, confirm: true })),
      await sendRoute(post("/api/admin/area-coordinator-invites/send", { expectedCount: 2 })),
      await templateRoute(new Request("https://events.imsda.test/api/admin/area-coordinator-invites/template")),
    ];
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    expect(mocks.inviteCreate).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin import and send", async () => {
    const cross = (url: string, body: unknown) => new Request(`https://events.imsda.test${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.test" },
      body: JSON.stringify(body),
    });
    expect((await importRoute(cross("/api/admin/area-coordinator-invites/import", { csv, confirm: true }))).status).toBe(403);
    expect((await sendRoute(cross("/api/admin/area-coordinator-invites/send", { expectedCount: 2 }))).status).toBe(403);
    expect(mocks.inviteCreate).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("previews without saving", async () => {
    const response = await importRoute(post("/api/admin/area-coordinator-invites/import", { csv, confirm: false }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.steps.map((step: { action: string }) => step.action)).toEqual(["ADD", "ADD"]);
    expect(mocks.inviteCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("saves every invite of the file with the chosen ministry (#843)", async () => {
    const response = await importRoute(post("/api/admin/area-coordinator-invites/import", { csv, confirm: true, ministries: ["ADVENTURER", "PATHFINDER"] }));
    expect(response.status).toBe(200);
    expect(mocks.inviteCreate.mock.calls.map((call) => call[0].data.ministries)).toEqual([["PATHFINDER", "ADVENTURER"], ["PATHFINDER", "ADVENTURER"]]);
    expect(mocks.writeAuditLog.mock.calls[0][0].metadata).toMatchObject({ ministries: ["PATHFINDER", "ADVENTURER"] });
  });

  it("refuses an empty, unknown or repeated ministry choice with 400 and saves nothing (#843)", async () => {
    for (const ministries of [[], ["DISTRICT"], ["ADVENTURER", "ADVENTURER"]]) {
      const response = await importRoute(post("/api/admin/area-coordinator-invites/import", { csv, confirm: true, ministries }));
      expect(response.status).toBe(400);
    }
    expect(mocks.inviteCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("skips active coordinators and open invites in the preview", async () => {
    mocks.accountFindMany.mockResolvedValue([{ id: "a-1", email: "pat@example.test", areaCoordinatorGrant: { revokedAt: null, expiresAt: null } }]);
    mocks.inviteFindMany.mockResolvedValue([{ email: "sam@example.test" }]);
    const body = await (await importRoute(post("/api/admin/area-coordinator-invites/import", { csv, confirm: false }))).json();
    expect(body.steps.map((step: { action: string }) => step.action)).toEqual(["SKIP", "SKIP"]);
  });

  it("does not skip a revoked grant", async () => {
    mocks.accountFindMany.mockResolvedValue([{ id: "a-1", email: "pat@example.test", areaCoordinatorGrant: { revokedAt: new Date("2026-01-01T00:00:00Z"), expiresAt: null } }]);
    const body = await (await importRoute(post("/api/admin/area-coordinator-invites/import", { csv, confirm: false }))).json();
    expect(body.steps[0].action).toBe("ADD");
  });

  it("confirm creates PENDING invites, queues no email, and audits the count only", async () => {
    const response = await importRoute(post("/api/admin/area-coordinator-invites/import", { csv, confirm: true }));
    expect(response.status).toBe(200);
    expect(mocks.inviteCreate).toHaveBeenCalledTimes(2);
    expect(mocks.inviteCreate.mock.calls[0][0].data).toMatchObject({ email: "pat@example.test", name: "Pat Example", status: "PENDING", createdByUserId: "u-1" });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
    expect(mocks.deliverAfter).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const audit = mocks.writeAuditLog.mock.calls[0][0];
    expect(audit.metadata).toEqual({ count: 2, rows: 2, ministries: ["PATHFINDER"] });
    expect(mocks.inviteCreate.mock.calls[0][0].data.ministries).toEqual(["PATHFINDER"]);
    expect(JSON.stringify(audit)).not.toMatch(/example\.test|Pat|Sam/);
  });

  it("running the same file again creates no duplicates", async () => {
    mocks.inviteFindMany.mockResolvedValue([{ email: "pat@example.test" }, { email: "sam@example.test" }]);
    const body = await (await importRoute(post("/api/admin/area-coordinator-invites/import", { csv, confirm: true }))).json();
    expect(body.added).toBe(0);
    expect(mocks.inviteCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("answers a lost unique-index race as a skip", async () => {
    const { Prisma } = await import("@prisma/client");
    mocks.inviteCreate.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    const body = await (await importRoute(post("/api/admin/area-coordinator-invites/import", { csv, confirm: true }))).json();
    expect(body.added).toBe(1);
    expect(body.steps[0].action).toBe("SKIP");
  });

  it("answers a bad file with a plain 400", async () => {
    const response = await importRoute(post("/api/admin/area-coordinator-invites/import", { csv: "Name\nPat\n", confirm: false }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_AREA_COORDINATOR_CSV");
  });

  it("send moves only PENDING invites, queues each email, and audits the count", async () => {
    mocks.inviteFindMany.mockResolvedValue([
      { id: "inv-1", email: "pat@example.test", name: "Pat Example" },
      { id: "inv-2", email: "sam@example.test", name: "Sam Example" },
    ]);
    const response = await sendRoute(post("/api/admin/area-coordinator-invites/send", { expectedCount: 2 }));
    expect(response.status).toBe(200);
    expect(mocks.inviteFindMany.mock.calls[0][0].where).toEqual({ status: "PENDING" });
    expect(mocks.inviteUpdateMany).toHaveBeenCalledTimes(2);
    for (const [args] of mocks.inviteUpdateMany.mock.calls) {
      expect(args.where.status).toBe("PENDING");
      expect(args.data).toMatchObject({ status: "SENT", sentCount: { increment: 1 } });
      expect(args.data.sentAt).toEqual(new Date("2026-11-05T15:00:00Z"));
      expect(args.data.expiresAt).toEqual(new Date("2026-11-19T15:00:00Z"));
    }
    expect(mocks.outboxCreate).toHaveBeenCalledTimes(2);
    expect(mocks.deliverAfter).toHaveBeenCalledWith(["msg-1", "msg-1"]);
    expect(mocks.writeAuditLog.mock.calls[0][0].metadata).toEqual({ count: 2 });
  });

  it("send skips an invite cancelled in the meantime", async () => {
    mocks.inviteFindMany.mockResolvedValue([{ id: "inv-1", email: "pat@example.test", name: "Pat Example" }]);
    mocks.inviteUpdateMany.mockResolvedValue({ count: 0 });
    const response = await sendRoute(post("/api/admin/area-coordinator-invites/send", { expectedCount: 2 }));
    expect(response.status).toBe(409);
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("send is refused when account email is not set up, and when nothing is waiting", async () => {
    mocks.configured.mockReturnValue(false);
    const refused = await sendRoute(post("/api/admin/area-coordinator-invites/send", { expectedCount: 2 }));
    expect(refused.status).toBe(503);
    expect((await refused.json()).error).toBe("EMAIL_NOT_CONFIGURED");
    mocks.configured.mockReturnValue(true);
    const empty = await sendRoute(post("/api/admin/area-coordinator-invites/send", { expectedCount: 2 }));
    expect((await empty.json()).error).toBe("NOTHING_TO_SEND");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("send sends nothing when the count changed since it was confirmed", async () => {
    mocks.inviteFindMany.mockResolvedValue([
      { id: "inv-1", email: "pat@example.test", name: "Pat Example" },
      { id: "inv-2", email: "sam@example.test", name: "Sam Example" },
      { id: "inv-3", email: "kim@example.test", name: "Kim Example" },
    ]);
    const response = await sendRoute(post("/api/admin/area-coordinator-invites/send", { expectedCount: 2 }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("LIST_CHANGED");
    expect(mocks.inviteUpdateMany).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("send needs the confirmed count", async () => {
    const response = await sendRoute(post("/api/admin/area-coordinator-invites/send", {}));
    expect(response.status).toBe(400);
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("send still audits the invites already sent when a later queue write fails", async () => {
    mocks.inviteFindMany.mockResolvedValue([
      { id: "inv-1", email: "pat@example.test", name: "Pat Example" },
      { id: "inv-2", email: "sam@example.test", name: "Sam Example" },
    ]);
    mocks.outboxCreate.mockResolvedValueOnce({ id: "msg-1" }).mockRejectedValueOnce(new Error("queue down"));
    const response = await sendRoute(post("/api/admin/area-coordinator-invites/send", { expectedCount: 2 }));
    expect(response.status).toBe(500);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog.mock.calls[0][0].metadata).toEqual({ count: 1 });
  });

  it("resend cannot email a PENDING invite, even for a Clubs Administrator", async () => {
    signInAs(null);
    mocks.clubsGrantFindFirst.mockResolvedValue({ id: "grant-1" });
    mocks.inviteFindFirst.mockResolvedValue(null);
    const findUnique = vi.fn(async () => ({ id: "inv-1", email: "pat@example.test", name: "Pat Example", status: "PENDING", sentAt: null }));
    (client.areaCoordinatorInvite as Record<string, unknown>).findUnique = findUnique;
    await expect(resendAreaCoordinatorInvite("inv-1", "u-1")).rejects.toMatchObject({ code: "INVITE_NOT_OPEN" });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
    expect(mocks.inviteUpdateMany).not.toHaveBeenCalled();
  });

  it("lists a PENDING invite as not sent yet with no sign-up link", async () => {
    mocks.inviteFindMany.mockImplementation(async () => [
      { id: "inv-1", email: "pat@example.test", name: "Pat Example", status: "PENDING", sentAt: null, createdAt: new Date("2026-11-05T14:00:00Z"), expiresAt: null },
      { id: "inv-2", email: "sam@example.test", name: "Sam Example", status: "SENT", sentAt: new Date("2026-11-05T14:30:00Z"), createdAt: new Date("2026-11-05T14:00:00Z"), expiresAt: null },
    ]);
    Object.assign(client, { clubInvite: { findMany: async () => [] }, user: { findMany: async () => [] } });
    const { invites } = await listPendingInvites({ scope: "clubs" });
    const pending = invites.find((entry) => entry.id === "inv-1")!;
    const sent = invites.find((entry) => entry.id === "inv-2")!;
    expect(pending.notSent).toBe(true);
    expect(pending.signUpUrl).toBeUndefined();
    expect(sent.signUpUrl).toBeDefined();
  });
});
