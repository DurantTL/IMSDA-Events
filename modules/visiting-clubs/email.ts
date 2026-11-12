import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { getPrisma } from "@/lib/prisma";
import { createOpaqueToken, hashOpaqueToken } from "@/modules/access/tokens";
import { neutralizePlaceholders } from "@/modules/club-applications/email";
import { AccountEmailNotConfiguredError, getAccountEmailSender } from "@/modules/communications/account-email";
import { visitingClubInvitePath } from "@/modules/visiting-clubs/domain";

/**
 * Visiting club email (#835). Three messages, all queued in the account slice of the outbox (no event, sender from
 * `ACCOUNT_EMAIL_*`) in the same transaction as the change they announce, then delivered best-effort once it commits
 * (`modules/club-applications/deliver.ts`):
 *
 * - To a visiting director with their private link for one event. Like the new club application link (#817), the body
 *   holds a sentinel and never a token: the token is minted at delivery and only its SHA-256 is stored.
 * - To the director when staff approve: they can now register their club (a link to their account, no secret).
 * - To the director when staff decline, with the reason when one was given.
 *
 * Free text goes into a body that delivery scans for `{{...}}` sentinels, so it is neutralized first.
 */

type Outbox = Pick<Prisma.TransactionClient, "messageOutbox">;

export const VISITING_CLUB_LINK_SENTINEL = "{{visiting_club_link}}";
export const VISITING_CLUB_INVITE_TEMPLATE_KEY = "VISITING_CLUB_INVITE";

function link(path: string) {
  try {
    return new URL(path, getServerEnv().APP_BASE_URL).toString();
  } catch {
    return path;
  }
}

async function sender() {
  try {
    return getAccountEmailSender();
  } catch (error) {
    if (error instanceof AccountEmailNotConfiguredError) return null;
    throw error;
  }
}

export async function queueVisitingInviteEmail(
  client: Outbox,
  input: { inviteId: string; email: string; name: string; eventName: string; days: number },
): Promise<string | null> {
  const from = await sender();
  if (!from) return null;
  const name = neutralizePlaceholders(input.name.trim()) || "there";
  const eventName = neutralizePlaceholders(input.eventName);
  const message = await client.messageOutbox.create({
    data: {
      eventId: null,
      templateKey: VISITING_CLUB_INVITE_TEMPLATE_KEY,
      recipientKind: "ACCOUNT",
      recipientEmail: input.email,
      recipientName: input.name.trim() || null,
      senderNameSnapshot: from.name,
      senderEmailSnapshot: from.address,
      replyToEmailSnapshot: from.replyTo,
      subjectSnapshot: `Bring your club to ${eventName}`,
      bodyTextSnapshot: [
        `Hello ${name},`,
        "",
        `The Iowa-Missouri Conference has invited your club to ${eventName} as a visiting club. Open your private link, sign in or create an account with this email address, and tell us about your club:`,
        "",
        VISITING_CLUB_LINK_SENTINEL,
        "",
        `The link works once and expires in ${input.days} days. After you send your request, conference staff review it before your club can register.`,
        "",
        "Please don't forward this email. If you weren't expecting it, you can ignore it. Nothing happens unless you fill in the form.",
        "",
        "IMAdventist",
      ].join("\n"),
      metadata: { trigger: VISITING_CLUB_INVITE_TEMPLATE_KEY, inviteId: input.inviteId, accountEmail: false, realDelivery: true },
      idempotencyKey: `visiting-club-invite:${input.inviteId}:${randomUUID()}`,
      correlationId: randomUUID(),
      status: "PENDING",
    },
    select: { id: true },
  });
  return message.id;
}

export async function queueVisitingApprovedEmail(
  client: Outbox,
  input: { requestId: string; email: string; directorName: string; clubName: string; eventName: string },
): Promise<string[]> {
  const from = await sender();
  if (!from) return [];
  const name = neutralizePlaceholders(input.directorName.trim()) || "there";
  const clubName = neutralizePlaceholders(input.clubName);
  const eventName = neutralizePlaceholders(input.eventName);
  const message = await client.messageOutbox.create({
    data: {
      eventId: null,
      templateKey: "VISITING_CLUB_APPROVED",
      recipientKind: "ACCOUNT",
      recipientEmail: input.email,
      recipientName: input.directorName.trim() || null,
      senderNameSnapshot: from.name,
      senderEmailSnapshot: from.address,
      replyToEmailSnapshot: from.replyTo,
      subjectSnapshot: `${clubName} is approved for ${eventName}`,
      bodyTextSnapshot: [
        `Hello ${name},`,
        "",
        `${clubName} was approved as a visiting club for ${eventName}. You can now register your club. Sign in to your account to get started:`,
        "",
        link("/account"),
        "",
        "IMAdventist",
      ].join("\n"),
      metadata: { trigger: "VISITING_CLUB_APPROVED", requestId: input.requestId, accountEmail: true, realDelivery: true },
      idempotencyKey: `visiting-club-request:${input.requestId}:approved`,
      correlationId: randomUUID(),
      status: "PENDING",
    },
    select: { id: true },
  });
  return [message.id];
}

