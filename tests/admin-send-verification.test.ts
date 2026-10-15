import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #554 slice (c) follow-up: the administrator's "Send verification email" (there is no
 * bare "mark verified" switch) and the code-only verification it feeds. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  rateLimit: vi.fn(),
  queue: vi.fn(),
  createAttendeeSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/rate-limit/service", () => ({ checkAdminVerificationEmailRateLimit: mocks.rateLimit }));
vi.mock("@/modules/attendee-accounts/attendee-email-dispatch", () => ({ queueAttendeeVerificationEmail: mocks.queue }));
vi.mock("@/modules/access/session-store", () => ({ revokeAllUserSessions: vi.fn() }));
vi.mock("@/modules/communications/account-email-dispatch", () => ({ sendAccountRecoveryEmail: vi.fn() }));
vi.mock("@/modules/attendee-accounts/session-store", () => ({
  revokeAllAttendeeSessions: vi.fn(),
  createAttendeeSession: mocks.createAttendeeSession,
}));

import { sendAttendeeVerificationByAdmin } from "@/modules/system-admin/user-admin";
import { verifyAttendeeEmailByAddress } from "@/modules/attendee-accounts/account-service";
import { createOneTimeCode, hashOneTimeCode } from "@/modules/attendee-accounts/codes";

type Account = { id: string; email: string; displayName: string; status: string; disabledAt: Date | null; emailVerifiedAt: Date | null };
const account = (over: Partial<Account> = {}): Account => ({
  id: "acct-1", email: "person@example.test", displayName: "Person", status: "ACTIVE", disabledAt: null, emailVerifiedAt: null, ...over,
});

function database(options: { admin?: boolean; account?: Account | null }) {
  const tokenCreate = vi.fn(async () => ({}));
  const tx = {
    user: { findUnique: vi.fn(async () => (options.admin === false ? { globalRole: null, accountStatus: "ACTIVE" } : { globalRole: "SYSTEM_ADMIN", accountStatus: "ACTIVE" })) },
    attendeeAccountToken: { updateMany: vi.fn(async () => ({ count: 0 })), create: tokenCreate },
  };
  mocks.getPrisma.mockReturnValue({
    ...tx,
    attendeeAccount: { findUnique: vi.fn(async () => (options.account === undefined ? account() : options.account)) },
    $transaction: async (work: unknown) => (typeof work === "function" ? (work as (t: typeof tx) => unknown)(tx) : Promise.all(work as unknown[])),
  });
  return { tokenCreate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.queue.mockResolvedValue({ configured: true, messageId: "msg-1" });
});

