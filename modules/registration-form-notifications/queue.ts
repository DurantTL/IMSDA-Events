import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { logWarn } from "@/lib/logger";
import { escapeMarkdown, plainTextFromEscapedMarkdown, renderEmailBodyHtml } from "@/modules/communications/email-html";
import { loadEventEmailSettings } from "@/modules/communications/effective-delivery";
import { suppressionNote } from "@/modules/communications/delivery-hold";
import { registrationPdfHoldUntil } from "@/modules/registration-pdf/hold";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import {
  CLUB_CONDITION_KEY,
  clubConditionStillExists,
  conditionStillAllowed,
  includesText,
  notificationApplies,
  notificationEmailContent,
  resolveSections,
  type NotificationEmailInput,
  type NotificationCondition,
} from "@/modules/registration-form-notifications/domain";

/**
 * Queues the emails of registration form notifications (#1081). Takes a transaction client and reads no notification
 * switch: the caller read "Registration form notifications" BEFORE its transaction opened and passes `enabled`
 * (docs/MEALS.md, #1016).
 *
 * Every send goes through the event's effective delivery (#1043): a paused event records the message as SUPPRESSED and
 * nothing leaves; an event with no mail configured captures it. One row per notification, registration, change and
 * address, so a retry queues nothing twice.
 */

export type QueuedFormNotificationGroup = { notificationId: string; messageIds: string[] };

type NotificationRow = {
  id: string;
  name: string;
  recipients: string[];
  conditionFieldKey: string | null;
  conditionOperator: string | null;
  conditionValue: string | null;
  sectionIds: string[];
};

/** One message per notification, registration, send and address, so a retry finds its rows. */
export function notificationMessageKey(notificationId: string, registrationId: string, keyScope: string, email: string) {
  return `form-notification:${notificationId}:${registrationId}:${keyScope}:${email}`;
}

export function conditionOf(row: Pick<NotificationRow, "conditionFieldKey" | "conditionOperator" | "conditionValue">): NotificationCondition | null {
  return row.conditionFieldKey
    ? { fieldKey: row.conditionFieldKey, operator: row.conditionOperator === "NOT_EQUALS" ? "NOT_EQUALS" : "EQUALS", value: row.conditionValue ?? "" }
    : null;
}

/** The subject, plain text and HTML of one notification email. */
export function renderNotificationEmail(input: NotificationEmailInput) {
  const content = notificationEmailContent(input, escapeMarkdown);
  return { subject: content.subject, bodyText: plainTextFromEscapedMarkdown(content.source), bodyHtml: renderEmailBodyHtml(content.source) };
}

export function sectionTitlesOf(definition: RegistrationFormDefinition) {
  return new Map(definition.sections.map((section) => [section.id, section.title] as const));
}

/**
 * The ids of the clubs that the given notifications route on and that still exist as club organizations (#1097). One
 * query, and none at all when no notification routes on a club.
 */
export async function existingConditionClubIds(client: Pick<Prisma.TransactionClient, "organization">, rows: ReadonlyArray<Pick<NotificationRow, "conditionFieldKey" | "conditionValue">>) {
  const ids = [...new Set(rows.flatMap((row) => (row.conditionFieldKey === CLUB_CONDITION_KEY && row.conditionValue ? [row.conditionValue] : [])))];
  if (ids.length === 0) return new Set<string>();
  const found = await client.organization.findMany({ where: { id: { in: ids }, type: "CLUB" }, select: { id: true } });
  return new Set(found.map((club) => club.id));
}

export type QueueNotificationInput = {
  eventId: string;
  registrationId: string;
  correlationId: string;
  /** Names this send ("initial", or the change's key), so a retry finds its rows. */
  keyScope: string;
  notification: NotificationRow;
  content: { subject: string; bodyText: string; bodyHtml: string };
  attachmentId: string | null;
  /** Held until the PDF is attached after the commit (`hold.ts`). */
  hold: boolean;
};

type Settings = NonNullable<Awaited<ReturnType<typeof loadEventEmailSettings>>>;

