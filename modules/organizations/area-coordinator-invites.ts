import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { getPrisma } from "@/lib/prisma";
import { resolveClubsActor } from "@/modules/access/admin-roles";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { queueAccountInviteMessage } from "@/modules/communications/account-invite-message";
import {
  CLUB_INVITE_LIFETIME_DAYS,
  CLUB_INVITE_RESEND_COOLDOWN_MINUTES,
  clubInviteExpiry,
  clubInviteSignUpUrl,
} from "@/modules/club-imports/invites";
import { neutralizePlaceholders } from "@/modules/club-applications/email";
import { applyAreaCoordinatorChange, requireAreaCoordinatorActor } from "@/modules/organizations/area-coordinators";

/**
 * Area Coordinator invites (#1276): for an email with no website account yet. The same pattern as a club invite
 * (`modules/club-imports/invites.ts`): the invite is SENT, the email carries no secret, and the grant is created only
 * when the account whose verified email matches accepts from its account page. A grant made by an invite is only as good
 * as the person who sent it, so accepting re-checks that they are still a system administrator or an active Clubs
 * Administrator.
 */

export type AreaCoordinatorInviteErrorCode =
  | "INVITE_NOT_FOUND"
  | "INVITE_NOT_OPEN"
  | "INVITE_EXPIRED"
  | "INVITE_ALREADY_OPEN"
  | "INVITE_RESEND_TOO_SOON"
  | "EMAIL_NOT_CONFIGURED";

export class AreaCoordinatorInviteError extends Error {
  constructor(public readonly code: AreaCoordinatorInviteErrorCode, message: string) {
    super(message);
    this.name = "AreaCoordinatorInviteError";
  }
}

const OPEN_STATUSES = ["PENDING", "SENT"] as const;

function inviteEmailContent(rawInput: { name: string; email: string }) {
  const name = neutralizePlaceholders(rawInput.name.trim());
  const signUpUrl = clubInviteSignUpUrl(rawInput.email);
  return {
    subject: "You're invited to be an Area Coordinator on IMSDA Events",
    bodyText: [
      `Hello ${name || "there"},`,
      "",
      "The Iowa-Missouri Conference has invited you as an Area Coordinator on IMSDA Events. Area Coordinators see every club, view only (ages, not birth dates).",
      "",
      "To accept:",
      `1. New to IMSDA Events? Create your account at ${signUpUrl}`,
      `   Already have one? Sign in at ${new URL("/account/sign-in", getServerEnv().APP_BASE_URL).toString()}`,
      `2. Use this email address: ${rawInput.email}`,
      "3. On your account page, choose Accept next to the Area Coordinator invite.",
      "",
      `This invite expires in ${CLUB_INVITE_LIFETIME_DAYS} days.`,
      "",
      "If you weren't expecting this, you can ignore it. Nothing happens unless you accept.",
      "",
      "IMSDA Events",
    ].join("\n"),
  };
}

function queueMessage(tx: Prisma.TransactionClient, invite: { id: string; email: string; name: string }, correlationId?: string) {
  return queueAccountInviteMessage(tx, {
    recipient: { email: invite.email, name: invite.name },
    content: inviteEmailContent(invite),
    trigger: "AREA_COORDINATOR_INVITE_SENT",
    reference: { areaCoordinatorInviteId: invite.id },
    idempotencyPrefix: "area-coordinator-invite",
    entityId: invite.id,
    correlationId,
  });
}

/** An open (pending or sent) Area Coordinator invite for this email, expired or not. */
export function findOpenAreaCoordinatorInvite(client: Prisma.TransactionClient | ReturnType<typeof getPrisma>, email: string) {
  return client.areaCoordinatorInvite.findFirst({ where: { email, status: { in: [...OPEN_STATUSES] } }, select: { id: true } });
}

/**
 * Creates the invite inside the caller's transaction. With account email set up it is emailed (and `sentCount` is 1);
 * without it the invite is still SENT, since acceptance is by verified email, and nothing is queued: staff pass the
 * sign-up link on themselves. One open invite per email.
 */
