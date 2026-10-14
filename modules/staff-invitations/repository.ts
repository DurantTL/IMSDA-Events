import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { getPrisma } from "@/lib/prisma";
import { isSerializationFailure, pauseBeforeRetry } from "@/lib/prisma-errors";
import { refreshBackgroundCheckMatchesForRegistrations } from "@/modules/background-checks/refresh-after-write";
import { processQueuedMessageIdsAfterCommit } from "@/modules/communications/messaging-repository";
import { calendarDateInEventTimeZone, hasEventEnded } from "@/modules/events/lifecycle";
import { entitleAttendeeToPlan } from "@/modules/meals/selection-repository";
import { cancelRegistration } from "@/modules/registrations/lifecycle-repository";
import { classifyInvitationRows, InvitationCsvError, parseInvitationCsv, usableEmails } from "@/modules/staff-invitations/csv";
import {
  approvedEmail,
  COVERED_MEAL_ANSWER,
  duplicatePartyName,
  INVITATION_RECEIVED_MESSAGE,
  INVITATION_STATUSES,
  invitationEmail,
  invitationRegistrationSchema,
  invitationStatus,
  invitationUrl,
  invitationUsable,
  OFFICE_DIGEST_WINDOW_MS,
  officeDigestEmail,
  officeDigestWindow,
  partyOf,
  receivedEmail,
  STAFF_INVITATION_GROUP_LABEL,
  type ExistingEmails,
  type ImportPreview,
  type InvitationRegistrationInput,
  type InvitationStatus,
  type StaffInvitationGroupValue,
} from "@/modules/staff-invitations/domain";
import { invitationIdFromToken, invitationToken, invitationTokenMatches } from "@/modules/staff-invitations/link";

type Tx = Prisma.TransactionClient;

export type StaffInvitationErrorCode =
  | "EVENT_NOT_FOUND"
  | "EVENT_NOT_SUPPORTED"
  | "INVALID_IMPORT"
  | "PREVIEW_CHANGED"
  | "INVITATION_NOT_FOUND"
  | "INVITATION_UNAVAILABLE"
  | "INVITATION_USED"
  | "NOT_REISSUABLE"
  | "NOTHING_TO_SEND"
  | "SEND_COUNT_CHANGED"
  | "INVALID_PARTY"
  | "NOTHING_SELECTED"
  | "MEAL_PLAN_REQUIRED"
  | "BATCH_TOO_LARGE"
  | "REQUEST_TOO_LARGE";

export class StaffInvitationError extends Error {
  constructor(public readonly code: StaffInvitationErrorCode, message: string) {
    super(message);
    this.name = "StaffInvitationError";
  }
}

export function staffInvitationErrorStatus(code: StaffInvitationErrorCode) {
  switch (code) {
    case "EVENT_NOT_FOUND":
    case "INVITATION_NOT_FOUND":
      return 404;
    case "INVITATION_UNAVAILABLE":
      return 410;
    case "INVITATION_USED":
    case "PREVIEW_CHANGED":
    case "SEND_COUNT_CHANGED":
    case "NOT_REISSUABLE":
    case "MEAL_PLAN_REQUIRED":
      return 409;
    case "REQUEST_TOO_LARGE":
      return 413;
    default:
      return 400;
  }
}

const attempts = 4;

async function serializable<T>(work: (tx: Tx) => Promise<T>, timeout = 30_000): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await getPrisma().$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout });
    } catch (error) {
      // A lost race (a serialization failure, or two writers for one unique key) is simply run again against what the winner wrote.
      const lostRace = isSerializationFailure(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
      if (attempt >= attempts || !lostRace) throw error;
      await pauseBeforeRetry(attempt);
    }
  }
}

function baseUrl() {
  return getServerEnv().APP_BASE_URL;
}

const eventSelect = {
  id: true,
  slug: true,
  name: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  isPublished: true,
  audience: true,
  supportContact: true,
} satisfies Prisma.EventSelect;

type InviteEvent = Prisma.EventGetPayload<{ select: typeof eventSelect }>;

/** The event, or an error when it can't hold personal staff links (a club event has its own registration paths). */
async function requireEvent(client: Tx | ReturnType<typeof getPrisma>, eventId: string): Promise<InviteEvent> {
  const event = await client.event.findUnique({ where: { id: eventId }, select: eventSelect });
  if (!event) throw new StaffInvitationError("EVENT_NOT_FOUND", "That event could not be found.");
  if (event.audience !== "GENERAL") {
    throw new StaffInvitationError("EVENT_NOT_SUPPORTED", "Personal staff links are for events open to everyone, not club events.");
  }
  return event;
}

// ---------------------------------------------------------------------------------------------
// The CSV import: preview, then confirm
// ---------------------------------------------------------------------------------------------

async function existingEmails(client: Tx | ReturnType<typeof getPrisma>, eventId: string, emails: readonly string[]): Promise<ExistingEmails> {
  if (emails.length === 0) return { invited: new Set(), registered: new Set() };
  const [invited, people] = await Promise.all([
    client.staffInvitation.findMany({ where: { eventId, email: { in: [...emails] } }, select: { email: true } }),
    client.person.findMany({
      where: {
        normalizedEmail: { in: [...emails] },
        OR: [
          { heldRegistrations: { some: { eventId, status: { not: "CANCELLED" } } } },
          { registrationEvents: { some: { eventId, registration: { status: { not: "CANCELLED" } } } } },
        ],
      },
      select: { normalizedEmail: true },
    }),
  ]);
  return {
    invited: new Set(invited.map((row) => row.email)),
    registered: new Set(people.flatMap((person) => (person.normalizedEmail ? [person.normalizedEmail] : []))),
  };
}

