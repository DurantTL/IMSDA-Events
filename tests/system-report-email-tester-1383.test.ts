import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class AccountEmailNotConfiguredError extends Error {
    readonly code = "ACCOUNT_EMAIL_NOT_CONFIGURED";
  }
  return {
    AccountEmailNotConfiguredError,
    getCurrentSession: vi.fn(),
    getAccountEmailSender: vi.fn(),
    processAccountEmailQueue: vi.fn(),
    writeAuditLog: vi.fn(),
    logError: vi.fn(),
    outbox: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    providerEvents: { findMany: vi.fn() },
    emailLimitCalls: new Map<string, number>(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", async () => ({ ...(await vi.importActual<object>("@/lib/logger")), logError: mocks.logError }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ messageOutbox: mocks.outbox, messageProviderEvent: mocks.providerEvents }) }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({
  rejectCrossOriginRequest: (request: Request) => (
    request.headers.get("origin") === new URL(request.url).origin ? null : Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 })
  ),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/communications/account-email", () => ({
  AccountEmailNotConfiguredError: mocks.AccountEmailNotConfiguredError,
  getAccountEmailSender: mocks.getAccountEmailSender,
}));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: mocks.processAccountEmailQueue }));
vi.mock("@/modules/rate-limit/service", () => ({
  // Three allowed per user, then denied with half an hour left in the window.
  checkSystemEmailTestRateLimit: async (userId: string) => {
    const count = (mocks.emailLimitCalls.get(userId) ?? 0) + 1;
    mocks.emailLimitCalls.set(userId, count);
    return { allowed: count <= 3, decisions: [{ policy: "p", allowed: count <= 3, limit: 3, remaining: Math.max(0, 3 - count), count, windowSeconds: 3600, resetAfterSeconds: 1800 }] };
  },
  checkSystemSquareTestRateLimit: vi.fn(),
}));

import { GET, POST } from "@/app/api/admin/system-report/email-test/route";
import {
  EMAIL_NOTICE_WAIT_MS,
  EMAIL_TEST_REASONS,
  emailTestInputSchema,
  mapEmailTestStatus,
  readEmailTestStatus,
  runEmailTest,
  type EmailTestRow,
} from "@/modules/system-admin/system-report/email-tester";
import { SYSTEM_TEST_EMAIL_SUBJECT } from "@/modules/communications/system-test-email";

/** #1383: the System report's email tester. Synthetic data only; no provider is ever called. */

const now = new Date("2026-10-31T16:42:00.000Z");
const origin = "https://events.imsda.test";
const admin = { id: "user_admin_1", globalRole: "SYSTEM_ADMIN" };

function row(extra: Partial<EmailTestRow> = {}): EmailTestRow {
  return {
    id: "msg_test_1",
    status: "SENT",
    createdAt: new Date(now.getTime() - 1_000),
    sentAt: new Date(now.getTime() - 500),
    provider: "RESEND",
    providerDeliveryStatus: "ACCEPTED",
    providerStatusAt: new Date(now.getTime() - 500),
    deliveredAt: null,
    failedAt: null,
    metadata: { trigger: "SYSTEM_REPORT_TEST", testRef: "T-7Q2K", testedByUserId: admin.id },
    ...extra,
  };
}

