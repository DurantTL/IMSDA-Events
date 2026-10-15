import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";

/**
 * Linking a person's staff `User` and `AttendeeAccount` by hand when their
 * emails differ (#554, ADR 0013, Caleb's Oct 15, 2026 decision). Slice (c).
 *
 * An admin tool, so it works with the one-sign-in switch off as well as on: it
 * only writes the nullable, unique `User.attendeeAccountId`. Rules:
 *
 * - SYSTEM ADMINISTRATOR only, checked here against the database as well as in
 *   the route (a caller cannot supply "I am an admin").
 * - A reason is required.
 * - Audited, ids only: the audit rows name the user, the account and the actor
 *   by id and carry the reason text the administrator typed. No email, name or
 *   other personal field is written (the UI tells the administrator not to put
 *   personal details in the reason).
 * - Refuses when either side is already linked (to anyone). Unlink first.
 * - Never creates, extends or elevates a staff session: nothing in this file
 *   touches `UserSession`, and a link is not a permission. Sign-in still
 *   decides staff access only from the staff credentials.
 * - The attendee side must be a real, usable account: ACTIVE, not disabled, and
 *   its OWN email verified (that is what its registrations are claimed by). The
 *   staff user must be ACTIVE. Equal emails are allowed too (the same tool),
 *   though activation and slice (d) link those automatically.
 */

export type HandLinkErrorCode =
  | "NOT_SYSTEM_ADMIN"
  | "REASON_REQUIRED"
  | "USER_NOT_FOUND"
  | "ACCOUNT_NOT_FOUND"
  | "USER_ALREADY_LINKED"
  | "ACCOUNT_ALREADY_LINKED"
  | "USER_NOT_ACTIVE"
  | "ACCOUNT_NOT_USABLE"
  | "NOT_LINKED";

export class HandLinkError extends Error {
  constructor(public readonly code: HandLinkErrorCode, message: string) {
    super(message);
    this.name = "HandLinkError";
  }
}

export const HAND_LINK_REASON_MIN = 5;
export const HAND_LINK_REASON_MAX = 500;

export function cleanHandLinkReason(reason: unknown): string {
  const text = typeof reason === "string" ? reason.trim().replace(/\s+/g, " ") : "";
  if (text.length < HAND_LINK_REASON_MIN) {
    throw new HandLinkError("REASON_REQUIRED", "Give a reason of at least a few words. Do not include personal details.");
  }
  return text.slice(0, HAND_LINK_REASON_MAX);
}

type Tx = Prisma.TransactionClient;

async function requireSystemAdminActor(tx: Tx, actorUserId: string) {
  const actor = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { globalRole: true, accountStatus: true },
  });
  if (!actor || actor.globalRole !== "SYSTEM_ADMIN" || actor.accountStatus !== "ACTIVE") {
    throw new HandLinkError("NOT_SYSTEM_ADMIN", "Only a system administrator can link or unlink a person's sign-ins.");
  }
}

/** Looks up the staff user for an administrator-typed address. Administrator-only; reveals nothing to anyone else. */
export async function findStaffUserIdByEmail(email: string): Promise<string> {
  const user = await getPrisma().user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  });
  if (!user) throw new HandLinkError("USER_NOT_FOUND", "No team account uses that email.");
  return user.id;
}

const USER_LINKED = "That team account is already linked to an attendee account. Unlink it first.";
const ACCOUNT_LINKED = "That account is already linked to a team account. Unlink it first.";

export async function linkStaffAndAttendeeByHand(
  input: { userId: string; attendeeAccountId: string; reason: unknown },
  actorUserId: string,
) {
  const reason = cleanHandLinkReason(input.reason);
  try {
    await getPrisma().$transaction(async (tx) => {
      await requireSystemAdminActor(tx, actorUserId);
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, accountStatus: true, attendeeAccountId: true },
      });
      if (!user) throw new HandLinkError("USER_NOT_FOUND", "That team account could not be found.");
      const account = await tx.attendeeAccount.findUnique({
        where: { id: input.attendeeAccountId },
        select: { id: true, status: true, disabledAt: true, emailVerifiedAt: true, linkedUser: { select: { id: true } } },
      });
      if (!account) throw new HandLinkError("ACCOUNT_NOT_FOUND", "That account could not be found.");
      if (user.attendeeAccountId) throw new HandLinkError("USER_ALREADY_LINKED", USER_LINKED);
      if (account.linkedUser) throw new HandLinkError("ACCOUNT_ALREADY_LINKED", ACCOUNT_LINKED);
      if (user.accountStatus !== "ACTIVE") throw new HandLinkError("USER_NOT_ACTIVE", "The team account must be active before it can be linked.");
      if (account.status !== "ACTIVE" || account.disabledAt || !account.emailVerifiedAt) {
        throw new HandLinkError("ACCOUNT_NOT_USABLE", "The account must be active, not disabled, and have a verified email.");
      }
      // Conditional write: a concurrent link loses here rather than overwriting.
      const claimed = await tx.user.updateMany({
        where: { id: user.id, attendeeAccountId: null },
        data: { attendeeAccountId: account.id },
      });
      if (claimed.count !== 1) throw new HandLinkError("USER_ALREADY_LINKED", USER_LINKED);
      const metadata = { userId: user.id, attendeeAccountId: account.id, reason, method: "HAND_LINK" };
      const summary = "A system administrator linked a team account and an attendee account by hand.";
      await writeAuditLog({
        actorUserId, action: "STAFF_ATTENDEE_HAND_LINKED", entityType: "User", entityId: user.id, summary, metadata,
      }, tx);
      await writeAuditLog({
        actorUserId, action: "STAFF_ATTENDEE_HAND_LINKED", entityType: "AttendeeAccount", entityId: account.id, summary, metadata,
      }, tx);
    });
  } catch (error) {
    // The unique index on the column is the backstop for the account side.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HandLinkError("ACCOUNT_ALREADY_LINKED", ACCOUNT_LINKED);
    }
    throw error;
  }
}

export async function unlinkStaffAndAttendee(
  input: { attendeeAccountId: string; reason: unknown },
  actorUserId: string,
) {
  const reason = cleanHandLinkReason(input.reason);
  await getPrisma().$transaction(async (tx) => {
    await requireSystemAdminActor(tx, actorUserId);
    const linked = await tx.user.findUnique({
      where: { attendeeAccountId: input.attendeeAccountId },
      select: { id: true },
    });
    if (!linked) throw new HandLinkError("NOT_LINKED", "That account is not linked to a team account.");
    const cleared = await tx.user.updateMany({
      where: { id: linked.id, attendeeAccountId: input.attendeeAccountId },
      data: { attendeeAccountId: null },
    });
    if (cleared.count !== 1) throw new HandLinkError("NOT_LINKED", "That account is not linked to a team account.");
    const metadata = { userId: linked.id, attendeeAccountId: input.attendeeAccountId, reason };
    const summary = "A system administrator unlinked a team account from an attendee account.";
    await writeAuditLog({
      actorUserId, action: "STAFF_ATTENDEE_UNLINKED", entityType: "User", entityId: linked.id, summary, metadata,
    }, tx);
    await writeAuditLog({
      actorUserId, action: "STAFF_ATTENDEE_UNLINKED", entityType: "AttendeeAccount", entityId: input.attendeeAccountId, summary, metadata,
    }, tx);
  });
}