async function previewWith(client: Tx | ReturnType<typeof getPrisma>, eventId: string, input: { csv: string; defaultGroup: StaffInvitationGroupValue | null }): Promise<ImportPreview> {
  try {
    // The file is parsed once; the lookup uses the addresses that parse found, never a guess at where they are.
    const parsed = parseInvitationCsv(input.csv, input.defaultGroup);
    return classifyInvitationRows(parsed, await existingEmails(client, eventId, usableEmails(parsed)));
  } catch (error) {
    if (error instanceof InvitationCsvError) throw new StaffInvitationError("INVALID_IMPORT", error.message);
    throw error;
  }
}

/** What importing this CSV would do. Reads only: nothing is created. */
export async function previewInvitationImport(eventId: string, input: { csv: string; defaultGroup: StaffInvitationGroupValue | null }) {
  await requireEvent(getPrisma(), eventId);
  return previewWith(getPrisma(), eventId, input);
}

/**
 * Creates the invitations the preview showed as new, and only those. The file is read again here, and the digest of what the
 * office confirmed must match what would be created now, so a list that changed in between (another import, a registration)
 * is refused rather than quietly doing something other than what was previewed. Nothing is sent.
 */
export async function confirmInvitationImport(eventId: string, actorUserId: string, input: { csv: string; defaultGroup: StaffInvitationGroupValue | null; digest: string }) {
  try {
    return await serializable(async (tx) => {
      await requireEvent(tx, eventId);
      const preview = await previewWith(tx, eventId, input);
      if (preview.digest !== input.digest) {
        throw new StaffInvitationError("PREVIEW_CHANGED", "The list changed since you previewed it. Preview the file again before confirming.");
      }
      const toCreate = preview.rows.filter((row) => row.status === "NEW" && row.group);
      if (toCreate.length === 0) throw new StaffInvitationError("NOTHING_SELECTED", "There is nobody new to invite in this file.");
      const importBatchId = randomUUID();
      await tx.staffInvitation.createMany({
        data: toCreate.map((row) => ({
          eventId,
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          group: row.group as StaffInvitationGroupValue,
          importBatchId,
          createdByUserId: actorUserId,
        })),
      });
      await tx.auditLog.create({
        data: {
          eventId,
          actorUserId,
          action: "STAFF_INVITATIONS_IMPORTED",
          entityType: "StaffInvitation",
          entityId: importBatchId,
          correlationId: randomUUID(),
          summary: `Created ${toCreate.length} personal staff invitation${toCreate.length === 1 ? "" : "s"} from a CSV. Nothing was sent.`,
          metadata: { importBatchId, created: toCreate.length, skipped: preview.rows.length - toCreate.length, counts: preview.counts },
        },
      });
      return { importBatchId, created: toCreate.length, skipped: preview.rows.length - toCreate.length };
    });
  } catch (error) {
    // Two imports racing for the same address: the unique key refused one of them.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new StaffInvitationError("PREVIEW_CHANGED", "The list changed since you previewed it. Preview the file again before confirming.");
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// The invite list
// ---------------------------------------------------------------------------------------------

const listSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  group: true,
  linkVersion: true,
  sentAt: true,
  sendCount: true,
  revokedAt: true,
  registeredAt: true,
  approval: true,
  registrationId: true,
  createdAt: true,
  registration: { select: { confirmationCode: true, status: true } },
  lastMessage: { select: { status: true, providerDeliveryStatus: true, lastError: true } },
} satisfies Prisma.StaffInvitationSelect;

export type InvitationListRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  group: StaffInvitationGroupValue;
  status: InvitationStatus;
  sentAt: string | null;
  sendCount: number;
  registeredAt: string | null;
  confirmationCode: string | null;
  /** The link can still be copied, sent or revoked. */
  usable: boolean;
  /** A revoked link that nobody used can be reissued, and so can one that has not been used. */
  reissuable: boolean;
  /** Why delivery failed, when it did. */
  deliveryNote: string | null;
};

const LIST_LIMIT = 2000;

export async function listInvitations(eventId: string) {
  await requireEvent(getPrisma(), eventId);
  const rows = await getPrisma().staffInvitation.findMany({
    where: { eventId },
    orderBy: [{ group: "asc" }, { lastName: "asc" }, { firstName: "asc" }, { email: "asc" }],
    take: LIST_LIMIT,
    select: listSelect,
  });
  const list: InvitationListRow[] = rows.map((row) => {
    const status = invitationStatus({ revokedAt: row.revokedAt, registeredAt: row.registeredAt, approval: row.approval, sentAt: row.sentAt, message: row.lastMessage });
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      group: row.group,
      status,
      sentAt: row.sentAt?.toISOString() ?? null,
      sendCount: row.sendCount,
      registeredAt: row.registeredAt?.toISOString() ?? null,
      confirmationCode: row.registration?.confirmationCode ?? null,
      usable: invitationUsable(row),
      reissuable: !row.registeredAt,
      deliveryNote: status === "DELIVERY_FAILED" ? (row.lastMessage?.lastError?.slice(0, 200) ?? "The email did not reach this address.") : null,
    };
  });
  const counts = Object.fromEntries(INVITATION_STATUSES.map((status) => [status, list.filter((row) => row.status === status).length])) as Record<InvitationStatus, number>;
  return { rows: list, counts, truncated: rows.length >= LIST_LIMIT };
}

async function invitationsById(tx: Tx | ReturnType<typeof getPrisma>, eventId: string, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new StaffInvitationError("NOTHING_SELECTED", "Choose at least one person.");
  if (unique.length > 2000) throw new StaffInvitationError("NOTHING_SELECTED", "Choose at most 2,000 people at a time.");
  return tx.staffInvitation.findMany({ where: { eventId, id: { in: unique } } });
}

/** The personal link, to copy and hand over. Audited, because it is a credential. */
export async function copyInvitationLink(eventId: string, actorUserId: string, invitationId: string) {
  await requireEvent(getPrisma(), eventId);
  const invitation = await getPrisma().staffInvitation.findFirst({ where: { id: invitationId, eventId } });
  if (!invitation) throw new StaffInvitationError("INVITATION_NOT_FOUND", "That invitation could not be found.");
  if (!invitationUsable(invitation)) {
    throw new StaffInvitationError("INVITATION_UNAVAILABLE", invitation.revokedAt ? "That link was revoked. Reissue it to get a new one." : "That person has already registered.");
  }
  await getPrisma().auditLog.create({
    data: {
      eventId,
      actorUserId,
      action: "STAFF_INVITATION_LINK_COPIED",
      entityType: "StaffInvitation",
      entityId: invitation.id,
      correlationId: randomUUID(),
      summary: "Copied a personal staff invitation link.",
      metadata: { invitationId: invitation.id },
    },
  });
  return { url: invitationUrl(baseUrl(), invitationToken(invitation)) };
}

