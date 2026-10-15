import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false,
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  accountFindUnique: vi.fn(),
  accountFindFirst: vi.fn(),
  accountUpdate: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  revokeAllAttendeeSessions: vi.fn(),
  writeAuditLog: vi.fn(),
}));

const client = {
  user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst, update: mocks.userUpdate },
  attendeeAccount: { findUnique: mocks.accountFindUnique, findFirst: mocks.accountFindFirst, update: mocks.accountUpdate },
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
    expect(mocks.revokeAllUserSessions).toHaveBeenCalledWith("usr_1");
    expect(mocks.revokeAllAttendeeSessions).toHaveBeenCalledWith("acc_1");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(2);
  });

  it("switch on, from the attendee side: updates the linked staff user too", async () => {
    mocks.enabled = true;
    mocks.accountFindUnique.mockResolvedValue({ id: "acc_1" });
    mocks.userFindUnique.mockResolvedValue({ id: "usr_1", attendeeAccountId: "acc_1" });
    await changeAttendeeEmail("acc_1", "new@example.test", "admin-1");
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
  });
});
