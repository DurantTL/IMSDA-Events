import "server-only";

import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { revokeAllUserSessions } from "@/modules/access/session-store";
import { revokeAllAttendeeSessions } from "@/modules/attendee-accounts/session-store";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { requireSystemAdminActor } from "@/modules/account-merge/hand-link";
import { beginAdminVerification } from "@/modules/attendee-accounts/account-service";
import { queueAttendeeVerificationEmail } from "@/modules/attendee-accounts/attendee-email-dispatch";
import { checkAdminVerificationEmailRateLimit } from "@/modules/rate-limit/service";
import { sendAccountRecoveryEmail } from "@/modules/communications/account-email-dispatch";
import { deliverStaffActivation } from "@/modules/communications/staff-activation";
import { sortAccounts, type AccountSort } from "@/modules/system-admin/account-sort";

/**
 * System administrator account tools (#386). Two-step sign-in can't be turned
 * off by anyone (decision 2026-09-23); resetting it here is the one audited
 * way back in after a lost device. The person sets it up again at their next
 * sign-in. Resetting it also revokes every passkey on the account. Every
 * action signs the person out everywhere.
 */

export class UserAdminError extends Error {
  constructor(public readonly code: "ACCOUNT_NOT_FOUND" | "EMAIL_IN_USE" | "NOT_ON_YOURSELF" | "EMAIL_NOT_CONFIGURED" | "EMAIL_UNCHANGED" | "ALREADY_VERIFIED" | "ACCOUNT_NOT_USABLE" | "RATE_LIMITED", message: string) {
    super(message);
    this.name = "UserAdminError";
  }
}

export const changeEmailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
}).strict();

/**
 * A linked person (#554, ADR 0013, decision 3) has ONE email on both sides, so an
 * email change is applied to the staff `User` and the linked `AttendeeAccount`
 * in one transaction, or refused when either address is taken by someone else.
 * "The usual verification" is the one this tool has always had: a system
 * administrator makes the change, it is audited, and the person is signed out.
 * Nothing here runs unless the one-sign-in switch is on and the two are linked.
 */
