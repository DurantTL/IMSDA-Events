import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  BAPTISM_FOLLOW_UP_MODULE_KEY,
  BAPTISM_FOLLOW_UP_TEMPLATE_KEY,
  baptismNoticeContent,
  newBaptismNames,
  usablePastorEmail,
  type BaptismRecipientRole,
} from "@/modules/baptism-follow-up/domain";
import { AccountEmailNotConfiguredError, getAccountEmailSender, isAccountEmailConfigured } from "@/modules/communications/account-email";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { formatMessageDateRange } from "@/modules/communications/templates";
import { currentRegistrationAnswers } from "@/modules/registrations/amendments-repository";

/**
 * The baptism follow-up notice (#1680). Runs after a club registration is submitted or amended, never on a draft save, and only
 * for an event that has the Baptism follow-up module on and at least one event lead address saved. It finds the baptism names the
 * club has not had notified yet, and queues one short internal email per recipient: each event lead address and, when the club's
 * sponsoring church has an active pastor with an email, the pastor. The pastor's address is read here, on the server, and goes
 * nowhere but the outbox row (Caleb, Nov 12, 2026: this is the one message a pastor contact is used for).
 *
 * The ledger rows (`BaptismFollowUp`) and the outbox rows are written in one transaction, so a name is remembered exactly when
 * its notice is queued: a failure leaves neither, and the next save tries again. The unique key on the ledger means two saves at
 * once cannot both notify the same name. Removing a name does nothing. Never throws: a failure is logged with ids only and the
 * registration that triggered it is unaffected.
 */

export type BaptismNoticeInput = { eventId: string; organizationId: string; registrationId: string };
export type BaptismNoticeResult = { queued: number; names: number; recipients: BaptismRecipientRole[] };

const nothing: BaptismNoticeResult = { queued: 0, names: 0, recipients: [] };

function noticeKey(input: BaptismNoticeInput, role: BaptismRecipientRole, email: string, nameKeys: readonly string[]) {
  const names = createHash("sha256").update([...nameKeys].sort().join("\n")).digest("hex").slice(0, 16);
  return `baptism-follow-up:${input.eventId}:${input.organizationId}:${role}:${email}:${names}`;
}

/** The pastor's address for a club: the active pastor contact of its sponsoring church, when it has a valid email. Server only. */
async function pastorEmailFor(client: Pick<Prisma.TransactionClient, "organizationContact">, churchId: string | null): Promise<string | null> {
  if (!churchId) return null;
  const pastor = await client.organizationContact.findFirst({
    where: { organizationId: churchId, kind: "PASTOR", effectiveTo: null },
    select: { email: true },
  });
  return usablePastorEmail(pastor?.email);
}

