import "server-only";

import type { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { getPrisma } from "@/lib/prisma";
import { createOpaqueToken, hashOpaqueToken } from "@/modules/access/tokens";
import { neutralizePlaceholders } from "@/modules/club-applications/email";

/**
 * The one email that hands a staff-started registration to its registrant (#1510). Like a club form's private link, the
 * body holds a sentinel and never a token: the token is minted when the message is actually delivered and only its SHA-256
 * is stored, so a database read, an outbox row, an audit row or a log line never yields a usable link. The email carries
 * the staff member's name and the event's name and no answer. A definitive delivery failure withdraws the link again.
 */

export const STAFF_DRAFT_LINK_SENTINEL = "{{staff_registration_draft_link}}";
export const STAFF_DRAFT_LINK_TEMPLATE_KEY = "STAFF_REGISTRATION_DRAFT_LINK";

export function staffDraftLinkPath(token: string) {
  return `/register/finish/${encodeURIComponent(token)}`;
}

export function staffDraftLinkEmailContent(input: { staffName: string; eventName: string; expiresOn: string }) {
  const staffName = neutralizePlaceholders(input.staffName.trim() || "A staff member");
  const eventName = neutralizePlaceholders(input.eventName);
  return {
    subject: `Finish your registration for ${eventName}`,
    bodyText: [
      "Hello,",
      "",
      `${staffName} at the Iowa-Missouri Conference started your registration for ${eventName}. Open this private link to check your answers, add the rest and submit.`,
      "",
      STAFF_DRAFT_LINK_SENTINEL,
      "",
      `The link works until ${input.expiresOn}. Nothing is registered until you submit the form.`,
      "",
      "Please don't forward this email: anyone who has the link can finish the registration. If you weren't expecting it, you can ignore it.",
      "",
      "IMAdventist",
    ].join("\n"),
  };
}

/**
 * Withdraws the link a message carried, whenever that message's email finally fails. The draft goes back to being entered,
 * so staff can see it and send it again. A draft already submitted, or already sent with a newer message, is left alone.
 * Safe to call for any message: one that carries no link matches nothing.
 */
export async function retireStaffDraftLinkForMessage(
  client: Pick<Prisma.TransactionClient, "staffRegistrationDraft">,
  messageId: string,
  _now: Date,
) {
  void _now;
  const retired = await client.staffRegistrationDraft.updateMany({
    where: { handOffMessageId: messageId, status: "HANDED_OFF" },
    data: { status: "OPEN", handOffTokenHash: null, handOffExpiresAt: null, handOffMessageId: null },
  });
  return retired.count;
}

/**
 * Delivery-time preparation, called by the outbox worker for a message whose template key is STAFF_REGISTRATION_DRAFT_LINK.
 * Mints the token, stores only its hash on the draft (replacing any hash from an earlier attempt), and swaps the sentinel
 * for the URL. Refuses when the draft was edited, discarded, submitted, sent again with a newer message, or has expired.
 */
export async function prepareStaffDraftLinkBodyForDelivery(input: { messageId: string; bodyText: string; now: Date }) {
  if (!input.bodyText.includes(STAFF_DRAFT_LINK_SENTINEL)) return { bodyText: input.bodyText };
  const prisma = getPrisma();
  const draft = await prisma.staffRegistrationDraft.findUnique({
    where: { handOffMessageId: input.messageId },
    select: { id: true, status: true, handOffExpiresAt: true },
  });
  const unavailable = "A registration link can't be delivered: it was withdrawn, used or has expired.";
  if (!draft || draft.status !== "HANDED_OFF" || !draft.handOffExpiresAt || draft.handOffExpiresAt <= input.now) throw new Error(unavailable);
  const token = createOpaqueToken();
  const guarded = await prisma.staffRegistrationDraft.updateMany({
    where: { id: draft.id, status: "HANDED_OFF", handOffMessageId: input.messageId, handOffExpiresAt: { gt: input.now } },
    data: { handOffTokenHash: hashOpaqueToken(token) },
  });
  if (guarded.count === 0) throw new Error(unavailable);
  const url = new URL(staffDraftLinkPath(token), getServerEnv().APP_BASE_URL).toString();
  return {
    bodyText: input.bodyText.replaceAll(STAFF_DRAFT_LINK_SENTINEL, url),
    revokeOnDefinitiveFailure: async () => {
      await retireStaffDraftLinkForMessage(prisma, input.messageId, input.now);
    },
  };
}
