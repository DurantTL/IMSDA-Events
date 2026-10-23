import "server-only";

import type { Prisma } from "@prisma/client";
import { loadEventEmailSettings } from "@/modules/communications/effective-delivery";
import { enqueueStaffRegistrationUpdatedMessage } from "@/modules/communications/transactional-messages";
import { recordAlertFeedItem } from "@/modules/notifications/feed";

/** The line at the top of the registrant's "Updated" confirmation: the PDF is the new copy, and replaces the old. */
export const REGISTRANT_UPDATED_PDF_NOTE = "Your updated registration copy is attached as a PDF. It replaces any earlier copy.";

/** The line at the top of the staff "Updated" copy. */
export const STAFF_UPDATED_PDF_NOTE = "This registration was changed. The attached PDF is the updated copy.";

function addresses(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim().toLowerCase()) : [];
}

/**
 * The staff "new registration" copy, re-sent marked "Updated" with the new registration PDF (#1082), to the same event
 * team addresses the first copy went to. Honors the staff-copy switch (read by the caller before its transaction opened).
 * The messages are queued like every other: the event's effective delivery decides whether they leave (a paused event
 * captures them, nothing is sent). One message per address and change, so a retried change queues nothing twice.
 */
export async function queueStaffUpdatedRegistrationCopies(
  tx: Prisma.TransactionClient,
  input: { eventId: string; registrationId: string; attachmentId: string; changeKey: string; correlationId: string; staffCopyEnabled: boolean; pricingSnapshot?: Record<string, unknown> },
) {
  if (!input.staffCopyEnabled) return { messageIds: [] as string[], pendingMessageIds: [] as string[] };
  const settings = await loadEventEmailSettings(tx, input.eventId);
  const messageIds: string[] = [];
  const pendingMessageIds: string[] = [];
  for (const email of [...new Set(addresses(settings?.internalNotificationEmails))]) {
    const queued = await enqueueStaffRegistrationUpdatedMessage(tx, {
      eventId: input.eventId,
      registrationId: input.registrationId,
      correlationId: input.correlationId,
      transitionKey: `${input.changeKey}:staff-copy`,
      recipientEmail: email,
      attachmentId: input.attachmentId,
      leadNote: STAFF_UPDATED_PDF_NOTE,
      ...(input.pricingSnapshot ? { pricingSnapshot: input.pricingSnapshot } : {}),
    });
    messageIds.push(...queued.messageIds);
    pendingMessageIds.push(...queued.pendingMessageIds);
  }
  // The feed item (#1033) beside the "Updated" staff copies, in the same transaction: one per change however many
  // addresses. Same alert and switch as the first copy. A link only.
  if (pendingMessageIds.length > 0) {
    await recordAlertFeedItem(tx, {
      notificationKey: "NEW_REGISTRATION_STAFF_COPY",
      occurrenceKey: `registration-updated:${input.registrationId}:${input.changeKey}`,
      summary: "A public registration was changed.",
      href: `/people?event=${encodeURIComponent(input.eventId)}`,
    });
  }
  return { messageIds, pendingMessageIds };
}