export async function createAreaCoordinatorInvite(
  tx: Prisma.TransactionClient,
  input: { email: string; name: string; actorUserId: string },
  now = new Date(),
) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (await findOpenAreaCoordinatorInvite(tx, email)) {
    throw new AreaCoordinatorInviteError("INVITE_ALREADY_OPEN", `There's already a pending Area Coordinator invite for ${email}. Resend or cancel it from People & access.`);
  }
  const canSend = isAccountEmailConfigured();
  const invite = await tx.areaCoordinatorInvite.create({
    data: {
      email,
      name,
      status: "SENT",
      createdByUserId: input.actorUserId,
      sentAt: now,
      sentCount: canSend ? 1 : 0,
      expiresAt: clubInviteExpiry(now),
    },
    select: { id: true },
  });
  let messageId: string | null = null;
  if (canSend) {
    messageId = await queueMessage(tx, { id: invite.id, email, name });
    await tx.areaCoordinatorInvite.update({ where: { id: invite.id }, data: { lastMessageId: messageId } });
  }
  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "AREA_COORDINATOR_INVITE_CREATED",
    entityType: "AreaCoordinatorInvite",
    entityId: invite.id,
    summary: "Invited someone as an Area Coordinator from People & access.",
    metadata: { emailQueued: canSend },
  }, tx);
  return { inviteId: invite.id, messageId };
}

