import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false,
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  accountFindUnique: vi.fn(),
  accountFindFirst: vi.fn(),
  accountUpdate: vi.fn(),
  tokenUpdateMany: vi.fn(),
  resetTokenUpdateMany: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  revokeAllAttendeeSessions: vi.fn(),
  writeAuditLog: vi.fn(),
}));

const client = {
  user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst, update: mocks.userUpdate },
  attendeeAccount: { findUnique: mocks.accountFindUnique, findFirst: mocks.accountFindFirst, update: mocks.accountUpdate },
  attendeeAccountToken: { updateMany: mocks.tokenUpdateMany },
  passwordResetToken: { updateMany: mocks.resetTokenUpdateMany },
  platformSettings: { findUnique: async () => ({ unifiedSignInEnabled: mocks.enabled }) },
  $transaction: async (work: unknown) => (typeof work === "function" ? (work as (c: unknown) => unknown)(client) : Promise.all(work as unknown[])),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/access/session-store", () => ({ revokeAllUserSessions: mocks.revokeAllUserSessions }));
vi.mock("@/modules/attendee-accounts/session-store", () => ({ revokeAllAttendeeSessions: mocks.revokeAllAttendeeSessions }));
vi.mock("@/modules/communications/account-email-dispatch", () => ({ sendAccountRecoveryEmail: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { findSwitchableAttendeeAccountForStaff } from "@/modules/attendee-accounts/current-attendee";
import { isActingAdminsOwnEmail } from "@/modules/organizations/act-as-own-account";
import { changeAttendeeEmail, changeStaffEmail } from "@/modules/system-admin/user-admin";

/** #554 slice (b): linked-person behaviour, switch both ways. Synthetic data only. */

const verifiedAccount = {
  id: "acc_linked",
  email: "linked@example.test",
  displayName: "Linked",
  status: "ACTIVE",
  emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
  disabledAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = false;
  mocks.userFindFirst.mockResolvedValue(null);
  mocks.accountFindFirst.mockResolvedValue(null);
});

describe("attendee mode uses the link", () => {
  it("switch on and linked: returns the LINKED account, not the email match", async () => {
    mocks.enabled = true;
    mocks.userFindUnique.mockResolvedValue({ attendeeAccount: verifiedAccount });
    mocks.accountFindUnique.mockResolvedValue({ ...verifiedAccount, id: "acc_lookalike" });
    await expect(findSwitchableAttendeeAccountForStaff("drifted@example.test", "usr_1")).resolves.toEqual({
      id: "acc_linked", verifiedEmail: "linked@example.test", displayName: "Linked",
    });
    expect(mocks.accountFindUnique).not.toHaveBeenCalled();
  });

  it("switch on and linked to a disabled account: null, with no email fallback", async () => {
    mocks.enabled = true;
    mocks.userFindUnique.mockResolvedValue({ attendeeAccount: { ...verifiedAccount, disabledAt: new Date() } });
    await expect(findSwitchableAttendeeAccountForStaff("linked@example.test", "usr_1")).resolves.toBeNull();
    expect(mocks.accountFindUnique).not.toHaveBeenCalled();
  });

  it("switch on but unlinked: the email rule as today", async () => {
    mocks.enabled = true;
    mocks.userFindUnique.mockResolvedValue({ attendeeAccount: null });
    mocks.accountFindUnique.mockResolvedValue(verifiedAccount);
    await expect(findSwitchableAttendeeAccountForStaff(" Linked@example.test", "usr_1")).resolves.toMatchObject({ id: "acc_linked" });
    expect(mocks.accountFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "linked@example.test" } }));
  });

  it("switch on, unlinked: refuses an email-matched account that is linked to a different user", async () => {
    mocks.enabled = true;
    mocks.userFindUnique.mockResolvedValue({ attendeeAccount: null });
    mocks.accountFindUnique.mockResolvedValue({ ...verifiedAccount, linkedUser: { id: "usr_other" } });
    await expect(findSwitchableAttendeeAccountForStaff("linked@example.test", "usr_1")).resolves.toBeNull();
  });

  it("switch off: an email-matched account linked to someone else is still returned, as today", async () => {
    mocks.accountFindUnique.mockResolvedValue({ ...verifiedAccount, linkedUser: { id: "usr_other" } });
    await expect(findSwitchableAttendeeAccountForStaff("linked@example.test", "usr_1")).resolves.toMatchObject({ id: "acc_linked" });
  });

  it("switch off: the email rule only, the link is never read", async () => {
    mocks.userFindUnique.mockResolvedValue({ attendeeAccount: { ...verifiedAccount, id: "acc_linked" } });
    mocks.accountFindUnique.mockResolvedValue({ ...verifiedAccount, id: "acc_by_email" });
    await expect(findSwitchableAttendeeAccountForStaff("linked@example.test", "usr_1")).resolves.toMatchObject({ id: "acc_by_email" });
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });
});