/** One message per address. `pendingMessageIds` are the ones that can leave; a suppressed one (a paused event) cannot. */
export async function queueNotificationMessages(tx: Prisma.TransactionClient, input: QueueNotificationInput, settings: Settings) {
  const note = suppressionNote(settings);
  const suppressed = note !== null;
  const messageIds: string[] = [];
  const pendingMessageIds: string[] = [];
  let created = 0;
  for (const email of input.notification.recipients) {
    const key = notificationMessageKey(input.notification.id, input.registrationId, input.keyScope, email);
    const existing = await tx.messageOutbox.findUnique({ where: { idempotencyKey: key }, select: { id: true, status: true } });
    if (existing) {
      messageIds.push(existing.id);
      if (existing.status === "PENDING") pendingMessageIds.push(existing.id);
      continue;
    }
    created += 1;
    const message = await tx.messageOutbox.create({
      data: {
        eventId: input.eventId,
        registrationId: input.registrationId,
        templateKey: "INTERNAL_NEW_REGISTRATION",
        recipientKind: "INTERNAL",
        recipientEmail: email,
        recipientName: input.notification.name,
        senderNameSnapshot: settings.senderName,
        senderEmailSnapshot: settings.senderEmail,
        replyToEmailSnapshot: settings.replyToEmail,
        subjectSnapshot: input.content.subject,
        bodyTextSnapshot: input.content.bodyText,
        bodyHtmlSnapshot: input.content.bodyHtml,
        ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}),
        // A suppressed row is never sent, so never held.
        ...(input.hold && !suppressed ? { availableAt: registrationPdfHoldUntil() } : {}),
        metadata: {
          trigger: "REGISTRATION_FORM_NOTIFICATION",
          notificationId: input.notification.id,
          keyScope: input.keyScope,
          deliveryMode: settings.deliveryMode,
          realDelivery: settings.deliveryMode === "EXTERNAL_EMAIL",
        },
        idempotencyKey: key,
        correlationId: input.correlationId || randomUUID(),
        status: suppressed ? "SUPPRESSED" : "PENDING",
        lastError: note,
      },
      select: { id: true, status: true },
    });
    messageIds.push(message.id);
    if (message.status === "PENDING") pendingMessageIds.push(message.id);
  }
  return { messageIds, pendingMessageIds, suppressed, created };
}

/**
 * Inside the submission's transaction: queues, HELD, one message per address of every notification whose condition
 * matches the new registration. The PDFs are made after the commit (`finishFormNotificationsAfterSubmit`), which attaches
 * them and releases the hold. `enabled` is the switch, read before the transaction.
 */
export async function queueFormNotificationsForSubmission(
  tx: Prisma.TransactionClient,
  input: {
    enabled: boolean;
    eventId: string;
    formId: string;
    registrationId: string;
    correlationId: string;
    definition: RegistrationFormDefinition;
    answers: Record<string, unknown>;
    locationId: string | null;
    /** The registration's club (organization id); null for a registration with none. */
    organizationId?: string | null;
    /**
     * The club ids that still exist, read BEFORE the transaction opened (`existingConditionClubIds`, docs/MEALS.md): no
     * organization query runs inside the submission's transaction. Only used by Club conditions.
     */
    existingClubIds: ReadonlySet<string>;
    locationName: string | null;
    eventName: string;
    registrantName: string;
  },
) {
  const none = { groups: [] as QueuedFormNotificationGroup[], pendingMessageIds: [] as string[] };
  if (!input.enabled) return none;
  const rows = await tx.registrationFormNotification.findMany({ where: { formId: input.formId }, orderBy: { position: "asc" } });
  const clubIds = input.existingClubIds;
  const matching = rows.filter((row) => {
    if (row.recipients.length === 0) return false;
    if (!clubConditionStillExists(row, clubIds)) {
      // The club was removed since the condition was saved; skipped, never sent unconditioned. Id only.
      logWarn("A form notification was skipped: its club no longer exists.", { notificationId: row.id });
      return false;
    }
    if (!conditionStillAllowed(input.definition, row)) {
      // The form changed since the condition was saved; skipped, never sent unconditioned. Id only.
      logWarn("A form notification was skipped: its condition looks at a question that is no longer allowed.", { notificationId: row.id });
      return false;
    }
    return notificationApplies(conditionOf(row), input.answers, input.locationId, input.organizationId ?? null);
  });
  if (matching.length === 0) return none;
  const settings = await loadEventEmailSettings(tx, input.eventId);
  if (!settings) return none;
  const titles = sectionTitlesOf(input.definition);
  const groups: QueuedFormNotificationGroup[] = [];
  const pendingMessageIds: string[] = [];
  for (const row of matching) {
    const resolved = resolveSections(input.definition, row.sectionIds);
    const content = renderNotificationEmail({
      notificationName: row.name,
      eventName: input.eventName,
      formTitle: input.definition.title,
      registrantName: input.registrantName,
      locationName: input.locationName,
      includes: resolved.noMatch ? "None of the chosen sections are in this registration's form" : includesText(resolved.sectionIds, titles),
      updated: false,
      hasPdf: false,
      noMatchingSections: resolved.noMatch,
    });
    const queued = await queueNotificationMessages(tx, {
      eventId: input.eventId,
      registrationId: input.registrationId,
      correlationId: input.correlationId,
      keyScope: "initial",
      notification: row,
      content,
      attachmentId: null,
      hold: true,
    }, settings);
    if (queued.pendingMessageIds.length > 0) {
      groups.push({ notificationId: row.id, messageIds: queued.pendingMessageIds });
      pendingMessageIds.push(...queued.pendingMessageIds);
    }
  }
  return { groups, pendingMessageIds };
}