export async function queueVisitingDeclinedEmail(
  client: Outbox,
  input: { requestId: string; email: string; directorName: string; clubName: string; eventName: string; reason: string | null },
): Promise<string[]> {
  const from = await sender();
  if (!from) return [];
  const name = neutralizePlaceholders(input.directorName.trim()) || "there";
  const clubName = neutralizePlaceholders(input.clubName);
  const eventName = neutralizePlaceholders(input.eventName);
  const reason = input.reason ? neutralizePlaceholders(input.reason) : null;
  const message = await client.messageOutbox.create({
    data: {
      eventId: null,
      templateKey: "VISITING_CLUB_DECLINED",
      recipientKind: "ACCOUNT",
      recipientEmail: input.email,
      recipientName: input.directorName.trim() || null,
      senderNameSnapshot: from.name,
      senderEmailSnapshot: from.address,
      replyToEmailSnapshot: from.replyTo,
      subjectSnapshot: `Your request for ${clubName}`,
      bodyTextSnapshot: [
        `Hello ${name},`,
        "",
        `Thank you for asking to bring ${clubName} to ${eventName}. The conference was not able to approve the request at this time.`,
        ...(reason ? ["", "Reason:", reason] : []),
        "",
        "If you have questions, or things change, please contact the conference youth department.",
        "",
        "IMAdventist",
      ].join("\n"),
      metadata: { trigger: "VISITING_CLUB_DECLINED", requestId: input.requestId, accountEmail: true, realDelivery: true },
      idempotencyKey: `visiting-club-request:${input.requestId}:declined`,
      correlationId: randomUUID(),
      status: "PENDING",
    },
    select: { id: true },
  });
  return [message.id];
}

const UNDELIVERABLE = "A visiting club link can't be delivered: it was withdrawn, used or has expired.";

/**
 * Delivery-time preparation for the invite message: mints the token, stores only its hash (replacing any earlier
 * attempt's), and swaps the sentinel for the link. Refuses when the invite was cancelled, used or has expired.
 */
export async function prepareVisitingInviteBodyForDelivery(input: { messageId: string; bodyText: string; now: Date }) {
  if (!input.bodyText.includes(VISITING_CLUB_LINK_SENTINEL)) return { bodyText: input.bodyText };
  const prisma = getPrisma();
  const invite = await prisma.visitingClubInvite.findUnique({
    where: { messageId: input.messageId },
    select: { id: true, usedAt: true, cancelledAt: true, expiresAt: true },
  });
  if (!invite || invite.usedAt || invite.cancelledAt || invite.expiresAt <= input.now) throw new Error(UNDELIVERABLE);
  const token = createOpaqueToken();
  const guarded = await prisma.visitingClubInvite.updateMany({
    where: { id: invite.id, usedAt: null, cancelledAt: null, expiresAt: { gt: input.now } },
    data: { tokenHash: hashOpaqueToken(token) },
  });
  if (guarded.count === 0) throw new Error(UNDELIVERABLE);
  return {
    bodyText: input.bodyText.replaceAll(VISITING_CLUB_LINK_SENTINEL, link(visitingClubInvitePath(token))),
    revokeOnDefinitiveFailure: async () => {
      await prisma.visitingClubInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { cancelledAt: input.now, tokenHash: null },
      });
    },
  };
}

/** Withdraws the link a message carried when its email finally fails. Safe for any message. */
export async function retireVisitingInviteForMessage(
  client: Pick<Prisma.TransactionClient, "visitingClubInvite">,
  messageId: string,
  now: Date,
) {
  const retired = await client.visitingClubInvite.updateMany({
    where: { messageId, usedAt: null, cancelledAt: null },
    data: { cancelledAt: now, tokenHash: null },
  });
  return retired.count;
}