describe("act-as never reaches the acting person's linked attendee side", () => {
  const actor = { userId: "usr_1" };
  it("switch on: the linked account's email counts as the acting admin's own, even if it drifted", async () => {
    mocks.enabled = true;
    mocks.userFindUnique.mockResolvedValue({ email: "staff@example.test", attendeeAccount: { email: "personal@example.test" } });
    await expect(isActingAdminsOwnEmail(actor, "Personal@example.test")).resolves.toBe(true);
    await expect(isActingAdminsOwnEmail(actor, "someone@example.test")).resolves.toBe(false);
  });

  it("switch off: only the staff email counts, as before", async () => {
    mocks.userFindUnique.mockResolvedValue({ email: "staff@example.test", attendeeAccount: { email: "personal@example.test" } });
    await expect(isActingAdminsOwnEmail(actor, "personal@example.test")).resolves.toBe(false);
    await expect(isActingAdminsOwnEmail(actor, "staff@example.test")).resolves.toBe(true);
  });
});

describe("a linked person's email changes on both sides together (decision 3)", () => {
  it("switch on, from the staff side: one transaction updates both and signs both sides out", async () => {
    mocks.enabled = true;
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: "usr_1", email: "old@example.test" }) // requireStaffUser
      .mockResolvedValueOnce({ id: "usr_1", attendeeAccountId: "acc_1" }); // link
    await changeStaffEmail("usr_1", "new@example.test", "admin-1");
    expect(mocks.userUpdate).toHaveBeenCalledWith({ where: { id: "usr_1" }, data: { email: "new@example.test" } });
    expect(mocks.accountUpdate).toHaveBeenCalledWith({ where: { id: "acc_1" }, data: { email: "new@example.test", emailVerifiedAt: null } });
    // Every unused attendee token is spent in the same transaction (B1).
    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith({ where: { accountId: "acc_1", usedAt: null }, data: { usedAt: expect.any(Date) } });
    expect(mocks.revokeAllUserSessions).toHaveBeenCalledWith("usr_1");
    expect(mocks.revokeAllAttendeeSessions).toHaveBeenCalledWith("acc_1");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(2);
  });

  it("switch on, from the attendee side: updates the linked staff user too", async () => {
    mocks.enabled = true;
    mocks.accountFindUnique.mockResolvedValue({ id: "acc_1" });
    mocks.userFindUnique.mockResolvedValue({ id: "usr_1", attendeeAccountId: "acc_1" });
    await changeAttendeeEmail("acc_1", "new@example.test", "admin-1");
    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith({ where: { accountId: "acc_1", usedAt: null }, data: { usedAt: expect.any(Date) } });
    expect(mocks.userUpdate).toHaveBeenCalledWith({ where: { id: "usr_1" }, data: { email: "new@example.test" } });
    expect(mocks.accountUpdate).toHaveBeenCalledWith({ where: { id: "acc_1" }, data: { email: "new@example.test", emailVerifiedAt: null } });
  });

  it("refuses, writing nothing, when either side's new address is taken", async () => {
    mocks.enabled = true;
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: "usr_1", email: "old@example.test" })
      .mockResolvedValueOnce({ id: "usr_1", attendeeAccountId: "acc_1" });
    mocks.accountFindFirst.mockResolvedValue({ id: "acc_other" });
    await expect(changeStaffEmail("usr_1", "taken@example.test", "admin-1")).rejects.toMatchObject({ code: "EMAIL_IN_USE" });
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.accountUpdate).not.toHaveBeenCalled();
  });

  it("switch off: only the staff side changes, exactly as before", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "usr_1", email: "old@example.test", attendeeAccountId: "acc_1" });
    await changeStaffEmail("usr_1", "new@example.test", "admin-1");
    expect(mocks.userUpdate).toHaveBeenCalledWith({ where: { id: "usr_1" }, data: { email: "new@example.test" } });
    expect(mocks.accountUpdate).not.toHaveBeenCalled();
    expect(mocks.revokeAllAttendeeSessions).not.toHaveBeenCalled();
    // The staff reset links emailed to the old address are spent with the change, even unlinked.
    expect(mocks.resetTokenUpdateMany).toHaveBeenCalledWith({ where: { userId: "usr_1", usedAt: null }, data: { usedAt: expect.any(Date) } });
  });

  it("switch on, linked: the staff reset links are spent in the same transaction as both email writes", async () => {
    mocks.enabled = true;
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: "usr_1", email: "old@example.test" })
      .mockResolvedValueOnce({ id: "usr_1", attendeeAccountId: "acc_1" });
    const order: string[] = [];
    mocks.userUpdate.mockImplementation(() => { order.push("user"); return Promise.resolve({}); });
    mocks.accountUpdate.mockImplementation(() => { order.push("account"); return Promise.resolve({}); });
    mocks.resetTokenUpdateMany.mockImplementation(() => { order.push("staff-links"); return Promise.resolve({ count: 1 }); });
    await changeStaffEmail("usr_1", "new@example.test", "admin-1");
    expect(order).toEqual(["user", "account", "staff-links"]);
    expect(mocks.resetTokenUpdateMany).toHaveBeenCalledWith({ where: { userId: "usr_1", usedAt: null }, data: { usedAt: expect.any(Date) } });
  });
});