/** Sent invites waiting for this account, matched on its verified email. Excludes expired ones. */
export async function listAreaCoordinatorInvitesForAccount(verifiedEmail: string, now = new Date()) {
  const invites = await getPrisma().areaCoordinatorInvite.findMany({
    where: {
      email: verifiedEmail.trim().toLowerCase(),
      status: "SENT",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { sentAt: "desc" },
    select: { id: true },
  });
  return invites.map((invite) => ({ id: invite.id }));
}

/**
 * The invited person accepts. As for club invites, the guarded status write comes before the grant, in the same
 * transaction, so two concurrent accepts create one grant. An invite for another email is answered exactly like a
 * missing one.
 */
export async function acceptAreaCoordinatorInvite(inviteId: string, account: { id: string; verifiedEmail: string }, now = new Date()) {
  return getPrisma().$transaction(async (tx) => {
    const invite = await tx.areaCoordinatorInvite.findUnique({
      where: { id: inviteId },
      select: { id: true, email: true, status: true, expiresAt: true, createdByUserId: true },
    });
    if (!invite || invite.email !== account.verifiedEmail.trim().toLowerCase()) {
      throw new AreaCoordinatorInviteError("INVITE_NOT_FOUND", "That invite could not be found for this account.");
    }
    if (invite.status !== "SENT") throw new AreaCoordinatorInviteError("INVITE_NOT_OPEN", "That invite is no longer open.");
    if (invite.expiresAt && invite.expiresAt <= now) {
      throw new AreaCoordinatorInviteError("INVITE_EXPIRED", "That invite has expired. Ask your conference registrar to send a new one.");
    }
    // Only as good as the person who sent it: they must still be a system administrator or an active Clubs Administrator.
    const inviter = invite.createdByUserId ? await resolveClubsActor(invite.createdByUserId, tx) : null;
    if (!invite.createdByUserId || !inviter) {
      throw new AreaCoordinatorInviteError("INVITE_NOT_OPEN", "That invite is no longer open.");
    }

    const guarded = await tx.areaCoordinatorInvite.updateMany({
      where: { id: invite.id, status: "SENT" },
      data: { status: "ACCEPTED", acceptedAt: now, acceptedAccountId: account.id },
    });
    if (guarded.count === 0) throw new AreaCoordinatorInviteError("INVITE_NOT_OPEN", "That invite is no longer open.");

    await applyAreaCoordinatorChange(tx, account.id, true, invite.createdByUserId, now, {
      viaClubsAdministrator: inviter.viaClubsAdministrator,
      viaInviteId: invite.id,
    });
    await writeAuditLog({
      action: "AREA_COORDINATOR_INVITE_ACCEPTED",
      entityType: "AreaCoordinatorInvite",
      entityId: invite.id,
      summary: "Accepted an Area Coordinator invite.",
      metadata: { actorAttendeeAccountId: account.id },
    }, tx);
  });
}

/**
 * Staff resend an open invite: a fresh expiry and send count, rate-limited like a club invite. The actor is re-checked
 * from the database, and the status write is guarded so a resend racing a cancel or an accept cannot both win.
 */
export async function resendAreaCoordinatorInvite(inviteId: string, actorUserId: string, now = new Date()) {
  await requireAreaCoordinatorActor(actorUserId);
  if (!isAccountEmailConfigured()) {
    throw new AreaCoordinatorInviteError("EMAIL_NOT_CONFIGURED", "Account email isn't set up on this server, so invites can't be sent yet.");
  }
  return getPrisma().$transaction(async (tx) => {
    const invite = await tx.areaCoordinatorInvite.findUnique({
      where: { id: inviteId },
      select: { id: true, email: true, name: true, status: true, sentAt: true },
    });
    if (!invite) throw new AreaCoordinatorInviteError("INVITE_NOT_FOUND", "That invite could not be found.");
    if (invite.status !== "SENT" && invite.status !== "PENDING") {
      throw new AreaCoordinatorInviteError("INVITE_NOT_OPEN", "That invite was already accepted or cancelled.");
    }
    if (invite.sentAt && now.getTime() - invite.sentAt.getTime() < CLUB_INVITE_RESEND_COOLDOWN_MINUTES * 60 * 1000) {
      throw new AreaCoordinatorInviteError("INVITE_RESEND_TOO_SOON", `Wait at least ${CLUB_INVITE_RESEND_COOLDOWN_MINUTES} minutes between resends.`);
    }
    const guarded = await tx.areaCoordinatorInvite.updateMany({
      where: { id: invite.id, status: { in: [...OPEN_STATUSES] } },
      data: { status: "SENT", sentAt: now, sentCount: { increment: 1 }, expiresAt: clubInviteExpiry(now) },
    });
    if (guarded.count === 0) throw new AreaCoordinatorInviteError("INVITE_NOT_OPEN", "That invite was already accepted or cancelled.");
    const messageId = await queueMessage(tx, invite, randomUUID());
    await tx.areaCoordinatorInvite.update({ where: { id: invite.id }, data: { lastMessageId: messageId } });
    await writeAuditLog({
      actorUserId,
      action: "AREA_COORDINATOR_INVITE_RESENT",
      entityType: "AreaCoordinatorInvite",
      entityId: invite.id,
      summary: "Resent an Area Coordinator invite.",
    }, tx);
    return { messageId };
  });
}

/** Staff cancel an open invite. The actor is re-checked from the database; the guarded write and its audit entry share a transaction. */
export async function cancelAreaCoordinatorInvite(inviteId: string, actorUserId: string, now = new Date()) {
  await requireAreaCoordinatorActor(actorUserId);
  await getPrisma().$transaction(async (tx) => {
    const invite = await tx.areaCoordinatorInvite.findUnique({ where: { id: inviteId }, select: { id: true, status: true } });
    if (!invite) throw new AreaCoordinatorInviteError("INVITE_NOT_FOUND", "That invite could not be found.");
    if (invite.status !== "SENT" && invite.status !== "PENDING") {
      throw new AreaCoordinatorInviteError("INVITE_NOT_OPEN", "That invite was already accepted or cancelled.");
    }
    const guarded = await tx.areaCoordinatorInvite.updateMany({
      where: { id: invite.id, status: { in: [...OPEN_STATUSES] } },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    if (guarded.count === 0) throw new AreaCoordinatorInviteError("INVITE_NOT_OPEN", "That invite was already accepted or cancelled.");
    await writeAuditLog({
      actorUserId,
      action: "AREA_COORDINATOR_INVITE_CANCELLED",
      entityType: "AreaCoordinatorInvite",
      entityId: invite.id,
      summary: "Cancelled an Area Coordinator invite.",
    }, tx);
  });
}