/** Revokes links nobody has used yet. A registered person is dealt with in the approval list instead. */
export async function revokeInvitations(eventId: string, actorUserId: string, ids: readonly string[], now = new Date()) {
  await requireEvent(getPrisma(), eventId);
  const found = await invitationsById(getPrisma(), eventId, ids);
  const revokable = found.filter((row) => invitationUsable(row)).map((row) => row.id);
  if (revokable.length > 0) {
    await getPrisma().$transaction(async (tx) => {
      await tx.staffInvitation.updateMany({ where: { eventId, id: { in: revokable }, revokedAt: null, registeredAt: null }, data: { revokedAt: now } });
      await tx.auditLog.create({
        data: {
          eventId,
          actorUserId,
          action: "STAFF_INVITATIONS_REVOKED",
          entityType: "StaffInvitation",
          correlationId: randomUUID(),
          summary: `Revoked ${revokable.length} personal staff link${revokable.length === 1 ? "" : "s"}.`,
          metadata: { invitationIds: revokable },
        },
      });
    });
  }
  return { revoked: revokable.length, skipped: found.length - revokable.length };
}

/**
 * A fresh link for someone whose link was revoked, lost or sent to the wrong place. Every earlier copy stops working, the
 * invitation goes back to "not sent", and nothing is emailed. Not for someone who already registered.
 */
export async function reissueInvitation(eventId: string, actorUserId: string, invitationId: string) {
  await requireEvent(getPrisma(), eventId);
  const updated = await getPrisma().$transaction(async (tx) => {
    const guarded = await tx.staffInvitation.updateMany({
      where: { id: invitationId, eventId, registeredAt: null },
      data: { linkVersion: { increment: 1 }, revokedAt: null, sentAt: null, lastMessageId: null },
    });
    if (guarded.count === 0) {
      const exists = await tx.staffInvitation.findFirst({ where: { id: invitationId, eventId }, select: { id: true } });
      if (!exists) throw new StaffInvitationError("INVITATION_NOT_FOUND", "That invitation could not be found.");
      throw new StaffInvitationError("NOT_REISSUABLE", "That person has already registered, so their link can't be replaced.");
    }
    await tx.auditLog.create({
      data: {
        eventId,
        actorUserId,
        action: "STAFF_INVITATION_REISSUED",
        entityType: "StaffInvitation",
        entityId: invitationId,
        correlationId: randomUUID(),
        summary: "Reissued a personal staff invitation link. Earlier copies no longer work.",
        metadata: { invitationId },
      },
    });
    return tx.staffInvitation.findUniqueOrThrow({ where: { id: invitationId } });
  });
  return { url: invitationUrl(baseUrl(), invitationToken(updated)) };
}

// ---------------------------------------------------------------------------------------------
// Sending: preview, then an explicit Send by a person. The invitations are only queued in the outbox.
// ---------------------------------------------------------------------------------------------

/** A link sent less than this long ago is not sent again by a second click. */
export const SEND_COOLDOWN_MS = 2 * 60 * 1000;

function stringArray(value: Prisma.JsonValue | undefined) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

type SendCandidate = Awaited<ReturnType<typeof invitationsById>>[number];

function sendable(row: SendCandidate, now: Date) {
  if (!invitationUsable(row)) return false;
  return !row.sentAt || now.getTime() - row.sentAt.getTime() >= SEND_COOLDOWN_MS;
}

/** What the preview promised: exactly these invitations, each at its current send count. A send must present it. */
function sendDigest(toSend: readonly Pick<SendCandidate, "id" | "sendCount">[]) {
  const key = [...toSend].map((row) => `${row.id}:${row.sendCount}`).sort();
  return createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 32);
}

/** The token the preview's sample shows in place of a link: it opens nothing. */
const SAMPLE_LINK_TOKEN = "PERSONAL-LINK-GOES-HERE";

/**
 * The exact email people would get, rendered for the first selected person but with a placeholder where their personal link
 * goes (the preview never shows a link that works), how many would be sent, and a digest of exactly which invitations those are.
 * Reads only.
 */
export async function previewInvitationSend(eventId: string, ids: readonly string[], now = new Date()) {
  const event = await requireEvent(getPrisma(), eventId);
  const found = await invitationsById(getPrisma(), eventId, ids);
  const toSend = found.filter((row) => sendable(row, now));
  const first = toSend[0];
  const settings = await getPrisma().eventMessageSettings.findUnique({ where: { eventId } });
  return {
    willSend: toSend.length,
    skipped: found.length - toSend.length,
    deliveryMode: settings?.deliveryMode ?? "LOCAL_CAPTURE",
    senderName: settings?.senderName ?? "IMSDA Events",
    /** False when the event is not published or is over: the links would not open yet (or any more). */
    linksOpen: eventAcceptsInvitationRegistration(event, now),
    digest: sendDigest(toSend),
    sample: first
      ? {
          to: first.email,
          ...invitationEmail({
            eventName: event.name,
            firstName: first.firstName,
            group: first.group,
            url: invitationUrl(baseUrl(), SAMPLE_LINK_TOKEN),
            supportContact: event.supportContact,
          }),
        }
      : null,
  };
}

/**
 * Queues one invitation email per selected person in the event's outbox. This is the human Send: it is never called from an
 * import, a schedule or any other automatic path. `digest` is the one the preview gave for exactly which invitations would go;
 * if what would be sent now differs in any way, nothing is queued. The outbox delivers (or captures, or suppresses) according to the event's message
 * settings, like every other message.
 */
