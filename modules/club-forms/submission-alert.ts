import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { neutralizePlaceholders } from "@/modules/club-applications/email";
import { AccountEmailNotConfiguredError, getAccountEmailSender, isAccountEmailConfigured } from "@/modules/communications/account-email";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { clubFormClubLabel, isTltFormTemplateKey, type ClubFormActor } from "@/modules/club-forms/domain";
import { recordAlertFeedItem } from "@/modules/notifications/feed";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

/**
 * "Club form submitted" alert (#1017). One internal email per address the form's settings list, queued in the same
 * transaction as the submission and delivered best-effort after it commits.
 *
 * The email says which form, which club, who submitted it (a name, nothing more), when, and a staff link. It never
 * carries an answer: a club form can hold health or other sensitive information, so the reader signs in to see it.
 *
 * The alert is queued AFTER the submission commits (`sendClubFormSubmittedAlert`), never inside its transaction: a failed
 * statement aborts a Postgres transaction, so a queueing error inside it would undo the club's save.
 *
 * `enabled` is the "Club form submitted" switch (#1016). The caller reads it BEFORE its transaction opens and passes it
 * in, because this runs inside one and must not read the database for a switch.
 */

export const CLUB_FORM_SUBMITTED_TEMPLATE_KEY = "CLUB_FORM_SUBMITTED";

type Client = Pick<Prisma.TransactionClient, "messageOutbox" | "adminAlertFeedItem" | "clubFormTemplate" | "organization" | "attendeeAccount" | "user" | "areaCoordinatorGrant">;

export type ClubFormSubmittedInput = {
  submissionId: string;
  templateId: string;
  /** Null for a "Not listed" open application (#1229). */
  organizationId: string | null;
  /** The club name an applicant typed when `organizationId` is null. */
  unlistedClubName?: string | null;
  /** True for a public open application (#1229): the submitter says so instead of "private link". */
  openApplication?: boolean;
  /** Null for a private link: the person who filled it in is not known. */
  actor: ClubFormActor | null;
  submittedAt: Date;
};

function staffLink(submissionId: string) {
  const path = `/more/club-forms/${encodeURIComponent(submissionId)}`;
  try {
    return new URL(path, getServerEnv().APP_BASE_URL).toString();
  } catch {
    return path;
  }
}

/** What the alert says. Takes names and a time only, so there is nowhere for an answer to get in. */
export function clubFormSubmittedContent(input: { formName: string; clubName: string; submitterName: string | null; submittedAt: Date; submissionId: string; openApplication?: boolean }) {
  const formName = neutralizePlaceholders(input.formName);
  const clubName = neutralizePlaceholders(input.clubName);
  const when = formatInConferenceTime(input.submittedAt, { dateStyle: "long", timeStyle: "short" });
  return {
    subject: `Club form submitted: ${formName} (${clubName})`,
    bodyText: [
      "A club form was submitted.",
      "",
      `Form: ${formName}`,
      `Club: ${clubName}`,
      `Submitted by: ${input.submitterName ? neutralizePlaceholders(input.submitterName) : input.openApplication ? "an applicant using the public application link" : "someone with the club's private link"}`,
      `When: ${when}`,
      "",
      "Open it (sign-in required):",
      staffLink(input.submissionId),
      "",
      "The answers are not in this email.",
      "",
      "IMAdventist",
    ].join("\n"),
  };
}

/**
 * What a TLT director's alert says (#1686): which form, which club, when, and a link to the TLT forms inbox. Takes
 * names of the form and the club and a time only: no answer, no child's name, no submitter, so there is nowhere for
 * one to get in. She signs in to read it.
 */
export function tltFormSubmittedContent(input: { formName: string; clubName: string; submittedAt: Date }) {
  const formName = neutralizePlaceholders(input.formName);
  const clubName = neutralizePlaceholders(input.clubName);
  const when = formatInConferenceTime(input.submittedAt, { dateStyle: "long", timeStyle: "short" });
  const path = "/account/area-clubs/tlt/forms";
  let link = path;
  try {
    link = new URL(path, getServerEnv().APP_BASE_URL).toString();
  } catch {
    // The relative path stays.
  }
  return {
    subject: `TLT form submitted: ${formName} (${clubName})`,
    bodyText: [
      "A TLT form was submitted.",
      "",
      `Form: ${formName}`,
      `Club: ${clubName}`,
      `When: ${when}`,
      "",
      "Open the TLT forms inbox (sign-in required):",
      link,
      "",
      "The answers are not in this email.",
      "",
      "IMAdventist",
    ].join("\n"),
  };
}

/** The addresses of every account that is the TLT director right now: an active Area Coordinator grant with the setting on, on an active account. Lowercased, de-duplicated. */
async function tltDirectorEmails(client: Client, now: Date): Promise<string[]> {
  const grants = await client.areaCoordinatorGrant.findMany({
    where: {
      tltDirector: true,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      attendeeAccount: { status: "ACTIVE", disabledAt: null },
    },
    select: { attendeeAccount: { select: { email: true } } },
  });
  return [...new Set(grants.map((grant) => grant.attendeeAccount.email.trim().toLowerCase()).filter(Boolean))];
}

async function submitterName(client: Client, actor: ClubFormActor | null): Promise<string | null> {
  if (!actor) return null;
  if (actor.kind === "ATTENDEE") {
    const account = await client.attendeeAccount.findUnique({ where: { id: actor.accountId }, select: { displayName: true } });
    return account?.displayName.trim().slice(0, 120) || null;
  }
  const user = await client.user.findUnique({ where: { id: actor.userId }, select: { displayName: true } });
  return user?.displayName.trim().slice(0, 120) || null;
}

