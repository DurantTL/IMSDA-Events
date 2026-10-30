import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { neutralizePlaceholders } from "@/modules/club-applications/email";
import { AccountEmailNotConfiguredError, getAccountEmailSender, isAccountEmailConfigured } from "@/modules/communications/account-email";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { recordAlertFeedItem } from "@/modules/notifications/feed";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

/**
 * "Information form response received" alert (#1222), after the club form alert (#1017). One internal email per address
 * the form's settings list. It says which form and when, and links to the response in the app; it never carries an
 * answer, so the reader signs in to see it.
 *
 * It is queued AFTER the response has been stored (`sendInformationFormSubmittedAlert`), never inside the response's own
 * write: a failure to queue, send or even read the settings is logged and swallowed, and the response stays saved.
 *
 * `enabled` is the "Information form response received" switch (#1016). The caller reads it before it stores the
 * response and passes it in, so this never reads a switch itself.
 */

export const INFORMATION_FORM_SUBMITTED_TEMPLATE_KEY = "INFORMATION_FORM_SUBMITTED";

type Client = Pick<Prisma.TransactionClient, "messageOutbox" | "adminAlertFeedItem" | "informationForm">;

export type InformationFormSubmittedInput = {
  responseId: string;
  formId: string;
  submittedAt: Date;
};

/** The staff address of one response: the general admin page, or the event workspace page. A path when no base URL is set. */
export function informationResponseStaffPath(form: { id: string; scope: "GENERAL" | "EVENT"; eventId: string | null }, responseId: string) {
  return form.scope === "EVENT" && form.eventId
    ? `/information-forms/responses?event=${encodeURIComponent(form.eventId)}&form=${encodeURIComponent(form.id)}&response=${encodeURIComponent(responseId)}`
    : `/admin/information-forms/${encodeURIComponent(form.id)}/responses?response=${encodeURIComponent(responseId)}`;
}

function staffLink(path: string) {
  try {
    return new URL(path, getServerEnv().APP_BASE_URL).toString();
  } catch {
    return path;
  }
}

/** What the alert says. It takes a form name, a time and a link only, so there is nowhere for an answer to get in. */
export function informationFormSubmittedContent(input: { formName: string; submittedAt: Date; path: string }) {
  const formName = neutralizePlaceholders(input.formName);
  const when = formatInConferenceTime(input.submittedAt, { dateStyle: "long", timeStyle: "short" });
  return {
    subject: `New response: ${formName}`,
    bodyText: [
      "A response was sent through an information form.",
      "",
      `Form: ${formName}`,
      `When: ${when} (Central Time)`,
      "",
      "Open it (sign-in required):",
      staffLink(input.path),
      "",
      "The answers are not in this email.",
      "",
      "IMSDA Events",
    ].join("\n"),
  };
}

/** Queues one email per listed address, and the feed item. Returns the new message ids, to deliver afterwards. */
export async function queueInformationFormSubmittedEmails(client: Client, input: InformationFormSubmittedInput, enabled: boolean): Promise<string[]> {
  if (!enabled) return [];
  const form = await client.informationForm.findUnique({ where: { id: input.formId }, select: { id: true, name: true, scope: true, eventId: true, submissionNotifyEmails: true } });
  const recipients = [...new Set((form?.submissionNotifyEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (!form || recipients.length === 0) return [];
  let from;
  try {
    from = getAccountEmailSender();
  } catch (error) {
    if (error instanceof AccountEmailNotConfiguredError) return [];
    throw error;
  }
  const path = informationResponseStaffPath(form, input.responseId);
  const content = informationFormSubmittedContent({ formName: form.name, submittedAt: input.submittedAt, path });
  const keyFor = (email: string) => `information-form-submitted:${input.responseId}:${email}`;
  // A retry for the same response finds its rows and adds nothing.
  const already = await client.messageOutbox.findMany({ where: { idempotencyKey: { in: recipients.map(keyFor) } }, select: { idempotencyKey: true } });
  const done = new Set(already.map((row) => row.idempotencyKey));
  const ids: string[] = [];
  for (const email of recipients) {
    if (done.has(keyFor(email))) continue;
    const message = await client.messageOutbox.create({
      data: {
        eventId: form.eventId,
        templateKey: INFORMATION_FORM_SUBMITTED_TEMPLATE_KEY,
        recipientKind: "INTERNAL",
        recipientEmail: email,
        recipientName: null,
        senderNameSnapshot: from.name,
        senderEmailSnapshot: from.address,
        replyToEmailSnapshot: from.replyTo,
        subjectSnapshot: content.subject,
        bodyTextSnapshot: content.bodyText,
        metadata: { trigger: INFORMATION_FORM_SUBMITTED_TEMPLATE_KEY, responseId: input.responseId, formId: input.formId, accountEmail: false, realDelivery: true },
        idempotencyKey: keyFor(email),
        correlationId: randomUUID(),
        status: "PENDING",
      },
      select: { id: true },
    });
    ids.push(message.id);
  }
  // The feed item (#1033) beside the emails: one per response however many addresses. A form name staff chose; no answer.
  if (ids.length > 0) {
    await recordAlertFeedItem(client, {
      notificationKey: "INFORMATION_FORM_SUBMITTED",
      occurrenceKey: `information-form-submitted:${input.responseId}`,
      summary: `A response was received: ${form.name}.`,
      href: path,
    });
  }
  return ids;
}

/**
 * Queues and delivers the alert once the response is stored. Never throws: any failure is logged with the response id only
 * (never an address or an answer) and the caller carries on. The idempotency keys are stable, so a later attempt for the
 * same response adds nothing twice.
 */
export async function sendInformationFormSubmittedAlert(input: InformationFormSubmittedInput, enabled: boolean): Promise<void> {
  if (!enabled) return;
  try {
    const ids = await getPrisma().$transaction((tx) => queueInformationFormSubmittedEmails(tx, input, true));
    await deliverInformationFormSubmittedEmails(ids);
  } catch (error) {
    logError("An information form alert could not be queued; the response was saved.", error, { responseId: input.responseId });
  }
}

/** Best-effort delivery after the queueing commits. Never throws; the outbox sweep retries what fails. */
export async function deliverInformationFormSubmittedEmails(messageIds: readonly string[]): Promise<void> {
  if (messageIds.length === 0 || !isAccountEmailConfigured()) return;
  try {
    await processAccountEmailQueue({ messageIds: [...messageIds] });
  } catch (error) {
    logError("An information form email could not be delivered now.", error, { count: messageIds.length });
  }
}
