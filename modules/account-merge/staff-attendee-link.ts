import "server-only";

import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { canReuseAttendeeAccount, normalizeLinkEmail } from "@/modules/account-merge/link-rules";

/**
 * Creating the staff `User` <-> `AttendeeAccount` link for NEW staff (#554,
 * ADR 0013, slice (b)). Both entry points run only when
 * `PlatformSettings.unifiedSignInEnabled` is true; with it false they return
 * "disabled" without touching a row, so behaviour is exactly as before.
 *
 * Neither one backfills: they act on one person at the moment that person is
 * invited or activates. Linking people who already exist is a human-approved
 * later slice (d).
 *
 * Audit entries carry ids only, never emails or names.
 */

type Tx = Prisma.TransactionClient;

export type ActivationLinkOutcome =
  | "disabled"
  | "already_linked"
  | "linked_existing"
  | "created"
  | "needs_review";

const accountSelect = {
  id: true,
  email: true,
  status: true,
  emailVerifiedAt: true,
  disabledAt: true,
  linkedUser: { select: { id: true } },
} as const;

/**
 * Run inside the activation transaction, right after a PENDING_ACTIVATION user
 * became ACTIVE. Gives the new staff member a verified attendee account:
 *
 * - an existing account with the same normalised email is REUSED only when it is
 *   verified, active, not disabled and linked to nobody;
 * - when no account holds that email, one is created, already verified: the
 *   activation link proved control of the address (decision 4);
 * - when an account holds the email but may not be reused (unverified, disabled
 *   or linked elsewhere), nothing is linked, no account is verified on its
 *   behalf, and an audit entry marks the person for review. Activation itself
 *   still succeeds.
 */
export async function linkAttendeeSideAtActivation(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<ActivationLinkOutcome> {
  if (!(await isUnifiedSignInEnabled(tx))) return "disabled";

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, attendeeAccountId: true },
  });
  if (!user) return "disabled";
  if (user.attendeeAccountId) return "already_linked";

  const email = normalizeLinkEmail(user.email);
  // ON CONFLICT DO NOTHING: when an account already holds this email, nothing
  // is written and the transaction is not aborted by the unique index.
  const created = await tx.attendeeAccount.createMany({
    data: [{ email, displayName: user.displayName, status: "ACTIVE", emailVerifiedAt: now }],
    skipDuplicates: true,
  });
  const account = await tx.attendeeAccount.findUnique({ where: { email }, select: accountSelect });
  const reusable = account
    ? canReuseAttendeeAccount(
        {
          email: account.email,
          status: account.status,
          emailVerifiedAt: account.emailVerifiedAt,
          disabledAt: account.disabledAt,
          linkedUserId: account.linkedUser?.id ?? null,
        },
        user.email,
        user.id,
      )
    : false;

  if (!account || !reusable) {
    await writeAuditLog({
      actorUserId: user.id,
      action: "STAFF_ATTENDEE_LINK_NEEDS_REVIEW",
      entityType: "User",
      entityId: user.id,
      summary: "A new staff member's attendee account could not be linked automatically and needs review.",
      metadata: { attendeeAccountId: account?.id ?? null, reason: "EXISTING_ACCOUNT_NOT_REUSABLE" },
    }, tx);
    return "needs_review";
  }

  await tx.user.update({ where: { id: user.id }, data: { attendeeAccountId: account.id } });
  const wasCreated = created.count === 1;
  await writeAuditLog({
    actorUserId: user.id,
    action: wasCreated ? "STAFF_ATTENDEE_ACCOUNT_CREATED" : "STAFF_ATTENDEE_ACCOUNT_LINKED",
    entityType: "User",
    entityId: user.id,
    summary: wasCreated
      ? "A verified attendee account was created and linked when this staff member activated."
      : "An existing verified attendee account was linked when this staff member activated.",
    metadata: { attendeeAccountId: account.id },
  }, tx);
  return wasCreated ? "created" : "linked_existing";
}

/**
 * Run inside `addStaffMembership` when it is about to CREATE a staff `User`.
 * Returns the attendee account to link the new user to, so that granting a
 * staff role to an existing attendee gives that person a `User` attached to
 * THEIR account instead of a second identity. Null when the switch is off or no
 * reusable account holds the email (activation then creates or reviews one).
 */
export async function attendeeAccountToLinkForNewStaff(tx: Tx, email: string): Promise<string | null> {
  if (!(await isUnifiedSignInEnabled(tx))) return null;
  const normalized = normalizeLinkEmail(email);
  const account = await tx.attendeeAccount.findUnique({ where: { email: normalized }, select: accountSelect });
  if (!account) return null;
  const reusable = canReuseAttendeeAccount(
    {
      email: account.email,
      status: account.status,
      emailVerifiedAt: account.emailVerifiedAt,
      disabledAt: account.disabledAt,
      linkedUserId: account.linkedUser?.id ?? null,
    },
    normalized,
  );
  return reusable ? account.id : null;
}
