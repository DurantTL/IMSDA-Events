import "server-only";

import { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { canReuseAttendeeAccount, normalizeLinkEmail } from "@/modules/account-merge/link-rules";

/**
 * Creating the staff `User` <-> `AttendeeAccount` link for NEW staff (#554,
 * ADR 0013, slice (b)). It runs only when `PlatformSettings.unifiedSignInEnabled`
 * is true; with it false it returns "disabled" without touching a row, so
 * behaviour is exactly as before.
 *
 * It links at a person's FIRST activation only, after the activation link proved
 * they control the inbox. It never links at grant time, never links someone who
 * was active before, and never backfills. Linking people who already exist is a
 * human-approved later slice (d).
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

export type NeedsReviewReason =
  | "EXISTING_ACCOUNT_NOT_REUSABLE"
  | "PREVIOUSLY_ACTIVE"
  | "TOKEN_NOT_EMAILED"
  | "LINK_CONFLICT";

const accountSelect = {
  id: true,
  email: true,
  status: true,
  emailVerifiedAt: true,
  disabledAt: true,
  linkedUser: { select: { id: true } },
} as const;

async function markNeedsReview(
  tx: Tx,
  userId: string,
  attendeeAccountId: string | null,
  reason: NeedsReviewReason,
): Promise<"needs_review"> {
  await writeAuditLog({
    actorUserId: userId,
    action: "STAFF_ATTENDEE_LINK_NEEDS_REVIEW",
    entityType: "User",
    entityId: userId,
    summary: "A staff member's attendee account was not linked automatically and needs review.",
    metadata: { attendeeAccountId, reason },
  }, tx);
  return "needs_review";
}

/**
 * Run inside the activation transaction, right after a PENDING_ACTIVATION user
 * became ACTIVE. Gives the new staff member a verified attendee account:
 *
 * - an existing account with the same normalised email is REUSED only when it is
 *   verified, active, not disabled and linked to nobody;
 * - when no account holds that email, one is created, already verified: the
 *   activation link proved control of the address (decision 4);
 * - otherwise nothing is linked, no one else's account is verified for them, and an
 *   audit entry marks the person for review. Activation itself still succeeds.
 *
 * Needs review, with nothing linked, also when: the user was active before
 * (PREVIOUSLY_ACTIVE: any session, authenticator enrolment or staff passkey row
 * exists, since a re-invite clears `activatedAt`), or the activation link was
 * printed by `scripts/create-admin.ts` for the operator to pass on instead of being
 * emailed (TOKEN_NOT_EMAILED: it did not prove the inbox).
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

  const [sessions, enrollments, passkeys, printedUrl] = await Promise.all([
    tx.userSession.count({ where: { userId: user.id } }),
    tx.userMfaEnrollment.count({ where: { userId: user.id } }),
    tx.userPasskey.count({ where: { userId: user.id } }),
    // create-admin without a password prints the activation URL (passwordSetDirectly is false).
    tx.auditLog.count({
      where: {
        // actorUserId + entityType keep this on the [actorUserId, createdAt] index.
        actorUserId: user.id,
        entityType: "User",
        entityId: user.id,
        action: { in: ["SYSTEM_ADMIN_BOOTSTRAPPED", "SYSTEM_ADMIN_PROMOTED"] },
        metadata: { path: ["passwordSetDirectly"], equals: false },
      },
    }),
  ]);
  if (sessions + enrollments + passkeys > 0) return markNeedsReview(tx, user.id, null, "PREVIOUSLY_ACTIVE");
  if (printedUrl > 0) return markNeedsReview(tx, user.id, null, "TOKEN_NOT_EMAILED");
  // With no account email configured the activation link is handed over by hand (the
  // memberships route returns `setupUrl` to the inviting admin, and outside production the
  // password-reset route returns `resetUrl`), so it did not prove the inbox either.
  if (!isAccountEmailConfigured()) return markNeedsReview(tx, user.id, null, "TOKEN_NOT_EMAILED");

  const email = normalizeLinkEmail(user.email);
  // ON CONFLICT DO NOTHING: when an account already holds this email, nothing
  // is written and the transaction is not aborted by the unique index.
  const created = await tx.attendeeAccount.createMany({
    data: [{ email, displayName: user.displayName, status: "ACTIVE", emailVerifiedAt: now }],
    skipDuplicates: true,
  });
  // Lock the account row, then re-read it, so the reuse rule is checked against a
  // state nobody can change until this transaction ends.
  await tx.$queryRaw`SELECT "id" FROM "AttendeeAccount" WHERE "email" = ${email} FOR UPDATE`;
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
    return markNeedsReview(tx, user.id, account?.id ?? null, "EXISTING_ACCOUNT_NOT_REUSABLE");
  }

  // A savepoint, so a unique-index conflict on the link becomes "needs review"
  // instead of failing (and rolling back) the whole activation.
  await tx.$executeRawUnsafe("SAVEPOINT staff_attendee_link");
  try {
    await tx.user.update({ where: { id: user.id }, data: { attendeeAccountId: account.id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT staff_attendee_link");
      return markNeedsReview(tx, user.id, account.id, "LINK_CONFLICT");
    }
    throw error;
  }
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
