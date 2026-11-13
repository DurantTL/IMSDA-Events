import "server-only";

import { getPrisma } from "@/lib/prisma";
import { auditCrossEventIdentityRead } from "@/modules/people/identity-read-audit";
import { isDisclosureAllowed, staffIdentityAudience } from "@/modules/people/disclosure-matrix";
import {
  PERSON_COMMUNICATIONS_LIMIT,
  WITHHELD_SUBJECT,
  contentVisibility,
  messageDeliverySummary,
  messageTypeLabel,
  recipientRoleLabel,
  type DeliveryTone,
  type TimelineRecipientRole,
} from "@/modules/communications/timeline-domain";

/**
 * One person's communication history across events (#179), for a system administrator who opened it on purpose. It is
 * metadata only: the message text is never read, and the subject of a health-related message is replaced. Each load is
 * audited with ids and counts, never an address, subject or text.
 */
export type PersonCommunicationRow = {
  id: string;
  eventId: string | null;
  eventName: string;
  messageType: string;
  recipientRole: TimelineRecipientRole;
  recipientEmail: string;
  subject: string;
  deliveryLabel: string;
  deliveryTone: DeliveryTone;
  deliveryDate: string | null;
  createdAt: string;
  attemptCount: number;
};

export type PersonCommunications = {
  rows: PersonCommunicationRow[];
  limit: number;
  hasMore: boolean;
};

export type PersonCommunicationsViewer = { userId: string; scope: "full" | "clubs" | null; globalRole?: "SYSTEM_ADMIN" | null };

export type PersonCommunicationsTarget = { kind: "staff" | "account"; id: string; staffId: string | null; accountId: string | null };

/**
 * Only a system administrator ("full" scope) may open this; every other viewer gets `null` and nothing is read or audited.
 * The read goes through the identity disclosure matrix (reading a person's email is global reach, #128) and is audited
 * as a cross-event identity read.
 */
export async function loadPersonCommunications(
  viewer: PersonCommunicationsViewer,
  target: PersonCommunicationsTarget,
): Promise<PersonCommunications | null> {
  if (viewer.scope !== "full") return null;
  if (!isDisclosureAllowed("EMAIL", staffIdentityAudience({ globalRole: viewer.globalRole }), "READ")) return null;
  const prisma = getPrisma();

  const ownerClauses = [
    ...(target.staffId ? [{ accountUserId: target.staffId }] : []),
    ...(target.accountId ? [{ accountAttendeeId: target.accountId }] : []),
  ];
  const personClauses = [
    ...(target.accountId ? [{ attendeeAccountLinks: { some: { accountId: target.accountId } } }] : []),
    ...(target.staffId ? [{ userLinks: { some: { userId: target.staffId } } }] : []),
  ];
  const where = {
    recipientKind: { not: "TEST" as const },
    OR: [
      ...ownerClauses,
      ...(personClauses.length > 0 ? [{ registration: { accountHolderPerson: { OR: personClauses } } }] : []),
    ],
  };
  if (where.OR.length === 0) return { rows: [], limit: PERSON_COMMUNICATIONS_LIMIT, hasMore: false };

  const found = await prisma.messageOutbox.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PERSON_COMMUNICATIONS_LIMIT + 1,
    // No body column is selected: this page never shows message text.
    select: {
      id: true,
      eventId: true,
      event: { select: { name: true } },
      templateKey: true,
      recipientKind: true,
      recipientEmail: true,
      subjectSnapshot: true,
      status: true,
      providerDeliveryStatus: true,
      attemptCount: true,
      capturedAt: true,
      sentAt: true,
      deliveredAt: true,
      failedAt: true,
      createdAt: true,
    },
  });
  const shown = found.slice(0, PERSON_COMMUNICATIONS_LIMIT);

  const rows = shown.map((row): PersonCommunicationRow => {
    // No event permissions are passed: across events, a health-related subject is always withheld.
    const visibility = contentVisibility(row.templateKey, []);
    const delivery = messageDeliverySummary({
      status: row.status,
      providerDeliveryStatus: row.providerDeliveryStatus,
      createdAt: row.createdAt.toISOString(),
      capturedAt: row.capturedAt?.toISOString() ?? null,
      sentAt: row.sentAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
    });
    return {
      id: row.id,
      eventId: row.eventId,
      eventName: row.event?.name ?? "No event",
      messageType: messageTypeLabel(row.templateKey),
      recipientRole: recipientRoleLabel(row.recipientKind),
      recipientEmail: row.recipientEmail,
      subject: visibility.showSubject ? row.subjectSnapshot : WITHHELD_SUBJECT,
      deliveryLabel: delivery.label,
      deliveryTone: delivery.tone,
      deliveryDate: delivery.date,
      createdAt: row.createdAt.toISOString(),
      attemptCount: row.attemptCount,
    };
  });

  // Audit before anything is returned: if the entry cannot be written, nothing is shown. Ids and counts only.
  const eventIds = [...new Set(shown.flatMap((row) => (row.eventId ? [row.eventId] : [])))].sort();
  await auditCrossEventIdentityRead({
    actorUserId: viewer.userId,
    surface: "PERSON_COMMUNICATIONS",
    entityId: target.id,
    resultIds: shown.map((row) => row.id),
    extra: {
      kind: target.kind,
      ...(target.staffId ? { staffId: target.staffId } : {}),
      ...(target.accountId ? { accountId: target.accountId } : {}),
      eventIds,
      // At most the shown ids are passed, so the helper's `truncated` stays false; `moreExist` says whether older messages exist.
      moreExist: found.length > PERSON_COMMUNICATIONS_LIMIT ? 1 : 0,
    },
  });

  return { rows, limit: PERSON_COMMUNICATIONS_LIMIT, hasMore: found.length > PERSON_COMMUNICATIONS_LIMIT };
}