function post(body: unknown, headers: Record<string, string> = { origin }) {
  return POST(new Request(`${origin}/api/admin/system-report/email-test`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.emailLimitCalls.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.getCurrentSession.mockResolvedValue({ user: admin });
  mocks.getAccountEmailSender.mockReturnValue({ name: "IMSDA Events", address: "events@example.org", replyTo: null });
  mocks.outbox.create.mockResolvedValue({ id: "msg_test_1" });
  mocks.outbox.updateMany.mockResolvedValue({ count: 0 });
  mocks.outbox.findFirst.mockResolvedValue(row());
  mocks.providerEvents.findMany.mockResolvedValue([]);
  mocks.processAccountEmailQueue.mockResolvedValue({ recoveredIds: [], sentIds: ["msg_test_1"], failedIds: [], rescheduledIds: [] });
  mocks.writeAuditLog.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe("email tester: the backup option (#1444)", () => {
  it("answers 409 and queues nothing when the backup email service is not set up on this server", async () => {
    const response = await post({ to: "me@example.org", backup: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "BACKUP_NOT_CONFIGURED" });
    expect(mocks.outbox.create).not.toHaveBeenCalled();
    expect(mocks.processAccountEmailQueue).not.toHaveBeenCalled();
  });
});

describe("email tester: who may use it", () => {
  it("rejects a cross-origin request before anything else", async () => {
    const response = await post({ to: "me@example.org" }, { origin: "https://evil.test" });
    expect(response.status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(mocks.outbox.create).not.toHaveBeenCalled();
  });

  it("answers 403 to signed-out visitors and every role but system administrator, for send and for status", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({ user: null });
    expect((await post({ to: "me@example.org" })).status).toBe(403);
    for (const globalRole of ["CLUBS_ADMIN", "EVENT_ADMIN", "USER"]) {
      mocks.getCurrentSession.mockResolvedValue({ user: { id: "u9", globalRole } });
      expect((await post({ to: "me@example.org" })).status).toBe(403);
      expect((await GET(new Request(`${origin}/api/admin/system-report/email-test?id=msg_test_1`))).status).toBe(403);
    }
    expect(mocks.outbox.create).not.toHaveBeenCalled();
    expect(mocks.processAccountEmailQueue).not.toHaveBeenCalled();
    expect(mocks.outbox.findFirst).not.toHaveBeenCalled();
  });
});

describe("email tester: sending", () => {
  it("accepts exactly one valid address", () => {
    expect(emailTestInputSchema.safeParse({ to: " Admin@Example.org " }).success).toBe(true);
    for (const to of ["a@example.org, b@example.org", "a@example.org b@example.org", "not-an-address", "", "a@example.org;b@example.org"]) {
      expect(emailTestInputSchema.safeParse({ to }).success, to).toBe(false);
    }
    expect(emailTestInputSchema.safeParse({ to: "a@example.org", extra: 1 }).success).toBe(false);
  });

  it("queues one eventless TEST row with the new key, delivers it now through the account queue, and audits ids only", async () => {
    const response = await post({ to: "Admin@Example.org" });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(mocks.outbox.create).toHaveBeenCalledTimes(1);
    const data = mocks.outbox.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      eventId: null,
      templateKey: "SYSTEM_TEST_EMAIL",
      recipientKind: "TEST",
      recipientEmail: "admin@example.org",
      senderEmailSnapshot: "events@example.org",
      subjectSnapshot: SYSTEM_TEST_EMAIL_SUBJECT,
      status: "PENDING",
    });
    expect(data.accountUserId).toBeUndefined();
    expect(data.metadata).toMatchObject({ trigger: "SYSTEM_REPORT_TEST", realDelivery: true, testedByUserId: admin.id });
    expect(data.bodyTextSnapshot).toMatch(/test email from the IMSDA Events System report/);
    expect(data.bodyTextSnapshot).not.toMatch(/https?:|\{\{/);
    expect(mocks.processAccountEmailQueue).toHaveBeenCalledWith({ messageIds: ["msg_test_1"], limit: 1 });

    const audit = mocks.writeAuditLog.mock.calls[0][0];
    expect(audit).toMatchObject({ action: "SYSTEM_REPORT_EMAIL_TEST", actorUserId: admin.id, entityType: "MessageOutbox", entityId: "msg_test_1" });
    expect(JSON.stringify(audit)).not.toMatch(/admin@example\.org/i);
    const body = await response.json();
    expect(body.status).toMatchObject({ testId: "msg_test_1", ref: "T-7Q2K", state: "waiting", provider: "Resend" });
  });

  it("answers 400 for a bad address without charging the limit or sending", async () => {
    expect((await post({ to: "a@example.org, b@example.org" })).status).toBe(400);
    expect(mocks.outbox.create).not.toHaveBeenCalled();
    expect(mocks.emailLimitCalls.size).toBe(0);
  });

  it("limits each administrator to 3 an hour: the 4th is a 429 with the time the next is allowed", async () => {
    for (let index = 0; index < 3; index += 1) expect((await post({ to: "me@example.org" })).status).toBe(201);
    const fourth = await post({ to: "me@example.org" });
    expect(fourth.status).toBe(429);
    const body = await fourth.json();
    expect(body).toMatchObject({ error: "RATE_LIMITED", nextAllowedAt: new Date(now.getTime() + 1800 * 1000).toISOString() });
    expect(fourth.headers.get("retry-after")).toBe("1800");
    expect(mocks.outbox.create).toHaveBeenCalledTimes(3);
    // Another administrator has their own budget.
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user_admin_2", globalRole: "SYSTEM_ADMIN" } });
    expect((await post({ to: "me@example.org" })).status).toBe(201);
  });

  it("says email is not set up when there is no account sender, and queues nothing", async () => {
    mocks.getAccountEmailSender.mockImplementation(() => {
      throw new mocks.AccountEmailNotConfiguredError("Set ACCOUNT_EMAIL_SENDER_ADDRESS");
    });
    const response = await post({ to: "me@example.org" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "EMAIL_NOT_CONFIGURED", message: "Email sending is not set up on this server." });
    expect(mocks.outbox.create).not.toHaveBeenCalled();
  });

  it("closes a test the loop left pending, so it never sends later, and reports it as unavailable", async () => {
    mocks.processAccountEmailQueue.mockRejectedValue(new Error("secret provider text re_live_key"));
    mocks.outbox.updateMany.mockResolvedValue({ count: 1 });
    mocks.outbox.findFirst.mockResolvedValue(row({ status: "CANCELLED", sentAt: null, provider: null, providerDeliveryStatus: null, failedAt: now }));
    const result = await runEmailTest({ user: admin, body: { to: "me@example.org" }, now });
    expect(mocks.outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "msg_test_1", status: "PENDING" }, data: expect.objectContaining({ status: "CANCELLED" }) }));
    expect(result).toMatchObject({ kind: "started", status: { state: "unavailable", reason: EMAIL_TEST_REASONS["not-sent"], final: true } });
    expect(JSON.stringify(result)).not.toMatch(/secret provider|re_live_key/);
  });
});

