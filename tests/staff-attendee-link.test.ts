import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { canReuseAttendeeAccount } from "@/modules/account-merge/link-rules";
import { Prisma } from "@prisma/client";
import { linkAttendeeSideAtActivation } from "@/modules/account-merge/staff-attendee-link";

/** #554 slice (b): activation linking and role-grant linking, switch both ways. Synthetic data only. */

const now = new Date("2026-11-03T12:00:00Z");
const verified = {
  id: "acc_1",
  email: "new@example.test",
  status: "ACTIVE" as const,
  emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
  disabledAt: null,
  linkedUser: null,
};

function tx(options: { enabled: boolean; user?: unknown; account?: unknown; created?: number; sessions?: number; enrollments?: number; passkeys?: number; printed?: number; updateError?: unknown }) {
  return {
    userSession: { count: vi.fn().mockResolvedValue(options.sessions ?? 0) },
    userMfaEnrollment: { count: vi.fn().mockResolvedValue(options.enrollments ?? 0) },
    userPasskey: { count: vi.fn().mockResolvedValue(options.passkeys ?? 0) },
    auditLog: { count: vi.fn().mockResolvedValue(options.printed ?? 0) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    platformSettings: { findUnique: vi.fn().mockResolvedValue({ unifiedSignInEnabled: options.enabled }) },
    user: {
      findUnique: vi.fn().mockResolvedValue(options.user ?? { id: "usr_1", email: "New@Example.test", displayName: "New", attendeeAccountId: null }),
      update: options.updateError ? vi.fn().mockRejectedValue(options.updateError) : vi.fn().mockResolvedValue({}),
    },
    attendeeAccount: {
      createMany: vi.fn().mockResolvedValue({ count: options.created ?? 0 }),
      findUnique: vi.fn().mockResolvedValue(options.account ?? null),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("canReuseAttendeeAccount", () => {
  const base = { email: "a@example.test", status: "ACTIVE" as const, emailVerifiedAt: now, disabledAt: null, linkedUserId: null };
  it("needs equal normalised email, verified, active, not disabled, unlinked", () => {
    expect(canReuseAttendeeAccount(base, " A@Example.test ")).toBe(true);
    expect(canReuseAttendeeAccount(base, "b@example.test")).toBe(false);
    expect(canReuseAttendeeAccount({ ...base, emailVerifiedAt: null }, "a@example.test")).toBe(false);
    expect(canReuseAttendeeAccount({ ...base, status: "PENDING_VERIFICATION" }, "a@example.test")).toBe(false);
    expect(canReuseAttendeeAccount({ ...base, disabledAt: now }, "a@example.test")).toBe(false);
    expect(canReuseAttendeeAccount({ ...base, linkedUserId: "usr_x" }, "a@example.test", "usr_1")).toBe(false);
    expect(canReuseAttendeeAccount({ ...base, linkedUserId: "usr_1" }, "a@example.test", "usr_1")).toBe(true);
  });
});

describe("linkAttendeeSideAtActivation", () => {
  it("switch off: touches nothing", async () => {
    const t = tx({ enabled: false });
    await expect(linkAttendeeSideAtActivation(t as never, "usr_1", now)).resolves.toBe("disabled");
    expect(t.user.findUnique).not.toHaveBeenCalled();
    expect(t.attendeeAccount.createMany).not.toHaveBeenCalled();
    expect(t.user.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("switch on: creates a verified, active account for a new email and links it", async () => {
    const t = tx({ enabled: true, created: 1, account: verified });
    await expect(linkAttendeeSideAtActivation(t as never, "usr_1", now)).resolves.toBe("created");
    expect(t.attendeeAccount.createMany).toHaveBeenCalledWith({
      data: [{ email: "new@example.test", displayName: "New", status: "ACTIVE", emailVerifiedAt: now }],
      skipDuplicates: true,
    });
    expect(t.user.update).toHaveBeenCalledWith({ where: { id: "usr_1" }, data: { attendeeAccountId: "acc_1" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "STAFF_ATTENDEE_ACCOUNT_CREATED", metadata: { attendeeAccountId: "acc_1" } }), t);
  });

  it("switch on: reuses an existing verified unlinked account", async () => {
    const t = tx({ enabled: true, created: 0, account: verified });
    await expect(linkAttendeeSideAtActivation(t as never, "usr_1", now)).resolves.toBe("linked_existing");
    expect(t.user.update).toHaveBeenCalledOnce();
  });

  it.each([
    ["unverified", { ...verified, emailVerifiedAt: null, status: "PENDING_VERIFICATION" }],
    ["disabled", { ...verified, disabledAt: now }],
    ["linked to someone else", { ...verified, linkedUser: { id: "usr_other" } }],
  ])("switch on: does not link or verify an account that is %s", async (_label, account) => {
    const t = tx({ enabled: true, created: 0, account });
    await expect(linkAttendeeSideAtActivation(t as never, "usr_1", now)).resolves.toBe("needs_review");
    expect(t.user.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "STAFF_ATTENDEE_LINK_NEEDS_REVIEW" }), t);
  });

  it("leaves an already linked user alone", async () => {
    const t = tx({ enabled: true, user: { id: "usr_1", email: "a@example.test", displayName: "A", attendeeAccountId: "acc_9" } });
    await expect(linkAttendeeSideAtActivation(t as never, "usr_1", now)).resolves.toBe("already_linked");
    expect(t.attendeeAccount.createMany).not.toHaveBeenCalled();
  });
});

describe("never links an existing person at activation (security review B1)", () => {
  it.each([
    ["a session row", { sessions: 1 }],
    ["an authenticator enrolment", { enrollments: 1 }],
    ["a staff passkey", { passkeys: 1 }],
  ])("a previously active user with %s is flagged, not linked", async (_label, extra) => {
    const t = tx({ enabled: true, account: verified, ...extra });
    await expect(linkAttendeeSideAtActivation(t as never, "usr_1", now)).resolves.toBe("needs_review");
    expect(t.attendeeAccount.createMany).not.toHaveBeenCalled();
    expect(t.user.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "STAFF_ATTENDEE_LINK_NEEDS_REVIEW", metadata: { attendeeAccountId: null, reason: "PREVIOUSLY_ACTIVE" } }),
      t,
    );
  });

  it("an activation link printed by create-admin is flagged, not linked", async () => {
    const t = tx({ enabled: true, account: verified, printed: 1 });
    await expect(linkAttendeeSideAtActivation(t as never, "usr_1", now)).resolves.toBe("needs_review");
    expect(t.user.update).not.toHaveBeenCalled();
    expect(t.attendeeAccount.createMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { attendeeAccountId: null, reason: "TOKEN_NOT_EMAILED" } }),
      t,
    );
  });

  it("switch off: the history is not even read", async () => {
    const t = tx({ enabled: false, sessions: 3 });
    await linkAttendeeSideAtActivation(t as never, "usr_1", now);
    expect(t.userSession.count).not.toHaveBeenCalled();
  });
});

describe("a link conflict falls back to review instead of failing (security review N4)", () => {
  it("locks the account row before re-checking the reuse rule", async () => {
    const t = tx({ enabled: true, created: 0, account: verified });
    await linkAttendeeSideAtActivation(t as never, "usr_1", now);
    const order = [t.attendeeAccount.createMany.mock.invocationCallOrder[0], t.$queryRaw.mock.invocationCallOrder[0], t.attendeeAccount.findUnique.mock.invocationCallOrder[0]];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(t.$queryRaw).toHaveBeenCalledOnce();
  });

  it("a unique-index conflict on the link rolls back to the savepoint and records review", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
    const t = tx({ enabled: true, created: 0, account: verified, updateError: conflict });
    await expect(linkAttendeeSideAtActivation(t as never, "usr_1", now)).resolves.toBe("needs_review");
    expect(t.$executeRawUnsafe).toHaveBeenCalledWith("ROLLBACK TO SAVEPOINT staff_attendee_link");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { attendeeAccountId: "acc_1", reason: "LINK_CONFLICT" } }),
      t,
    );
  });

  it("any other error still propagates", async () => {
    const t = tx({ enabled: true, created: 0, account: verified, updateError: new Error("boom") });
    await expect(linkAttendeeSideAtActivation(t as never, "usr_1", now)).rejects.toThrow("boom");
  });
});
