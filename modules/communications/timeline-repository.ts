import { getPrisma } from "@/lib/prisma";
import type { EventPermission } from "@/modules/access/permissions";
import {
  NO_TEMPLATE_VERSION_LABEL,
  REGISTRATION_TIMELINE_LIMIT,
  TIMELINE_EXCLUDED_RECIPIENT_KINDS,
  WITHHELD_SUBJECT,
  contentVisibility,
  messageTypeLabel,
  recipientRoleLabel,
  type MessageContentClass,
  type TimelineRecipientRole,
} from "@/modules/communications/timeline-domain";

/**
 * One row of a registration's communication timeline (#179). Read only: nothing here edits or deletes a message, and
 * a resend is a new row linked back to the one it repeats. `subject` and `bodyText` are decided on the server by
 * `contentVisibility`; a restricted row carries neither, so they never reach the browser.
 */
export type RegistrationTimelineRow = {
  id: string;
  templateKey: string;
  messageType: string;
  contentClass: MessageContentClass;
  /** True when the subject and text are withheld from this viewer. */
  contentWithheld: boolean;
  subject: string;
  bodyText: string | null;
  templateVersionNumber: number | null;
  templateVersionLabel: string;
  recipientName: string | null;
  recipientEmail: string;
  recipientRole: TimelineRecipientRole;
  senderName: string;
  replyTo: string | null;
  batch: { id: string; name: string } | null;
  /** The earlier message this one resends. */
  retryOfMessageId: string | null;
  /** Later messages that resent this one, oldest first. */
  resentByMessageIds: string[];
  status: string;
  providerDeliveryStatus: string | null;
  attemptCount: number;
  createdAt: string;
  capturedAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  lastError: string | null;
};

export type RegistrationTimeline = {
  rows: RegistrationTimelineRow[];
  limit: number;
  /** True when older messages exist beyond `limit`. */
  hasMore: boolean;
};

const iso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * The communication timeline of one registration of one event, newest first. Only messages stamped with both this
 * event and this registration are read, so another event's history never appears. The viewer's permissions come from the
 * server-side session; they decide which rows keep their subject and text.
 */
export async function loadRegistrationTimeline(input: {
  eventId: string;
  registrationId: string;
  permissions: readonly EventPermission[];
}): Promise<RegistrationTimeline | null> {
  const prisma = getPrisma();
  const registration = await prisma.registration.findFirst({ where: { id: input.registrationId, eventId: input.eventId }, select: { id: true } });
  if (!registration) return null;
  const rows = await prisma.messageOutbox.findMany({
    where: {
      eventId: input.eventId,
      registrationId: input.registrationId,
      recipientKind: { notIn: [...TIMELINE_EXCLUDED_RECIPIENT_KINDS] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: REGISTRATION_TIMELINE_LIMIT + 1,
    select: {
      id: true,
      templateKey: true,
      recipientKind: true,
      recipientEmail: true,
      recipientName: true,
      senderNameSnapshot: true,
      replyToEmailSnapshot: true,
      subjectSnapshot: true,
      bodyTextSnapshot: true,
      status: true,
      providerDeliveryStatus: true,
      attemptCount: true,
      retryOfMessageId: true,
      capturedAt: true,
      sentAt: true,
      deliveredAt: true,
      failedAt: true,
      lastError: true,
      createdAt: true,
      templateVersion: { select: { versionNumber: true } },
      retries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } },
      scheduledEmailRecipient: { select: { batch: { select: { id: true, name: true } } } },
    },
  });

  const shown = rows.slice(0, REGISTRATION_TIMELINE_LIMIT);
  return {
    rows: shown.map((row) => {
      const visibility = contentVisibility(row.templateKey, input.permissions);
      const withheld = !visibility.showBody || !visibility.showSubject;
      const versionNumber = row.templateVersion?.versionNumber ?? null;
      return {
        id: row.id,
        templateKey: row.templateKey,
        messageType: messageTypeLabel(row.templateKey),
        contentClass: visibility.contentClass,
        contentWithheld: withheld,
        subject: visibility.showSubject ? row.subjectSnapshot : WITHHELD_SUBJECT,
        bodyText: visibility.showBody ? row.bodyTextSnapshot : null,
        templateVersionNumber: versionNumber,
        templateVersionLabel: versionNumber === null ? NO_TEMPLATE_VERSION_LABEL : `Version ${versionNumber}`,
        recipientName: row.recipientName,
        recipientEmail: row.recipientEmail,
        recipientRole: recipientRoleLabel(row.recipientKind),
        senderName: row.senderNameSnapshot,
        replyTo: row.replyToEmailSnapshot,
        batch: row.scheduledEmailRecipient?.batch ?? null,
        retryOfMessageId: row.retryOfMessageId,
        resentByMessageIds: row.retries.map((retry) => retry.id),
        status: row.status,
        providerDeliveryStatus: row.providerDeliveryStatus,
        attemptCount: row.attemptCount,
        createdAt: row.createdAt.toISOString(),
        capturedAt: iso(row.capturedAt),
        sentAt: iso(row.sentAt),
        deliveredAt: iso(row.deliveredAt),
        failedAt: iso(row.failedAt),
        // A delivery error can quote the message, so a withheld row keeps only its status.
        lastError: withheld ? null : row.lastError,
      };
    }),
    limit: REGISTRATION_TIMELINE_LIMIT,
    hasMore: rows.length > REGISTRATION_TIMELINE_LIMIT,
  };
}