async function changeLinkedEmailTogether(
  link: { userId: string; attendeeAccountId: string },
  email: string,
  actorUserId: string,
) {
  await getPrisma().$transaction(async (tx) => {
    const [takenUser, takenAccount] = await Promise.all([
      tx.user.findFirst({ where: { email, id: { not: link.userId } }, select: { id: true } }),
      tx.attendeeAccount.findFirst({ where: { email, id: { not: link.attendeeAccountId } }, select: { id: true } }),
    ]);
    if (takenUser || takenAccount) throw new UserAdminError("EMAIL_IN_USE", "Another account already uses that email.");
    await tx.user.update({ where: { id: link.userId }, data: { email } });
    // The address changed, so nobody has verified the new one yet (Caleb, Oct 15, 2026): the
    // attendee side's verification is cleared with it.
    await tx.attendeeAccount.update({ where: { id: link.attendeeAccountId }, data: { email, emailVerifiedAt: null } });
    // Staff side of the same rule: an unused password reset or activation link emailed to the OLD
    // mailbox must not outlive the change.
    await tx.passwordResetToken.updateMany({ where: { userId: link.userId, usedAt: null }, data: { usedAt: new Date() } });
    // Spend every unused attendee token (reset, verification) in the same transaction: a code
    // emailed to the OLD mailbox must not be able to verify the NEW address.
    await tx.attendeeAccountToken.updateMany({
      where: { accountId: link.attendeeAccountId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await writeAuditLog({
      actorUserId,
      action: "STAFF_EMAIL_CHANGED",
      entityType: "User",
      entityId: link.userId,
      summary: "A system administrator changed a linked person's email on both their staff and attendee sides.",
      metadata: { attendeeAccountId: link.attendeeAccountId, linked: true },
    }, tx);
    await writeAuditLog({
      actorUserId,
      action: "ATTENDEE_EMAIL_CHANGED",
      entityType: "AttendeeAccount",
      entityId: link.attendeeAccountId,
      summary: "A system administrator changed a linked person's email on both their staff and attendee sides.",
      metadata: { userId: link.userId, linked: true },
    }, tx);
  });
  if (link.userId !== actorUserId) await revokeAllUserSessions(link.userId);
  await revokeAllAttendeeSessions(link.attendeeAccountId);
}

/** The link for this staff user, only while the one-sign-in switch is on. */
async function activeLinkForUser(userId: string) {
  if (!(await isUnifiedSignInEnabled())) return null;
  const row = await getPrisma().user.findUnique({ where: { id: userId }, select: { id: true, attendeeAccountId: true } });
  return row?.attendeeAccountId ? { userId: row.id, attendeeAccountId: row.attendeeAccountId } : null;
}

/** The link for this attendee account, only while the one-sign-in switch is on. */
async function activeLinkForAccount(accountId: string) {
  if (!(await isUnifiedSignInEnabled())) return null;
  const row = await getPrisma().user.findUnique({ where: { attendeeAccountId: accountId }, select: { id: true, attendeeAccountId: true } });
  return row?.attendeeAccountId ? { userId: row.id, attendeeAccountId: row.attendeeAccountId } : null;
}

// ---- Staff sign-ins -------------------------------------------------------

async function requireStaffUser(userId: string) {
  const user = await getPrisma().user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) throw new UserAdminError("ACCOUNT_NOT_FOUND", "That team account could not be found.");
  return user;
}

/**
 * Removes a team member's authenticator and revokes every passkey they have,
 * in one transaction, then signs them out everywhere — the same shape as
 * {@link resetAttendeeTwoStep}. A passkey is a second step on its own
 * (#429), so leaving one working would leave the reset only half done.
 */
export async function resetStaffTwoStep(userId: string, actorUserId: string, now = new Date()) {
  if (userId === actorUserId) {
    throw new UserAdminError("NOT_ON_YOURSELF", "Ask another system administrator to reset your own two-step sign-in.");
  }
  await requireStaffUser(userId);
  const [, revoked] = await getPrisma().$transaction([
    getPrisma().userMfaEnrollment.deleteMany({ where: { userId } }),
    getPrisma().userPasskey.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  await revokeAllUserSessions(userId);
  await writeAuditLog({
    actorUserId,
    action: "STAFF_MFA_RESET",
    entityType: "User",
    entityId: userId,
    summary: "A system administrator reset a team member's two-step sign-in and removed their passkeys.",
    metadata: { passkeysRevoked: revoked.count },
  });
}

export async function changeStaffEmail(userId: string, email: string, actorUserId: string) {
  const current = await requireStaffUser(userId);
  if (current.email === email) throw new UserAdminError("EMAIL_UNCHANGED", "That is already this account's email.");
  const link = await activeLinkForUser(userId);
  if (link) return changeLinkedEmailTogether(link, email, actorUserId);
  const taken = await getPrisma().user.findFirst({ where: { email, id: { not: userId } }, select: { id: true } });
  if (taken) throw new UserAdminError("EMAIL_IN_USE", "Another team account already uses that email.");
  // The write and the spend of this user's unused reset links are one transaction (a link
  // emailed to the old address must not outlive the change).
  await getPrisma().$transaction([
    getPrisma().user.update({ where: { id: userId }, data: { email } }),
    getPrisma().passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
  ]);
  if (userId !== actorUserId) await revokeAllUserSessions(userId);
  await writeAuditLog({
    actorUserId,
    action: "STAFF_EMAIL_CHANGED",
    entityType: "User",
    entityId: userId,
    summary: "A system administrator changed a team member's sign-in email.",
  });
}

export async function sendStaffPasswordReset(userId: string, actorUserId: string) {
  const user = await requireStaffUser(userId);
  const result = await sendAccountRecoveryEmail(user.email);
  if (!result.configured) throw new UserAdminError("EMAIL_NOT_CONFIGURED", "Account email isn't set up on this server.");
  await writeAuditLog({
    actorUserId,
    action: "STAFF_PASSWORD_RESET_SENT",
    entityType: "User",
    entityId: userId,
    summary: "A system administrator sent a team member a password reset link.",
  });
  return { queued: result.queued };
}

/** A staff login that was invited and has not activated yet, with its sign-in not switched off (#1276). */
async function requirePendingStaffInvite(userId: string, client: Prisma.TransactionClient | PrismaClient = getPrisma()) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, accountStatus: true, credential: { select: { disabledAt: true } } },
  });
  if (!user) throw new UserAdminError("ACCOUNT_NOT_FOUND", "That team account could not be found.");
  if (user.accountStatus !== "PENDING_ACTIVATION" || !user.credential || user.credential.disabledAt) {
    throw new UserAdminError("ACCOUNT_NOT_USABLE", "That login isn't waiting to be activated.");
  }
  return user;
}

/**
 * Sends a pending staff invite again: a new activation link by email (or, where email isn't configured, a one-time
 * link to hand over). A new link retires the earlier one.
 */
export async function resendStaffInvite(userId: string, actorUserId: string) {
  const user = await requirePendingStaffInvite(userId);
  const delivery = await deliverStaffActivation({ userId: user.id, email: user.email, displayName: user.displayName });
  await writeAuditLog({
    actorUserId,
    action: "STAFF_INVITE_RESENT",
    entityType: "User",
    entityId: userId,
    summary: "A system administrator resent a team member's activation invite.",
    metadata: { emailed: delivery.invitationEmailed, linkHandedOver: Boolean(delivery.setupUrl) },
  });
  return delivery;
}

