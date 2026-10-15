import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { canReuseAttendeeAccount } from "@/modules/account-merge/link-rules";
import {
  attendeeAccountToLinkForNewStaff,
  linkAttendeeSideAtActivation,
} from "@/modules/account-merge/staff-attendee-link";

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

function tx(options: { enabled: boolean; user?: unknown; account?: unknown; created?: number }) {
  return {
    platformSettings: { findUnique: vi.fn().mockResolvedValue({ unifiedSignInEnabled: options.enabled }) },
    user: {
      findUnique: vi.fn().mockResolvedValue(options.user ?? { id: "usr_1", email: "New@Example.test", displayName: "New", attendeeAccountId: null }),
      update: vi.fn().mockResolvedValue({}),
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

describe("attendeeAccountToLinkForNewStaff (a staff role for an existing attendee)", () => {
  it("switch off: null, and no lookup", async () => {
    const t = tx({ enabled: false, account: verified });
    await expect(attendeeAccountToLinkForNewStaff(t as never, "new@example.test")).resolves.toBeNull();
    expect(t.attendeeAccount.findUnique).not.toHaveBeenCalled();
  });

  it("switch on: returns the existing verified account", async () => {
    const t = tx({ enabled: true, account: verified });
    await expect(attendeeAccountToLinkForNewStaff(t as never, " New@example.test")).resolves.toBe("acc_1");
    expect(t.attendeeAccount.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "new@example.test" } }));
  });

  it("switch on: null for no account, an unverified one, or one linked elsewhere", async () => {
    await expect(attendeeAccountToLinkForNewStaff(tx({ enabled: true }) as never, "x@example.test")).resolves.toBeNull();
    await expect(attendeeAccountToLinkForNewStaff(tx({ enabled: true, account: { ...verified, emailVerifiedAt: null } }) as never, "new@example.test")).resolves.toBeNull();
    await expect(attendeeAccountToLinkForNewStaff(tx({ enabled: true, account: { ...verified, linkedUser: { id: "u" } } }) as never, "new@example.test")).resolves.toBeNull();
  });
});