/** Queues the notices for the names this club has not had notified. Returns the outbox ids to deliver and what was done. */
export async function queueBaptismFollowUpNotices(input: BaptismNoticeInput): Promise<{ result: BaptismNoticeResult; messageIds: string[] }> {
  const prisma = getPrisma();
  const moduleRow = await prisma.eventModule.findUnique({
    where: { eventId_moduleKey: { eventId: input.eventId, moduleKey: BAPTISM_FOLLOW_UP_MODULE_KEY } },
    select: { id: true },
  });
  if (!moduleRow) return { result: nothing, messageIds: [] };
  const setting = await prisma.baptismFollowUpSetting.findUnique({ where: { eventId: input.eventId }, select: { leadEmails: true } });
  const leads = [...new Set((setting?.leadEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (leads.length === 0) return { result: nothing, messageIds: [] };

  const answers = await currentRegistrationAnswers(input.eventId, input.registrationId);
  if (!answers) return { result: nothing, messageIds: [] };
  const known = await prisma.baptismFollowUp.findMany({
    where: { eventId: input.eventId, organizationId: input.organizationId },
    select: { normalizedName: true },
  });
  const fresh = newBaptismNames(answers.responses.baptism_names, new Set(known.map((row) => row.normalizedName)));
  if (fresh.length === 0) return { result: nothing, messageIds: [] };

  let from;
  try {
    from = getAccountEmailSender();
  } catch (error) {
    // No sender configured: nothing is queued and nothing is remembered, so the names are still new at the next save.
    if (error instanceof AccountEmailNotConfiguredError) return { result: nothing, messageIds: [] };
    throw error;
  }

  const [event, club] = await Promise.all([
    prisma.event.findUnique({ where: { id: input.eventId }, select: { name: true, startsAt: true, endsAt: true, timezone: true } }),
    prisma.organization.findUnique({ where: { id: input.organizationId }, select: { name: true, parentOrganizationId: true } }),
  ]);
  if (!event || !club) return { result: nothing, messageIds: [] };
  const dates = formatMessageDateRange(event.startsAt, event.endsAt, { timeZone: event.timezone });

  return prisma.$transaction(async (tx) => {
    // Only names this transaction is first to record are sent: a save racing this one finds them taken and adds nothing.
    const pastorEmail = await pastorEmailFor(tx, club.parentOrganizationId);
    const created = await tx.baptismFollowUp.createManyAndReturn({
      data: fresh.map((name) => ({
        eventId: input.eventId,
        organizationId: input.organizationId,
        normalizedName: name.key,
        displayName: name.displayName,
        leadNotified: true,
        pastorNotified: pastorEmail !== null,
      })),
      skipDuplicates: true,
      select: { normalizedName: true, displayName: true },
    });
    if (created.length === 0) return { result: nothing, messageIds: [] };
    const nameKeys = created.map((row) => row.normalizedName);
    const displayNames = created.map((row) => row.displayName);
    // One address for the lead and the pastor is told once.
    const recipients: Array<{ role: BaptismRecipientRole; email: string }> = [
      ...leads.map((email) => ({ role: "lead" as const, email })),
      ...(pastorEmail && !leads.includes(pastorEmail) ? [{ role: "pastor" as const, email: pastorEmail }] : []),
    ];
    const messageIds: string[] = [];
    for (const recipient of recipients) {
      const content = baptismNoticeContent({ names: displayNames, clubName: club.name, eventName: event.name, dates, role: recipient.role });
      const message = await tx.messageOutbox.create({
        data: {
          eventId: null,
          templateKey: BAPTISM_FOLLOW_UP_TEMPLATE_KEY,
          recipientKind: "INTERNAL",
          recipientEmail: recipient.email,
          recipientName: null,
          senderNameSnapshot: from.name,
          senderEmailSnapshot: from.address,
          replyToEmailSnapshot: from.replyTo,
          subjectSnapshot: content.subject,
          bodyTextSnapshot: content.bodyText,
          metadata: { trigger: BAPTISM_FOLLOW_UP_TEMPLATE_KEY, eventId: input.eventId, organizationId: input.organizationId, accountEmail: false, realDelivery: true },
          idempotencyKey: noticeKey(input, recipient.role, recipient.email, nameKeys),
          correlationId: randomUUID(),
          status: "PENDING",
        },
        select: { id: true },
      });
      messageIds.push(message.id);
    }
    const roles = [...new Set(recipients.map((recipient) => recipient.role))];
    // Counts and roles only: no name and no address in the audit entry.
    await writeAuditLog({
      eventId: input.eventId,
      action: "BAPTISM_FOLLOW_UP_NOTICE_QUEUED",
      entityType: "BaptismFollowUp",
      entityId: input.organizationId,
      summary: "Queued a baptism follow-up notice.",
      metadata: {
        eventId: input.eventId,
        organizationId: input.organizationId,
        nameCount: created.length,
        leadCount: leads.length,
        pastorNotified: pastorEmail !== null,
        recipientRoles: roles,
      },
    }, tx);
    return { result: { queued: messageIds.length, names: created.length, recipients: roles }, messageIds };
  });
}

/** Best-effort delivery after the transaction commits. The outbox sweep retries what fails. */
async function deliver(messageIds: readonly string[]) {
  if (messageIds.length === 0 || !isAccountEmailConfigured()) return;
  try {
    await processAccountEmailQueue({ messageIds: [...messageIds] });
  } catch (error) {
    logError("A baptism follow-up email could not be delivered now.", error, { count: messageIds.length });
  }
}

/** Queues and delivers the notice once the registration has been saved. Never throws. */
export async function sendBaptismFollowUpNotices(input: BaptismNoticeInput): Promise<BaptismNoticeResult> {
  try {
    const { result, messageIds } = await queueBaptismFollowUpNotices(input);
    await deliver(messageIds);
    return result;
  } catch (error) {
    logError("A baptism follow-up notice could not be queued; the registration was saved.", error, { eventId: input.eventId, registrationId: input.registrationId });
    return nothing;
  }
}

export type BaptismNoticePreview = { names: number; recipients: BaptismRecipientRole[] };

/** The club behind a registration, read from the registration itself and never from a request. */
async function clubOrganizationOf(registrationId: string, eventId: string): Promise<string | null> {
  const row = await getPrisma().clubEventRegistration.findFirst({ where: { registrationId, eventId }, select: { organizationId: true } });
  return row?.organizationId ?? null;
}

/**
 * For a staff edit's preview (#1680): whether the answers it would save hold baptism names not notified before, so the editor can
 * offer to send the notice. Null unless the registration is a club's, the module is on and an event lead is saved. Says how many
 * names and which roles (lead, pastor) would be told, never an address. Never throws.
 */
export async function previewBaptismFollowUpNotice(input: { eventId: string; registrationId: string; responses: Record<string, unknown> }): Promise<BaptismNoticePreview | null> {
  try {
    const prisma = getPrisma();
    const organizationId = await clubOrganizationOf(input.registrationId, input.eventId);
    if (!organizationId) return null;
    const moduleRow = await prisma.eventModule.findUnique({ where: { eventId_moduleKey: { eventId: input.eventId, moduleKey: BAPTISM_FOLLOW_UP_MODULE_KEY } }, select: { id: true } });
    if (!moduleRow) return null;
    const setting = await prisma.baptismFollowUpSetting.findUnique({ where: { eventId: input.eventId }, select: { leadEmails: true } });
    if (!setting || setting.leadEmails.length === 0) return null;
    const known = await prisma.baptismFollowUp.findMany({ where: { eventId: input.eventId, organizationId }, select: { normalizedName: true } });
    const fresh = newBaptismNames(input.responses.baptism_names, new Set(known.map((row) => row.normalizedName)));
    if (fresh.length === 0) return null;
    const club = await prisma.organization.findUnique({ where: { id: organizationId }, select: { parentOrganizationId: true } });
    const pastor = await pastorEmailFor(prisma, club?.parentOrganizationId ?? null);
    return { names: fresh.length, recipients: pastor ? ["lead", "pastor"] : ["lead"] };
  } catch (error) {
    logError("The baptism follow-up preview could not be read.", error, { eventId: input.eventId, registrationId: input.registrationId });
    return null;
  }
}

/** After a staff edit has committed and staff chose to send: the same notice path as a club's own save. Never throws. */
export async function sendBaptismFollowUpNoticesForStaffEdit(input: { eventId: string; registrationId: string }): Promise<BaptismNoticeResult> {
  try {
    const organizationId = await clubOrganizationOf(input.registrationId, input.eventId);
    if (!organizationId) return nothing;
    return await sendBaptismFollowUpNotices({ eventId: input.eventId, organizationId, registrationId: input.registrationId });
  } catch (error) {
    logError("A baptism follow-up notice could not be sent after a staff edit; the edit was saved.", error, { eventId: input.eventId, registrationId: input.registrationId });
    return nothing;
  }
}