/**
 * Cancels a pending staff invite: unused activation links are spent and the sign-in is switched off. The roles and
 * event assignments made with the invite are left as they are; "Allow sign-in" on the person's page undoes this.
 */
export async function cancelStaffInvite(userId: string, actorUserId: string, now = new Date()) {
  await getPrisma().$transaction(async (tx) => {
    await requirePendingStaffInvite(userId, tx);
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
    const guarded = await tx.authCredential.updateMany({ where: { userId, disabledAt: null }, data: { disabledAt: now } });
    if (guarded.count === 0) throw new UserAdminError("ACCOUNT_NOT_USABLE", "That login isn't waiting to be activated.");
    await writeAuditLog({
      actorUserId,
      action: "STAFF_INVITE_CANCELLED",
      entityType: "User",
      entityId: userId,
      summary: "A system administrator cancelled a team member's activation invite.",
    }, tx);
  });
}

// ---- Attendee accounts ----------------------------------------------------

/** Most accounts one sorted listing will consider; far above the real count. */
const ACCOUNT_SORT_CEILING = 5000;

/**
 * Attendee accounts, newest first by default. With a `sort` (#738) the order
 * is applied across every match before the first `limit` are returned, so a
 * sort never reorders just one page.
 */
export async function listAttendeeAccounts(query: string, sort: AccountSort = null, limit = 50) {
  return (await listAttendeeAccountsWithCap(query, sort, limit)).accounts;
}

/** As `listAttendeeAccounts`, plus whether a sort hit the ceiling and left matches out. */
export async function listAttendeeAccountsWithCap(query: string, sort: AccountSort = null, limit = 50) {
  const text = query.trim().slice(0, 120);
  const accounts = await getPrisma().attendeeAccount.findMany({
    where: text
      ? { OR: [{ email: { contains: text.toLowerCase() } }, { displayName: { contains: text, mode: "insensitive" } }] }
      : undefined,
    orderBy: [{ createdAt: "desc" }],
    take: sort ? ACCOUNT_SORT_CEILING : limit,
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      disabledAt: true,
      createdAt: true,
      mfaEnrollment: { select: { status: true } },
      _count: { select: { passkeys: { where: { revokedAt: null } } } },
      sessions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      areaCoordinatorGrant: { select: { revokedAt: true, expiresAt: true } },
      linkedUser: { select: { id: true } },
      emailVerifiedAt: true,
      clubDirectorGrants: {
        where: { revokedAt: null, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] },
        select: { role: true, organization: { select: { name: true } } },
      },
    },
  });
  const summaries = accounts.map((account) => ({
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    status: account.status,
    disabled: Boolean(account.disabledAt),
    createdAt: account.createdAt.toISOString(),
    lastSignedInAt: account.sessions[0]?.createdAt.toISOString() ?? null,
    authenticatorOn: account.mfaEnrollment?.status === "ACTIVE",
    passkeyCount: account._count.passkeys,
    /** A boolean only: whether a staff sign-in is linked to this account (#554). */
    linkedToStaff: Boolean(account.linkedUser),
    emailVerified: account.emailVerifiedAt !== null,
    clubRoles: account.clubDirectorGrants.map((grant) => ({ role: grant.role, clubName: grant.organization.name })),
    areaCoordinator: Boolean(
      account.areaCoordinatorGrant
      && !account.areaCoordinatorGrant.revokedAt
      && (!account.areaCoordinatorGrant.expiresAt || account.areaCoordinatorGrant.expiresAt > new Date()),
    ),
  }));
  return {
    accounts: sort ? sortAccounts(summaries, sort).slice(0, limit) : summaries,
    capped: Boolean(sort) && accounts.length >= ACCOUNT_SORT_CEILING,
  };
}

export type AttendeeAccountSummary = Awaited<ReturnType<typeof listAttendeeAccounts>>[number];

async function requireAttendee(accountId: string) {
  const account = await getPrisma().attendeeAccount.findUnique({ where: { id: accountId }, select: { id: true, email: true } });
  if (!account) throw new UserAdminError("ACCOUNT_NOT_FOUND", "That account could not be found.");
  return account;
}