/** Queues one email per listed address. Returns the new message ids, to deliver after commit. */
export async function queueClubFormSubmittedEmails(client: Client, input: ClubFormSubmittedInput, enabled: boolean): Promise<string[]> {
  if (!enabled) return [];
  const template = await client.clubFormTemplate.findUnique({ where: { id: input.templateId }, select: { key: true, name: true, submissionNotifyEmails: true } });
  if (!template) return [];
  // The TLT director (#1686) is alerted to the three TLT forms with her own, answer-free message and an inbox link she
  // can open. An address she shares with the form's list gets this one, not the staff link she cannot open: one email each.
  const directors = isTltFormTemplateKey(template.key) ? await tltDirectorEmails(client, input.submittedAt) : [];
  const directorSet = new Set(directors);
  const recipients = [...new Set((template.submissionNotifyEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))].filter((email) => !directorSet.has(email));
  if (recipients.length === 0 && directors.length === 0) return [];
  let from;
  try {
    from = getAccountEmailSender();
  } catch (error) {
    if (error instanceof AccountEmailNotConfiguredError) return [];
    throw error;
  }
  const organization = input.organizationId
    ? await client.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } })
    : null;
  const content = clubFormSubmittedContent({
    formName: template.name,
    clubName: input.organizationId ? organization?.name ?? "A club" : clubFormClubLabel(null, input.unlistedClubName),
    openApplication: input.openApplication,
    submitterName: await submitterName(client, input.actor),
    submittedAt: input.submittedAt,
    submissionId: input.submissionId,
  });
  const tltContent = directors.length > 0
    ? tltFormSubmittedContent({ formName: template.name, clubName: input.organizationId ? organization?.name ?? "A club" : clubFormClubLabel(null, input.unlistedClubName), submittedAt: input.submittedAt })
    : null;
  const keyFor = (email: string) => `club-form-submitted:${input.submissionId}:${email}`;
  // A retry of the same submission finds its rows and adds nothing.
  const everyone = [...recipients, ...directors];
  const already = await client.messageOutbox.findMany({
    where: { idempotencyKey: { in: everyone.map(keyFor) } },
    select: { idempotencyKey: true },
  });
  const done = new Set(already.map((row) => row.idempotencyKey));
  const ids: string[] = [];
  let staffCount = 0;
  for (const email of everyone) {
    if (done.has(keyFor(email))) continue;
    const message = directorSet.has(email) && tltContent ? tltContent : content;
    const created = await client.messageOutbox.create({
      data: {
        eventId: null,
        templateKey: CLUB_FORM_SUBMITTED_TEMPLATE_KEY,
        recipientKind: "INTERNAL",
        recipientEmail: email,
        recipientName: null,
        senderNameSnapshot: from.name,
        senderEmailSnapshot: from.address,
        replyToEmailSnapshot: from.replyTo,
        subjectSnapshot: message.subject,
        bodyTextSnapshot: message.bodyText,
        metadata: { trigger: CLUB_FORM_SUBMITTED_TEMPLATE_KEY, submissionId: input.submissionId, templateId: input.templateId, accountEmail: false, realDelivery: true },
        idempotencyKey: keyFor(email),
        correlationId: randomUUID(),
        status: "PENDING",
      },
      select: { id: true },
    });
    ids.push(created.id);
    if (!directorSet.has(email)) staffCount += 1;
  }
  // The feed item (#1033) beside the emails, in the same transaction: one per submission however many addresses. The
  // form's own name is a label staff chose; no answer and no submitter name.
  if (staffCount > 0) {
    await recordAlertFeedItem(client, {
      notificationKey: "CLUB_FORM_SUBMITTED",
      occurrenceKey: `club-form-submitted:${input.submissionId}`,
      summary: `A club form was submitted: ${template.name}.`,
      href: `/more/club-forms/${encodeURIComponent(input.submissionId)}`,
    });
  }
  return ids;
}

/**
 * Queues and delivers the alert once the submission has committed. Never throws: any failure (the sender settings, a
 * lookup, the outbox insert, delivery) is logged with the submission id only, never an address or an answer, and the
 * caller carries on. The idempotency keys are the same, so a later attempt for the same submission adds nothing twice.
 * `enabled` was read before the transaction opened.
 */
export async function sendClubFormSubmittedAlert(input: ClubFormSubmittedInput, enabled: boolean): Promise<void> {
  if (!enabled) return;
  try {
    // One transaction, so the emails and the feed item commit together or not at all.
    const ids = await getPrisma().$transaction((tx) => queueClubFormSubmittedEmails(tx, input, true));
    await deliverClubFormSubmittedEmails(ids);
  } catch (error) {
    logError("A club form submitted alert could not be queued; the submission was saved.", error, { submissionId: input.submissionId });
  }
}

/** Best-effort delivery after the transaction commits. Never throws; the outbox sweep retries what fails. */
export async function deliverClubFormSubmittedEmails(messageIds: readonly string[]): Promise<void> {
  if (messageIds.length === 0 || !isAccountEmailConfigured()) return;
  try {
    await processAccountEmailQueue({ messageIds: [...messageIds] });
  } catch (error) {
    logError("A club form submitted email could not be delivered now.", error, { count: messageIds.length });
  }
}