describe("Send verification email", () => {
  it("mails the code to the current address, audits ids only, and marks nothing verified", async () => {
    const { tokenCreate } = database({});
    await expect(sendAttendeeVerificationByAdmin("acct-1", "admin-1")).resolves.toEqual({ messageId: "msg-1" });
    expect(tokenCreate).toHaveBeenCalledTimes(1);
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ accountId: "acct-1", email: "person@example.test", adminSent: true, alreadyRegistered: false }));
    const [entry] = mocks.writeAuditLog.mock.calls[0];
    expect(entry).toMatchObject({ action: "ATTENDEE_VERIFICATION_EMAIL_SENT_BY_ADMIN", actorUserId: "admin-1", entityId: "acct-1", metadata: { attendeeAccountId: "acct-1" } });
    expect(JSON.stringify(entry)).not.toContain("@");
  });

  it("is system administrator only, re-checked in the database", async () => {
    database({ admin: false });
    await expect(sendAttendeeVerificationByAdmin("acct-1", "someone")).rejects.toMatchObject({ code: "NOT_SYSTEM_ADMIN" });
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("refuses a verified, unusable or missing account, and a rate-limited one, sending nothing", async () => {
    database({ account: account({ emailVerifiedAt: new Date() }) });
    await expect(sendAttendeeVerificationByAdmin("acct-1", "admin-1")).rejects.toMatchObject({ code: "ALREADY_VERIFIED" });
    database({ account: account({ disabledAt: new Date() }) });
    await expect(sendAttendeeVerificationByAdmin("acct-1", "admin-1")).rejects.toMatchObject({ code: "ACCOUNT_NOT_USABLE" });
    database({ account: account({ status: "PENDING_VERIFICATION" }) });
    await expect(sendAttendeeVerificationByAdmin("acct-1", "admin-1")).rejects.toMatchObject({ code: "ACCOUNT_NOT_USABLE" });
    database({ account: null });
    await expect(sendAttendeeVerificationByAdmin("acct-1", "admin-1")).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
    database({});
    mocks.rateLimit.mockResolvedValue({ allowed: false, decisions: [] });
    await expect(sendAttendeeVerificationByAdmin("acct-1", "admin-1")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("reports account email as not configured", async () => {
    database({});
    mocks.queue.mockResolvedValue({ configured: false, messageId: null });
    await expect(sendAttendeeVerificationByAdmin("acct-1", "admin-1")).rejects.toMatchObject({ code: "EMAIL_NOT_CONFIGURED" });
  });
});

describe("verifying with the address and code only", () => {
  const code = createOneTimeCode();
  const record = (over: Record<string, unknown> = {}) => ({
    id: "tok-1", accountId: "acct-1", codeHash: hashOneTimeCode(code), purpose: "EMAIL_VERIFICATION",
    expiresAt: new Date(Date.now() + 3_600_000), codeExpiresAt: new Date(Date.now() + 600_000), usedAt: null, attempts: 0, ...over,
  });

  function verifyDatabase(acct: Account | null, tokenRecord: unknown) {
    const tx = {
      attendeeAccountToken: { updateMany: vi.fn(async () => ({ count: 1 })) },
      attendeeAccount: { update: vi.fn(async () => ({})) },
    };
    mocks.getPrisma.mockReturnValue({
      attendeeAccount: { findUnique: vi.fn(async () => acct) },
      attendeeAccountToken: { findFirst: vi.fn(async () => tokenRecord), updateMany: vi.fn(async () => ({ count: 1 })) },
      $transaction: async (work: (t: typeof tx) => unknown) => work(tx),
    });
    mocks.createAttendeeSession.mockResolvedValue({ token: "s", expiresAt: new Date() });
    return tx;
  }
  const run = (email = "person@example.test", typed = code) => verifyAttendeeEmailByAddress({ email, code: typed, userAgent: null });

  it("verifies an ACTIVE account whose verification was cleared, with the right code", async () => {
    const tx = verifyDatabase(account(), record());
    expect((await run()).outcome).toBe("verified");
    expect(tx.attendeeAccount.update).toHaveBeenCalledWith({ where: { id: "acct-1" }, data: { status: "ACTIVE", emailVerifiedAt: expect.any(Date) } });
  });

  it("looks for the newest live token that already has a code", async () => {
    verifyDatabase(account(), record());
    await run();
    const findFirst = (mocks.getPrisma.mock.results.at(-1)!.value as { attendeeAccountToken: { findFirst: ReturnType<typeof vi.fn> } }).attendeeAccountToken.findFirst;
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        accountId: "acct-1",
        purpose: "EMAIL_VERIFICATION",
        usedAt: null,
        codeHash: { not: null },
        expiresAt: { gt: expect.any(Date) },
        codeExpiresAt: { gt: expect.any(Date) },
      }),
      orderBy: { createdAt: "desc" },
    }));
  });

  it("refuses a wrong code, an unknown address, a verified account and an unfinished sign-up alike", async () => {
    verifyDatabase(account(), record());
    expect((await run("person@example.test", "000000" === code ? "111111" : "000000")).outcome).toBe("rejected");
    verifyDatabase(null, record());
    expect((await run()).outcome).toBe("rejected");
    verifyDatabase(account({ emailVerifiedAt: new Date() }), record());
    expect((await run()).outcome).toBe("rejected");
    // A sign-up that never verified keeps its handle bound to the browser that asked.
    verifyDatabase(account({ status: "PENDING_VERIFICATION" }), record());
    expect((await run()).outcome).toBe("rejected");
    verifyDatabase(account(), record({ usedAt: new Date() }));
    expect((await run()).outcome).toBe("rejected");
    verifyDatabase(account(), null);
    expect((await run()).outcome).toBe("rejected");
  });
});