/** Removes the authenticator and every passkey; club roles set one up again at their next sign-in. */
export async function resetAttendeeTwoStep(accountId: string, actorUserId: string, now = new Date()) {
  await requireAttendee(accountId);
  await getPrisma().$transaction([
    getPrisma().attendeeMfaEnrollment.deleteMany({ where: { accountId } }),
    getPrisma().attendeePasskey.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  await revokeAllAttendeeSessions(accountId, now);
  await writeAuditLog({
    actorUserId,
    action: "ATTENDEE_MFA_RESET",
    entityType: "AttendeeAccount",
    entityId: accountId,
    summary: "A system administrator reset an account's two-step sign-in.",
  });
}

export async function signOutAttendeeEverywhere(accountId: string, actorUserId: string) {
  await requireAttendee(accountId);
  await revokeAllAttendeeSessions(accountId);
  await writeAuditLog({
    actorUserId,
    action: "ATTENDEE_SIGNED_OUT_BY_ADMIN",
    entityType: "AttendeeAccount",
    entityId: accountId,
    summary: "A system administrator signed an account out everywhere.",
  });
}

/**
 * Changes an account's email. Registrations are found by verified email, so
 * the account will see registrations made with the new address, not the old,
 * once the new address is verified: the change clears `emailVerifiedAt`.
 */
export async function changeAttendeeEmail(accountId: string, email: string, actorUserId: string) {
  const current = await requireAttendee(accountId);
  if (current.email === email) throw new UserAdminError("EMAIL_UNCHANGED", "That is already this account's email.");
  const link = await activeLinkForAccount(accountId);
  if (link) return changeLinkedEmailTogether(link, email, actorUserId);
  const taken = await getPrisma().attendeeAccount.findFirst({ where: { email, id: { not: accountId } }, select: { id: true } });
  if (taken) throw new UserAdminError("EMAIL_IN_USE", "Another account already uses that email.");
  // Registrations are claimed by VERIFIED email and an administrator typing an address verifies
  // nothing, so the verification is cleared (Caleb, Oct 15, 2026). This is an admin-tool safety
  // fix and applies whether or not the one-sign-in switch is on. The person verifies the new
  // address again (a password reset code or Google sign-in for that address does it).
  // The write and the token spend are one transaction: every unused reset or verification code
  // was emailed to the OLD address and must not verify the new one.
  await getPrisma().$transaction([
    getPrisma().attendeeAccount.update({ where: { id: accountId }, data: { email, emailVerifiedAt: null } }),
    getPrisma().attendeeAccountToken.updateMany({ where: { accountId, usedAt: null }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllAttendeeSessions(accountId);
  await writeAuditLog({
    actorUserId,
    action: "ATTENDEE_EMAIL_CHANGED",
    entityType: "AttendeeAccount",
    entityId: accountId,
    summary: "A system administrator changed an account's email.",
  });
}

/**
 * "Send verification email" (#554 slice c): the way an administrator fixes an
 * unverified attendee address. There is no "mark verified" switch: the code is
 * mailed to the account's CURRENT address and the address is verified only when
 * the person types it back (`verifyAttendeeEmailByAddress`). System administrator
 * only (re-checked in the database), rate-limited, audited with ids only. Returns
 * the queued message id so the route can deliver it after the response.
 */
export async function sendAttendeeVerificationByAdmin(accountId: string, actorUserId: string) {
  await getPrisma().$transaction((tx) => requireSystemAdminActor(tx, actorUserId));
  const account = await getPrisma().attendeeAccount.findUnique({
    where: { id: accountId },
    select: { id: true, email: true, displayName: true, status: true, disabledAt: true, emailVerifiedAt: true },
  });
  if (!account) throw new UserAdminError("ACCOUNT_NOT_FOUND", "That account could not be found.");
  if (account.status !== "ACTIVE" || account.disabledAt) {
    throw new UserAdminError("ACCOUNT_NOT_USABLE", "Only an active account can be sent a verification email.");
  }
  if (account.emailVerifiedAt) throw new UserAdminError("ALREADY_VERIFIED", "That account's email is already verified.");
  const limit = await checkAdminVerificationEmailRateLimit(actorUserId, accountId);
  if (!limit.allowed) throw new UserAdminError("RATE_LIMITED", "Too many verification emails for this account. Try again later.");

  await beginAdminVerification(account.id);
  const dispatch = await queueAttendeeVerificationEmail({
    accountId: account.id,
    email: account.email,
    displayName: account.displayName,
    alreadyRegistered: false,
    adminSent: true,
  });
  if (!dispatch.configured) throw new UserAdminError("EMAIL_NOT_CONFIGURED", "Account email isn't set up on this server.");
  await writeAuditLog({
    actorUserId,
    action: "ATTENDEE_VERIFICATION_EMAIL_SENT_BY_ADMIN",
    entityType: "AttendeeAccount",
    entityId: account.id,
    summary: "A system administrator sent an account a verification email.",
    metadata: { attendeeAccountId: account.id },
  });
  return { messageId: dispatch.messageId };
}