describe("an administrator's email change and outstanding codes (B1)", () => {
  it("switch off, plain account: the update and the token spend are one transaction", async () => {
    mocks.accountFindUnique.mockResolvedValue({ id: "acc_1", email: "old@example.test" });
    const order: string[] = [];
    mocks.accountUpdate.mockImplementation(() => { order.push("update"); return Promise.resolve({}); });
    mocks.tokenUpdateMany.mockImplementation(() => { order.push("spend"); return Promise.resolve({ count: 2 }); });
    await changeAttendeeEmail("acc_1", "new@example.test", "admin-1");
    expect(order).toEqual(["update", "spend"]);
    expect(mocks.accountUpdate).toHaveBeenCalledWith({ where: { id: "acc_1" }, data: { email: "new@example.test", emailVerifiedAt: null } });
    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith({ where: { accountId: "acc_1", usedAt: null }, data: { usedAt: expect.any(Date) } });
  });

  it("refuses a change to the address it already has, writing nothing", async () => {
    mocks.accountFindUnique.mockResolvedValue({ id: "acc_1", email: "same@example.test" });
    await expect(changeAttendeeEmail("acc_1", "same@example.test", "admin-1")).rejects.toMatchObject({ code: "EMAIL_UNCHANGED" });
    mocks.userFindUnique.mockResolvedValueOnce({ id: "usr_1", email: "same@example.test" });
    await expect(changeStaffEmail("usr_1", "same@example.test", "admin-1")).rejects.toMatchObject({ code: "EMAIL_UNCHANGED" });
    expect(mocks.accountUpdate).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
  });
});