export async function sendInvitations(eventId: string, actorUserId: string, input: { ids: readonly string[]; digest: string }, now = new Date()) {
  const event = await requireEvent(getPrisma(), eventId);
  return serializable(async (tx) => {
    const found = await invitationsById(tx, eventId, input.ids);
    const toSend = found.filter((row) => sendable(row, now));
    if (toSend.length === 0) throw new StaffInvitationError("NOTHING_TO_SEND", "Nobody selected can be sent a link right now.");
    if (sendDigest(toSend) !== input.digest) {
      throw new StaffInvitationError("SEND_COUNT_CHANGED", "Who would be sent a link changed since the preview. Nothing was sent. Preview again.");
    }
    const settings = await tx.eventMessageSettings.findUnique({ where: { eventId } });
    const deliveryMode = settings?.deliveryMode ?? "LOCAL_CAPTURE";
    const suppressed = deliveryMode === "DISABLED";
    const correlationId = randomUUID();
    for (const invitation of toSend) {
      const content = invitationEmail({
        eventName: event.name,
        firstName: invitation.firstName,
        group: invitation.group,
        url: invitationUrl(baseUrl(), invitationToken(invitation)),
        supportContact: event.supportContact,
      });
      const guarded = await tx.staffInvitation.updateMany({
        where: { id: invitation.id, sendCount: invitation.sendCount, registeredAt: null, revokedAt: null },
        data: { sendCount: { increment: 1 }, sentAt: now },
      });
      if (guarded.count === 0) throw new StaffInvitationError("SEND_COUNT_CHANGED", "A link changed while sending. Nothing was sent. Preview again.");
      const message = await tx.messageOutbox.create({
        data: {
          eventId,
          templateKey: "CUSTOM_MESSAGE",
          recipientKind: "REGISTRANT",
          recipientEmail: invitation.email,
          recipientName: `${invitation.firstName} ${invitation.lastName}`.trim() || null,
          senderNameSnapshot: settings?.senderName ?? "IMSDA Events",
          senderEmailSnapshot: settings?.senderEmail ?? null,
          replyToEmailSnapshot: settings?.replyToEmail ?? null,
          subjectSnapshot: content.subject,
          bodyTextSnapshot: content.bodyText,
          metadata: { trigger: "STAFF_INVITATION_SENT", staffInvitationId: invitation.id, deliveryMode, realDelivery: deliveryMode === "EXTERNAL_EMAIL" },
          idempotencyKey: `staff-invitation:send:${invitation.id}:${invitation.sendCount + 1}`,
          correlationId,
          status: suppressed ? "SUPPRESSED" : "PENDING",
          lastError: suppressed ? "Delivery is disabled for this event." : null,
        },
        select: { id: true },
      });
      await tx.staffInvitation.update({ where: { id: invitation.id }, data: { lastMessageId: message.id } });
    }
    await tx.auditLog.create({
      data: {
        eventId,
        actorUserId,
        action: "STAFF_INVITATIONS_QUEUED",
        entityType: "StaffInvitation",
        correlationId,
        summary: `Queued ${toSend.length} personal staff invitation email${toSend.length === 1 ? "" : "s"} for delivery.`,
        metadata: { count: toSend.length, deliveryMode, invitationIds: toSend.map((row) => row.id) },
      },
    });
    return { queued: toSend.length, skipped: found.length - toSend.length, deliveryMode };
  }, 120_000);
}

// ---------------------------------------------------------------------------------------------
// Notices (the registrant's receipt, the office digest, the approval)
// ---------------------------------------------------------------------------------------------

type Notice = {
  kind: string;
  recipientKind: "REGISTRANT" | "INTERNAL";
  email: string;
  name: string | null;
  subject: string;
  bodyText: string;
  idempotencyKey: string;
  /** Overrides the batch's registration (the office digest belongs to no registration). */
  registrationId?: string | null;
  /**
   * A digest the worker sends when this time arrives, not now. While it still waits, every later registration refreshes its
   * count in place, so the one email that goes names everyone waiting at that moment.
   */
  digestUntil?: Date;
};

/** Queues plain-text notices in the event's outbox inside the caller's transaction. Returns the ids still waiting to be sent. */
async function queueNotices(tx: Tx, input: { eventId: string; registrationId: string | null; notices: Notice[] }) {
  if (input.notices.length === 0) return [] as string[];
  const settings = await tx.eventMessageSettings.findUnique({ where: { eventId: input.eventId } });
  const deliveryMode = settings?.deliveryMode ?? "LOCAL_CAPTURE";
  const suppressed = deliveryMode === "DISABLED";
  const correlationId = randomUUID();
  const ids: string[] = [];
  for (const notice of input.notices) {
    if (notice.digestUntil) {
      const waiting = await tx.messageOutbox.findUnique({ where: { idempotencyKey: notice.idempotencyKey }, select: { id: true, status: true } });
      if (waiting) {
        if (waiting.status === "PENDING") {
          await tx.messageOutbox.update({ where: { id: waiting.id }, data: { subjectSnapshot: notice.subject, bodyTextSnapshot: notice.bodyText } });
        }
        continue;
      }
    }
    const message = await tx.messageOutbox.upsert({
      where: { idempotencyKey: notice.idempotencyKey },
      update: {},
      create: {
        eventId: input.eventId,
        registrationId: notice.registrationId === undefined ? input.registrationId : notice.registrationId,
        templateKey: "CUSTOM_MESSAGE",
        recipientKind: notice.recipientKind,
        recipientEmail: notice.email,
        recipientName: notice.name,
        senderNameSnapshot: settings?.senderName ?? "IMSDA Events",
        senderEmailSnapshot: settings?.senderEmail ?? null,
        replyToEmailSnapshot: settings?.replyToEmail ?? null,
        subjectSnapshot: notice.subject,
        bodyTextSnapshot: notice.bodyText,
        metadata: { trigger: `STAFF_INVITATION_${notice.kind}`, deliveryMode, realDelivery: deliveryMode === "EXTERNAL_EMAIL" },
        idempotencyKey: notice.idempotencyKey,
        correlationId,
        ...(notice.digestUntil ? { availableAt: notice.digestUntil } : {}),
        status: suppressed ? "SUPPRESSED" : "PENDING",
        lastError: suppressed ? "Delivery is disabled for this event." : null,
      },
      select: { id: true, status: true },
    });
    // A digest waits for its time and is delivered by the outbox worker, never from this request.
    if (message.status === "PENDING" && !notice.digestUntil) ids.push(message.id);
  }
  return ids;
}