describe("email tester: a worker still holding the row", () => {
  it("never cancels a PROCESSING row and keeps the card polling", async () => {
    mocks.outbox.findFirst.mockResolvedValue(row({ status: "PROCESSING", sentAt: null, provider: null, providerDeliveryStatus: null }));
    const result = await runEmailTest({ user: admin, body: { to: "me@example.org" }, now });
    for (const call of mocks.outbox.updateMany.mock.calls) expect(call[0].where.status).toBe("PENDING");
    expect(result).toMatchObject({ kind: "started", status: { state: "queued", final: false } });
  });
});

describe("email tester: status mapping", () => {
  const map = (extra: Partial<EmailTestRow>, events: Array<{ mappedDeliveryStatus: EmailTestRow["providerDeliveryStatus"]; occurredAt: Date }> = [], at = now) =>
    mapEmailTestStatus(row(extra), events, at);

  it("follows the row: queued, sent and waiting, delivered", () => {
    expect(map({ status: "PENDING", sentAt: null, provider: null, providerDeliveryStatus: null })).toMatchObject({ state: "queued", final: false });
    expect(map({})).toMatchObject({ state: "waiting", final: false, reason: null });
    const delivered = map({ providerDeliveryStatus: "DELIVERED", deliveredAt: new Date(now.getTime() - 100) });
    expect(delivered).toMatchObject({ state: "delivered", final: true, outcomeAt: new Date(now.getTime() - 100).toISOString() });
  });

  it("shows only fixed sentences for a bounce, a complaint, a failure and a suppressed address", () => {
    expect(map({ providerDeliveryStatus: "BOUNCED" })).toMatchObject({ state: "bounced", reason: EMAIL_TEST_REASONS.bounced, final: true });
    expect(map({ providerDeliveryStatus: "COMPLAINED" })).toMatchObject({ state: "complained", reason: EMAIL_TEST_REASONS.complained });
    expect(map({ providerDeliveryStatus: "FAILED" })).toMatchObject({ state: "failed", reason: EMAIL_TEST_REASONS.failed });
    expect(map({ status: "SUPPRESSED", sentAt: null, providerDeliveryStatus: null })).toMatchObject({ state: "suppressed", reason: EMAIL_TEST_REASONS.suppressed });
    expect(map({ status: "FAILED", sentAt: null, providerDeliveryStatus: null })).toMatchObject({ state: "failed", reason: EMAIL_TEST_REASONS.failed });
    expect(map({ status: "CANCELLED", sentAt: null, providerDeliveryStatus: null })).toMatchObject({ state: "unavailable", reason: EMAIL_TEST_REASONS["not-sent"], final: true });
    const stuck = row({ status: "PROCESSING", sentAt: null, provider: null, providerDeliveryStatus: null, createdAt: new Date(now.getTime() - EMAIL_NOTICE_WAIT_MS) });
    expect(mapEmailTestStatus(stuck, [], now)).toMatchObject({ state: "unavailable", reason: EMAIL_TEST_REASONS.unavailable, final: true });
  });

  it("uses a provider notice that the outbox row has not caught up with, and the worst one wins", () => {
    const event = (mappedDeliveryStatus: EmailTestRow["providerDeliveryStatus"]) => ({ mappedDeliveryStatus, occurredAt: new Date(now.getTime() - 50) });
    expect(map({}, [event("BOUNCED")])).toMatchObject({ state: "bounced" });
    expect(map({ providerDeliveryStatus: "DELIVERED" }, [event("COMPLAINED")])).toMatchObject({ state: "complained" });
  });

  it('says "No notice yet" only after 5 minutes without a delivered, bounced or complained notice', () => {
    const sentAt = new Date("2026-10-31T16:00:00.000Z");
    const at = (ms: number) => new Date(sentAt.getTime() + ms);
    expect(map({ sentAt }, [], at(EMAIL_NOTICE_WAIT_MS - 1))).toMatchObject({ state: "waiting", final: false });
    const silent = map({ sentAt }, [], at(EMAIL_NOTICE_WAIT_MS));
    expect(silent).toMatchObject({ state: "no-notice", final: true, reason: EMAIL_TEST_REASONS["no-notice"], outcomeAt: at(EMAIL_NOTICE_WAIT_MS).toISOString() });
    // A late notice still wins over "no notice".
    expect(map({ sentAt, providerDeliveryStatus: "DELIVERED" }, [], at(EMAIL_NOTICE_WAIT_MS * 3))).toMatchObject({ state: "delivered" });
  });

  it("never carries a provider payload, address or raw error", () => {
    const text = JSON.stringify(map({ providerDeliveryStatus: "BOUNCED" }));
    expect(Object.keys(map({})).sort()).toEqual(["final", "outcomeAt", "provider", "queuedAt", "reason", "ref", "sentAt", "state", "testId"]);
    expect(text).not.toMatch(/@|payload|lastError/i);
  });
});

describe("email tester: the status read", () => {
  const get = (id: string) => GET(new Request(`${origin}/api/admin/system-report/email-test?id=${id}`));

  it("returns the status of a test the administrator sent, no-store, only that row", async () => {
    const response = await get("msg_test_1");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).status).toMatchObject({ testId: "msg_test_1", state: "waiting" });
    for (const call of mocks.outbox.findFirst.mock.calls) {
      expect(call[0].where).toMatchObject({ id: "msg_test_1", templateKey: "SYSTEM_TEST_EMAIL", eventId: null });
    }
  });

  it("answers not found for another administrator's test, another kind of email, and a malformed id", async () => {
    mocks.outbox.findFirst.mockResolvedValue({ metadata: { trigger: "SYSTEM_REPORT_TEST", testedByUserId: "someone_else" } });
    expect((await get("msg_test_1")).status).toBe(404);
    mocks.outbox.findFirst.mockResolvedValue(null);
    expect((await get("msg_registration_1")).status).toBe(404);
    expect(await readEmailTestStatus("../../etc", admin.id)).toBeNull();
    expect(await readEmailTestStatus("", admin.id)).toBeNull();
  });
});
