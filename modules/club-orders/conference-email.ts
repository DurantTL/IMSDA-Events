import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { logError, logInfo } from "@/lib/logger";
import { AccountEmailNotConfiguredError, getAccountEmailSender, isAccountEmailConfigured } from "@/modules/communications/account-email";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { DEFAULT_CLUB_HELP_EMAIL } from "@/modules/event-info-cards/help-email";
import {
  conferenceOrderDirectorEmail,
  conferenceOrderStaffEmail,
  type ConferenceOrderEmailInput,
} from "@/modules/club-orders/conference-orders";

/**
 * Conference club order email (#1688), the same outbox path as the new club application notice (#817): queued in the
 * account slice of the outbox (no event, sender from `ACCOUNT_EMAIL_*`) in the same transaction as the order, then delivered
 * best-effort once it commits. One order email goes to the conference orders address, plus one confirmation to the director,
 * per submit; never a bulk send. The order email names the club, church and director and lists the items; it carries
 * no member data.
 */

type Outbox = Pick<Prisma.TransactionClient, "messageOutbox">;

/**
 * The address the order email goes to: the "conference orders email" platform setting, else the youth department's address.
 * Deliberately not the platform's email footer help address (`emailHelpEmail`, default support@imsda.org) or the Forms help
 * contact: those are the general support line, and the owner's default for these orders is youth@imsda.org (#1688).
 */
export function resolveConferenceOrdersEmail(setting: string | null | undefined) {
  return setting?.trim() || DEFAULT_CLUB_HELP_EMAIL;
}

function link(path: string) {
  try {
    return new URL(path, getServerEnv().APP_BASE_URL).toString();
  } catch {
    return path;
  }
}

export const CONFERENCE_ORDERS_STAFF_PATH = "/admin/club-supplies/conference-orders";

async function sender() {
  try {
    return getAccountEmailSender();
  } catch (error) {
    if (error instanceof AccountEmailNotConfiguredError) return null;
    throw error;
  }
}

export type QueueConferenceOrderEmailsInput = Omit<ConferenceOrderEmailInput, "reviewUrl"> & {
  orderId: string;
  /** The resolved conference orders address (`resolveConferenceOrdersEmail`). */
  staffEmail: string;
  /** Blank when the club has no director email on file: only the order email is sent. */
  directorEmail: string;
};

/** Queues the order email and the director's confirmation in the caller's transaction. Returns the outbox ids to deliver after it commits. */
export async function queueConferenceOrderEmails(client: Outbox, input: QueueConferenceOrderEmailsInput): Promise<string[]> {
  const from = await sender();
  if (!from) {
    logInfo("A conference club order was submitted but account email is not configured; no email was queued.", { orderId: input.orderId });
    return [];
  }
  const emailInput: ConferenceOrderEmailInput = { ...input, reviewUrl: link(CONFERENCE_ORDERS_STAFF_PATH) };
  const ids: string[] = [];
  const staff = conferenceOrderStaffEmail(emailInput);
  const staffMessage = await client.messageOutbox.create({
    data: {
      eventId: null,
      templateKey: "CONFERENCE_CLUB_ORDER_SUBMITTED",
      recipientKind: "INTERNAL",
      recipientEmail: input.staffEmail,
      recipientName: null,
      senderNameSnapshot: from.name,
      senderEmailSnapshot: from.address,
      replyToEmailSnapshot: from.replyTo,
      subjectSnapshot: staff.subject,
      bodyTextSnapshot: staff.bodyText,
      metadata: { trigger: "CONFERENCE_CLUB_ORDER_SUBMITTED", orderId: input.orderId, accountEmail: false, realDelivery: true },
      idempotencyKey: `conference-club-order:${input.orderId}:submitted`,
      correlationId: randomUUID(),
      status: "PENDING",
    },
    select: { id: true },
  });
  ids.push(staffMessage.id);
  if (input.directorEmail.trim()) {
    const confirmation = conferenceOrderDirectorEmail(emailInput);
    const confirmationMessage = await client.messageOutbox.create({
      data: {
        eventId: null,
        templateKey: "CONFERENCE_CLUB_ORDER_CONFIRMATION",
        recipientKind: "ACCOUNT",
        recipientEmail: input.directorEmail.trim(),
        recipientName: input.directorName.trim() || null,
        senderNameSnapshot: from.name,
        senderEmailSnapshot: from.address,
        replyToEmailSnapshot: from.replyTo,
        subjectSnapshot: confirmation.subject,
        bodyTextSnapshot: confirmation.bodyText,
        metadata: { trigger: "CONFERENCE_CLUB_ORDER_CONFIRMATION", orderId: input.orderId, accountEmail: true, realDelivery: true },
        idempotencyKey: `conference-club-order:${input.orderId}:confirmation`,
        correlationId: randomUUID(),
        status: "PENDING",
      },
      select: { id: true },
    });
    ids.push(confirmationMessage.id);
  }
  return ids;
}

/** Best-effort delivery after the transaction commits. Never throws; the outbox sweep retries what fails. */
export async function deliverConferenceOrderEmails(messageIds: readonly string[]): Promise<void> {
  if (messageIds.length === 0 || !isAccountEmailConfigured()) return;
  try {
    await processAccountEmailQueue({ messageIds: [...messageIds] });
  } catch (error) {
    logError("A conference club order email could not be delivered now.", error, { count: messageIds.length });
  }
}