async function officeEmails(tx: Tx, eventId: string) {
  const row = await tx.eventMessageSettings.findUnique({ where: { eventId }, select: { internalNotificationEmails: true } });
  return [...new Set(stringArray(row?.internalNotificationEmails).map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)))];
}

async function deliverAfterCommit(messageIds: readonly string[]) {
  if (messageIds.length === 0) return;
  try {
    await processQueuedMessageIdsAfterCommit([...messageIds]);
  } catch {
    // The messages stay queued for the outbox worker; what they are about is already saved.
  }
}

// ---------------------------------------------------------------------------------------------
// The public side: opening a link and registering through it
// ---------------------------------------------------------------------------------------------

type LoadedInvitation = Prisma.StaffInvitationGetPayload<{ include: { event: { select: typeof eventSelect } } }>;

/** The invitation a token names when the token is genuine for its current version, else null. Never says why not. */
async function loadByToken(client: Tx | ReturnType<typeof getPrisma>, token: string): Promise<LoadedInvitation | null> {
  const id = invitationIdFromToken(token);
  if (!id) return null;
  const invitation = await client.staffInvitation.findUnique({ where: { id }, include: { event: { select: eventSelect } } });
  if (!invitation || !invitationTokenMatches(token, invitation)) return null;
  return invitation;
}

/** Whether the event takes registrations through a personal link now: published, a general event, and not over. */
export function eventAcceptsInvitationRegistration(event: Pick<InviteEvent, "isPublished" | "audience" | "timezone" | "endsAt">, now = new Date()) {
  return event.audience === "GENERAL" && event.isPublished && !hasEventEnded({ timezone: event.timezone, endsAt: event.endsAt }, now);
}

export type InvitationExperience =
  | { state: "UNAVAILABLE" }
  | { state: "REGISTERED"; event: { name: string } }
  | {
      state: "OPEN";
      event: { name: string; slug: string; startsOn: string; endsOn: string; timezone: string; supportContact: string | null };
      person: { firstName: string; lastName: string; email: string; groupLabel: string };
    };

/** What the page behind a link shows. Any link that doesn't work says the same thing, so a link can't be probed. */
export async function getInvitationExperience(token: string, now = new Date()): Promise<InvitationExperience> {
  const invitation = await loadByToken(getPrisma(), token);
  if (!invitation || invitation.revokedAt || !eventAcceptsInvitationRegistration(invitation.event, now)) return { state: "UNAVAILABLE" };
  if (invitation.registeredAt) return { state: "REGISTERED", event: { name: invitation.event.name } };
  return {
    state: "OPEN",
    event: {
      name: invitation.event.name,
      slug: invitation.event.slug,
      startsOn: calendarDateInEventTimeZone(invitation.event.startsAt, invitation.event.timezone),
      endsOn: calendarDateInEventTimeZone(invitation.event.endsAt, invitation.event.timezone),
      timezone: invitation.event.timezone,
      supportContact: invitation.event.supportContact,
    },
    person: { firstName: invitation.firstName, lastName: invitation.lastName, email: invitation.email, groupLabel: STAFF_INVITATION_GROUP_LABEL[invitation.group] },
  };
}

/**
 * Registers the person and their family through a personal link. One registration per link, always $0, in the group the
 * invitation carries, waiting for the office to approve it: it is a DRAFT registration (in no count, report or room list) until
 * then. The family is the person, a spouse, and children or dependants up to age 18, all checked here. Everything is written
 * in one transaction, and the link is used up in the same one, so two clicks can never make two registrations.
 */
