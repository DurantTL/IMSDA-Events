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
}));

const client = {
  attendeeAccount: { findMany: mocks.accountFindMany },
  areaCoordinatorInvite: {
    findFirst: mocks.inviteFindFirst,
    findMany: mocks.inviteFindMany,
    create: mocks.inviteCreate,
    update: mocks.inviteUpdate,
    updateMany: mocks.inviteUpdateMany,
    count: mocks.inviteCount,
  },
  messageOutbox: { create: mocks.outboxCreate },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
};

vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/communications/queued-invite-delivery", () => ({ deliverQueuedInviteEmailsAfterResponse: mocks.deliverAfter }));
vi.mock("@/modules/communications/account-email", () => ({
  isAccountEmailConfigured: mocks.configured,
  getAccountEmailSender: () => ({ name: "IMAdventist", address: "events@example.test", replyTo: null }),
}));

import { POST as importRoute } from "@/app/api/admin/area-coordinator-invites/import/route";
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
  mocks.outboxCreate.mockImplementation(async () => ({ id: "msg-1" }));
  signInAs("SYSTEM_ADMIN");
});

describe("Area Coordinator import and send routes (#1608)", () => {
  it.each(["signedOut", null] as const)("refuses %s on all three routes", async (who) => {
    signInAs(who);
    const responses = [
      await importRoute(post("/api/admin/area-coordinator-invites/import", { csv, confirm: false })),
      await sendRoute(post("/api/admin/area-coordinator-invites/send", {})),
      await templateRoute(new Request("https://events.imsda.test/api/admin/area-coordinator-invites/template")),
    ];
    expect(responses.map((response) => response.status)).toEqual(who === "signedOut" ? [401, 401, 401] : [403, 403, 403]);
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
    expect(audit.metadata).toEqual({ count: 2, rows: 2 });
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
    const response = await sendRoute(post("/api/admin/area-coordinator-invites/send", {}));
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
    const response = await sendRoute(post("/api/admin/area-coordinator-invites/send", {}));
    expect(response.status).toBe(409);
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("send is refused when account email is not set up, and when nothing is waiting", async () => {
    mocks.configured.mockReturnValue(false);
    const refused = await sendRoute(post("/api/admin/area-coordinator-invites/send", {}));
    expect(refused.status).toBe(503);
    expect((await refused.json()).error).toBe("EMAIL_NOT_CONFIGURED");
    mocks.configured.mockReturnValue(true);
    const empty = await sendRoute(post("/api/admin/area-coordinator-invites/send", {}));
    expect((await empty.json()).error).toBe("NOTHING_TO_SEND");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