export async function submitInvitationRegistration(token: string, rawInput: unknown, now = new Date()) {
  const input: InvitationRegistrationInput = invitationRegistrationSchema.parse(rawInput);
  const party = partyOf(input);
  const duplicate = duplicatePartyName(party);
  if (duplicate) {
    throw new StaffInvitationError("INVALID_PARTY", `${duplicate} is listed twice. List each person once.`);
  }
  let notices: string[] = [];
  const result = await serializable(async (tx) => {
    const invitation = await loadByToken(tx, token);
    if (!invitation || invitation.revokedAt || !eventAcceptsInvitationRegistration(invitation.event, now)) {
      throw new StaffInvitationError("INVITATION_UNAVAILABLE", "This link isn't available. It may have been replaced or turned off. Contact the event office if you think that is a mistake.");
    }
    if (invitation.registeredAt) {
      throw new StaffInvitationError("INVITATION_USED", "This link has already been used to register.");
    }
    const event = invitation.event;
    const eventStartDate = calendarDateInEventTimeZone(event.startsAt, event.timezone);
    const holder = await tx.person.upsert({
      where: { normalizedEmail: invitation.email },
      update: {},
      create: { firstName: input.firstName, lastName: input.lastName, normalizedEmail: invitation.email, phone: input.phone || null },
    });
    const confirmationCode = `REG-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const registration = await tx.registration.create({
      data: {
        eventId: event.id,
        accountHolderPersonId: holder.id,
        confirmationCode,
        // Waiting for the office: not a confirmed registration until it is approved (see `approveRegistrations`).
        status: "DRAFT",
        totalAmount: 0,
        contactSnapshot: { firstName: input.firstName, lastName: input.lastName, email: invitation.email, phone: input.phone },
        submittedAt: null,
      },
    });
    for (const [position, member] of party.entries()) {
      const person = member.role === "PRIMARY"
        ? holder
        : await tx.person.create({ data: { firstName: member.firstName, lastName: member.lastName } });
      await tx.registrationAttendee.create({
        data: {
          eventId: event.id,
          registrationId: registration.id,
          personId: person.id,
          attendeeType: member.attendeeType,
          position,
          profileSnapshot: {
            firstName: member.firstName,
            lastName: member.lastName,
            email: member.role === "PRIMARY" ? invitation.email : null,
            phone: member.role === "PRIMARY" ? input.phone || null : null,
            source: "STAFF_INVITATION",
            staffInvitationId: invitation.id,
            staffGroup: invitation.group,
            partyRole: member.role,
            ...(member.age !== null ? { ageOnEventDate: member.age, ageAsOf: eventStartDate } : {}),
          },
          // Covered people pick no meal tickets: the conference pays for every meal.
          formResponses: { meal_coverage: COVERED_MEAL_ANSWER },
        },
      });
    }
    const used = await tx.staffInvitation.updateMany({
      where: { id: invitation.id, registrationId: null, registeredAt: null, revokedAt: null, linkVersion: invitation.linkVersion },
      data: {
        registrationId: registration.id,
        registeredAt: now,
        approval: "WAITING",
        needsHousing: input.needsHousing,
        housingNote: input.housingNote,
      },
    });
    if (used.count === 0) throw new StaffInvitationError("INVITATION_USED", "This link has already been used to register.");
    await tx.auditLog.create({
      data: {
        eventId: event.id,
        action: "STAFF_INVITATION_REGISTERED",
        entityType: "Registration",
        entityId: registration.id,
        correlationId: randomUUID(),
        summary: `Registration ${confirmationCode} was made through a personal ${STAFF_INVITATION_GROUP_LABEL[invitation.group].toLowerCase()} link and is waiting for approval.`,
        metadata: { invitationId: invitation.id, group: invitation.group, partySize: party.length, totalCents: 0 },
      },
    });
    const staff = await officeEmails(tx, event.id);
    const waitingCount = await tx.staffInvitation.count({ where: { eventId: event.id, approval: "WAITING" } });
    const reviewUrl = `${baseUrl().replace(/\/+$/, "")}/people/staff-invitations/approvals?event=${encodeURIComponent(event.id)}`;
    const window = officeDigestWindow(now);
    const windowEnd = new Date((window + 1) * OFFICE_DIGEST_WINDOW_MS);
    notices = await queueNotices(tx, {
      eventId: event.id,
      registrationId: registration.id,
      notices: [
        {
          kind: "RECEIVED",
          recipientKind: "REGISTRANT",
          email: invitation.email,
          name: `${input.firstName} ${input.lastName}`.trim(),
          idempotencyKey: `staff-invitation:received:${invitation.id}`,
          ...receivedEmail({ eventName: event.name, firstName: input.firstName, confirmationCode }),
        },
        ...staff.map((email) => ({
          kind: "OFFICE_DIGEST",
          recipientKind: "INTERNAL" as const,
          email,
          name: "IMSDA event team",
          idempotencyKey: `staff-invitation:office-digest:${event.id}:${window}:${email}`,
          registrationId: null,
          digestUntil: windowEnd,
          ...officeDigestEmail({ eventName: event.name, waitingCount, reviewUrl }),
        })),
      ],
    });
    return { confirmationCode, eventName: event.name };
  });
  await deliverAfterCommit(notices);
  return { confirmationCode: result.confirmationCode, message: INVITATION_RECEIVED_MESSAGE };
}

// ---------------------------------------------------------------------------------------------
// Approval: one batch at housing time
// ---------------------------------------------------------------------------------------------

export type ApprovalRow = {
  id: string;
  registrationId: string;
  confirmationCode: string;
  group: StaffInvitationGroupValue;
  approval: "WAITING" | "APPROVED" | "DECLINED";
  email: string;
  name: string;
  registeredAt: string;
  needsHousing: boolean | null;
  housingNote: string;
  party: Array<{ name: string; role: string; age: number | null }>;
  /** Approved registrations only: people on it with no conference-paid meal ticket, for the office to retry. */
  peopleWithoutMeals: number;
};

function snapshotRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The registrations made through personal links, with who is in each party, for the office to review. */
export async function listApprovals(eventId: string) {
  await requireEvent(getPrisma(), eventId);
  const rows = await getPrisma().staffInvitation.findMany({
    where: { eventId, registeredAt: { not: null } },
    orderBy: [{ approval: "asc" }, { registeredAt: "asc" }],
    take: LIST_LIMIT,
    select: {
      id: true,
      email: true,
      group: true,
      approval: true,
      registeredAt: true,
      needsHousing: true,
      housingNote: true,
      registrationId: true,
      registration: {
        select: {
          confirmationCode: true,
          contactSnapshot: true,
          attendees: { orderBy: { position: "asc" }, select: { id: true, profileSnapshot: true } },
        },
      },
    },
  });
  const covered = new Set(
    (await getPrisma().eventMealSelection.findMany({
      where: { eventId, payer: "CONFERENCE", status: "ACTIVE", registrationId: { in: rows.flatMap((row) => (row.approval === "APPROVED" && row.registrationId ? [row.registrationId] : [])) } },
      distinct: ["registrationAttendeeId"],
      select: { registrationAttendeeId: true },
    })).flatMap((row) => (row.registrationAttendeeId ? [row.registrationAttendeeId] : [])),
  );
  const list: ApprovalRow[] = rows.flatMap((row) => {
    if (!row.registration || !row.registrationId || !row.registeredAt || !row.approval) return [];
    const contact = snapshotRecord(row.registration.contactSnapshot);
    return [{
      id: row.id,
      registrationId: row.registrationId,
      confirmationCode: row.registration.confirmationCode,
      group: row.group,
      approval: row.approval,
      email: row.email,
      name: `${String(contact.firstName ?? "")} ${String(contact.lastName ?? "")}`.trim(),
      registeredAt: row.registeredAt.toISOString(),
      needsHousing: row.needsHousing,
      housingNote: row.housingNote,
      peopleWithoutMeals: row.approval === "APPROVED" ? row.registration.attendees.filter((attendee) => !covered.has(attendee.id)).length : 0,
      party: row.registration.attendees.map((attendee) => {
        const snapshot = snapshotRecord(attendee.profileSnapshot);
        return {
          name: `${String(snapshot.firstName ?? "")} ${String(snapshot.lastName ?? "")}`.trim(),
          role: String(snapshot.partyRole ?? "PRIMARY"),
          age: typeof snapshot.ageOnEventDate === "number" ? snapshot.ageOnEventDate : null,
        };
      }),
    }];
  });
  return {
    rows: list,
    counts: {
      WAITING: list.filter((row) => row.approval === "WAITING").length,
      APPROVED: list.filter((row) => row.approval === "APPROVED").length,
      DECLINED: list.filter((row) => row.approval === "DECLINED").length,
    },
  };
}

/** The most registrations one approve, decline or retry request takes. */
export const APPROVAL_BATCH_MAX = 200;

export type MealCoverageResult = {
  /** The event has exactly one active conference-paid plan. */
  planFound: boolean;
  entitledPeople: number;
  failedPeople: number;
  /** Everyone left without the meal plan, so the office can see who and retry. */
  failed: Array<{ registrationId: string; attendeeId: string; name: string }>;
};

export type DecisionResult = {
  decided: number;
  skipped: number;
  failed: number;
  /** Approvals and meal retries only. */
  meals?: MealCoverageResult;
};

function assertBatch(ids: readonly string[]) {
  if (new Set(ids).size > APPROVAL_BATCH_MAX) {
    throw new StaffInvitationError("BATCH_TOO_LARGE", `Choose at most ${APPROVAL_BATCH_MAX} registrations at a time. Do the rest in another batch.`);
  }
}

async function singleConferencePlan(client: Tx | ReturnType<typeof getPrisma>, eventId: string) {
  const plans = await client.eventMealPlan.findMany({ where: { eventId, payer: "CONFERENCE", isActive: true }, select: { id: true } });
  return plans.length === 1 ? plans[0].id : null;
}

/**
 * Approves the waiting registrations the office chose, in one batch. Each becomes a confirmed registration
 * (counted, reported and listed like any other), its registrant is sent a confirmation (queued in the outbox), and, when
 * the event has a conference-paid meal plan, every person in the party is entitled to it through the meals module. A
 * registration that is no longer waiting is skipped, never changed.
 */
export async function approveRegistrations(
  eventId: string,
  actorUserId: string,
  ids: readonly string[],
  options: { withoutMealCoverage?: boolean } = {},
  now = new Date(),
): Promise<DecisionResult> {
  const event = await requireEvent(getPrisma(), eventId);
  assertBatch(ids);
  // Every approved person is meant to be fed by the conference. Without exactly one conference-paid plan that can't happen, so
  // the office either sets one up or says out loud that this batch goes ahead without meal coverage.
  const planId = await singleConferencePlan(getPrisma(), eventId);
  if (!planId && !options.withoutMealCoverage) {
    throw new StaffInvitationError("MEAL_PLAN_REQUIRED", "This event does not have exactly one active conference-paid meal plan, so approved people can't be given their meals. Set the plan up in Meals, or approve without meal coverage.");
  }
  const found = await invitationsById(getPrisma(), eventId, ids);
  const approvedRegistrationIds: string[] = [];
  let skipped = 0;
  let failed = 0;
  for (const invitation of found) {
    if (invitation.approval !== "WAITING" || !invitation.registrationId) {
      skipped += 1;
      continue;
    }
    try {
      const done = await serializable(async (tx) => {
        const guarded = await tx.staffInvitation.updateMany({
          where: { id: invitation.id, approval: "WAITING", registrationId: invitation.registrationId },
          data: { approval: "APPROVED", decidedAt: now, decidedByUserId: actorUserId },
        });
        if (guarded.count === 0) return null;
        const moved = await tx.registration.updateMany({
          where: { id: invitation.registrationId as string, eventId, status: "DRAFT" },
          data: { status: "CONFIRMED", submittedAt: now },
        });
        // A waiting registration somebody cancelled by hand is not approved: the invitation is left as it was.
        if (moved.count === 0) throw new StaffInvitationError("INVITATION_UNAVAILABLE", "That registration is no longer waiting.");
        const registration = await tx.registration.findUniqueOrThrow({ where: { id: invitation.registrationId as string }, select: { confirmationCode: true, contactSnapshot: true } });
        const contact = snapshotRecord(registration.contactSnapshot);
        await tx.auditLog.create({
          data: {
            eventId,
            actorUserId,
            action: "STAFF_REGISTRATION_APPROVED",
            entityType: "Registration",
            entityId: invitation.registrationId as string,
            correlationId: randomUUID(),
            summary: `Approved registration ${registration.confirmationCode} made through a personal staff link.`,
            metadata: { invitationId: invitation.id, group: invitation.group, fromStatus: "DRAFT", toStatus: "CONFIRMED" },
          },
        });
        const messageIds = await queueNotices(tx, {
          eventId,
          registrationId: invitation.registrationId,
          notices: [{
            kind: "APPROVED",
            recipientKind: "REGISTRANT",
            email: invitation.email,
            name: `${String(contact.firstName ?? "")} ${String(contact.lastName ?? "")}`.trim() || null,
            idempotencyKey: `staff-invitation:approved:${invitation.id}`,
            ...approvedEmail({ eventName: event.name, firstName: String(contact.firstName ?? ""), confirmationCode: registration.confirmationCode }),
          }],
        });
        return messageIds;
      });
      if (done === null) {
        skipped += 1;
        continue;
      }
      approvedRegistrationIds.push(invitation.registrationId);
    } catch (error) {
      if (error instanceof StaffInvitationError) skipped += 1;
      else failed += 1;
    }
  }
  // The confirmations stay queued for the outbox worker: a batch is never sent from inside the request.
  await refreshBackgroundCheckMatchesForRegistrations(approvedRegistrationIds).catch(() => undefined);
  const meals = await entitleMeals(eventId, actorUserId, approvedRegistrationIds, planId);
  return { decided: approvedRegistrationIds.length, skipped, failed, meals };
}

/**
 * Gives the people on approved registrations the meal plan again, for those who lack it (an approval that went ahead without
 * the plan, or one whose entitlement failed). Safe to repeat: the meals module adds only what is missing.
 */
export async function retryMealCoverage(eventId: string, actorUserId: string, ids: readonly string[]): Promise<DecisionResult> {
  await requireEvent(getPrisma(), eventId);
  assertBatch(ids);
  const planId = await singleConferencePlan(getPrisma(), eventId);
  if (!planId) {
    throw new StaffInvitationError("MEAL_PLAN_REQUIRED", "This event does not have exactly one active conference-paid meal plan. Set the plan up in Meals first.");
  }
  const found = await invitationsById(getPrisma(), eventId, ids);
  const approved = found.filter((row) => row.approval === "APPROVED" && row.registrationId);
  const live = await getPrisma().registration.findMany({
    where: { eventId, id: { in: approved.map((row) => row.registrationId as string) }, status: { in: ["SUBMITTED", "CONFIRMED"] } },
    select: { id: true },
  });
  const meals = await entitleMeals(eventId, actorUserId, live.map((row) => row.id), planId);
  return { decided: live.length, skipped: found.length - live.length, failed: 0, meals };
}

/**
 * Gives every person on the approved registrations the event's conference-paid meal plan (#905/#916): every meal, each used
 * once. Uses the meals module's own entitlement, which never charges the attendee. It never throws: the approvals have already
 * committed, so any trouble is counted per person and returned with who they are, for the office to retry.
 */
async function entitleMeals(eventId: string, actorUserId: string, registrationIds: readonly string[], planId: string | null): Promise<MealCoverageResult> {
  if (registrationIds.length === 0) return { planFound: planId !== null, entitledPeople: 0, failedPeople: 0, failed: [] };
  let attendees: Array<{ id: string; registrationId: string; attendeeType: string; profileSnapshot: Prisma.JsonValue }>;
  try {
    attendees = await getPrisma().registrationAttendee.findMany({
      where: { eventId, registrationId: { in: [...registrationIds] } },
      orderBy: [{ registrationId: "asc" }, { position: "asc" }],
      select: { id: true, registrationId: true, attendeeType: true, profileSnapshot: true },
    });
  } catch {
    return { planFound: planId !== null, entitledPeople: 0, failedPeople: registrationIds.length, failed: registrationIds.map((registrationId) => ({ registrationId, attendeeId: "", name: "" })) };
  }
  const named = (attendee: (typeof attendees)[number]) => {
    const snapshot = snapshotRecord(attendee.profileSnapshot);
    return { registrationId: attendee.registrationId, attendeeId: attendee.id, name: `${String(snapshot.firstName ?? "")} ${String(snapshot.lastName ?? "")}`.trim() };
  };
  if (!planId) return { planFound: false, entitledPeople: 0, failedPeople: attendees.length, failed: attendees.map(named) };
  const failed: MealCoverageResult["failed"] = [];
  let entitledPeople = 0;
  for (const attendee of attendees) {
    try {
      await entitleAttendeeToPlan(eventId, actorUserId, {
        registrationAttendeeId: attendee.id,
        planId,
        ageGroup: attendee.attendeeType === "CHILD" ? "CHILD" : "ADULT",
        reason: "Approved staff, pastor or volunteer registration: the conference pays for every meal.",
      });
      entitledPeople += 1;
    } catch {
      failed.push(named(attendee));
    }
  }
  return { planFound: true, entitledPeople, failedPeople: failed.length, failed };
}

/**
 * Declines the waiting registrations the office chose. Each registration is cancelled through the ordinary cancellation, which
 * releases whatever it held, and its link cannot be used again. A registration that is no longer waiting is skipped.
 */
export async function declineRegistrations(eventId: string, actorUserId: string, ids: readonly string[], now = new Date()): Promise<DecisionResult> {
  await requireEvent(getPrisma(), eventId);
  assertBatch(ids);
  const found = await invitationsById(getPrisma(), eventId, ids);
  let decided = 0;
  let skipped = 0;
  let failed = 0;
  for (const invitation of found) {
    if (invitation.approval !== "WAITING" || !invitation.registrationId) {
      skipped += 1;
      continue;
    }
    const guarded = await getPrisma().staffInvitation.updateMany({
      where: { id: invitation.id, approval: "WAITING" },
      data: { approval: "DECLINED", decidedAt: now, decidedByUserId: actorUserId },
    });
    if (guarded.count === 0) {
      skipped += 1;
      continue;
    }
    try {
      // A registration somebody already cancelled by hand needs only the decision recorded.
      const current = await getPrisma().registration.findFirst({ where: { id: invitation.registrationId, eventId }, select: { status: true } });
      // Its cancellation notice is queued in the outbox for the worker, like the approvals' confirmations.
      if (current && current.status !== "CANCELLED") await cancelRegistration(eventId, invitation.registrationId, actorUserId, "Declined by the office (staff, pastor or volunteer registration).", now);
      await getPrisma().auditLog.create({
        data: {
          eventId,
          actorUserId,
          action: "STAFF_REGISTRATION_DECLINED",
          entityType: "Registration",
          entityId: invitation.registrationId,
          correlationId: randomUUID(),
          summary: "Declined a registration made through a personal staff link.",
          metadata: { invitationId: invitation.id, group: invitation.group },
        },
      });
      decided += 1;
    } catch {
      // Put the decision back so the registration is not left declined but still alive.
      await getPrisma().staffInvitation.updateMany({ where: { id: invitation.id, approval: "DECLINED" }, data: { approval: "WAITING", decidedAt: null, decidedByUserId: null } });
      failed += 1;
    }
  }
  return { decided, skipped, failed };
}
