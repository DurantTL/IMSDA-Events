import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { calendarDateIn } from "@/modules/calendar/domain";
import {
  buildDeadlineReminderEmail,
  dueLabel,
  reminderPointFor,
  type DeadlineReminderPoint,
  type ReminderAudience,
} from "@/modules/calendar/deadlines";
import { siteBaseUrl } from "@/modules/calendar/subscribe";
import { getAccountEmailSender, isAccountEmailConfigured } from "@/modules/communications/account-email";
import { deadlineRemindersHonourAnnouncementOptOut } from "@/modules/communications/email-preferences";

/**
 * Deadline reminders (#910). Every published, visible, scheduled Deadline entry
 * gets a reminder batch prepared 14 and 2 days before its due date (conference
 * time zone), for every active club role holder and every Area Coordinator.
 *
 * Preparing a batch sends nothing. A batch waits until a system administrator
 * (the same gate as the calendar admin and the club-invite Send) reviews its
 * subject, text and recipient count and sends it with one click, which queues
 * the emails in the outbox and is audited. Until then it follows the deadline:
 * a new date updates it and a cancelled, hidden, un-marked or passed deadline
 * withdraws it.
 *
 * - One batch per deadline and reminder point (unique key); a sent batch is
 *   final, a withdrawn one can be prepared again when the deadline qualifies.
 * - The outbox rows are event-less account email, like the club invites and the
 *   location waitlist digest, delivered by the same queue and sweep.
 * - Recipients who opted out of all announcements are left out, counted.
 */

export class DeadlineReminderError extends Error {
  constructor(
    public readonly code:
      | "BATCH_NOT_FOUND"
      | "BATCH_NOT_PENDING"
      | "BATCH_WITHDRAWN"
      | "BATCH_CHANGED"
      | "EMAIL_NOT_CONFIGURED"
      | "NO_RECIPIENTS",
    message: string,
  ) {
    super(message);
    this.name = "DeadlineReminderError";
  }
}

/** One lock for preparing, withdrawing, sending and dismissing, so two runs (or a click during a run) never interleave. */
const reminderLockKey = "deadline-reminders";

/** Every club role has portal access and is told (the director and deputy run the club; the registrar and reporter handle its dates). */
export const reminderClubRoles = ["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"] as const;

type Db = Prisma.TransactionClient;

const emailSchema = z.email();

export type ReminderRecipient = {
  email: string;
  name: string;
  audience: ReminderAudience;
};

export type ReminderRecipients = {
  recipients: ReminderRecipient[];
  /** People left out because they opted out of all IMSDA Events announcements. */
  optedOut: number;
};

/**
 * Who a reminder goes to right now: every account holding an active role on an
 * active club, and every lasting Area Coordinator. Disabled or unverified
 * accounts, revoked or ended roles and invalid addresses are left out, one
 * person is one email however many roles they hold, and an opt-out of all
 * announcements is honoured.
 */
export async function loadReminderRecipients(client: Db, now: Date): Promise<ReminderRecipients> {
  const activeAccount = { disabledAt: null, status: "ACTIVE" as const };
  const [clubGrants, areaGrants] = await Promise.all([
    client.clubDirectorGrant.findMany({
      where: {
        role: { in: [...reminderClubRoles] },
        revokedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        organization: { type: "CLUB", isActive: true },
        attendeeAccount: activeAccount,
      },
      select: { attendeeAccount: { select: { email: true, displayName: true } } },
    }),
    client.areaCoordinatorGrant.findMany({
      // A system administrator's temporary "act as" grant has an end date; only lasting coordinators are told.
      where: { revokedAt: null, expiresAt: null, attendeeAccount: activeAccount },
      select: { attendeeAccount: { select: { email: true, displayName: true } } },
    }),
  ]);

  const byEmail = new Map<string, ReminderRecipient>();
  const add = (account: { email: string; displayName: string }, audience: ReminderAudience) => {
    const email = account.email.trim().toLowerCase();
    if (!emailSchema.safeParse(email).success) return;
    const existing = byEmail.get(email);
    // Someone in both roles gets the club wording: their club is where they act.
    if (existing) {
      if (audience === "CLUB") existing.audience = "CLUB";
      return;
    }
    byEmail.set(email, { email, name: account.displayName, audience });
  };
  for (const grant of clubGrants) add(grant.attendeeAccount, "CLUB");
  for (const grant of areaGrants) add(grant.attendeeAccount, "AREA");

  const emails = [...byEmail.keys()];
  const optOuts = emails.length === 0 || !deadlineRemindersHonourAnnouncementOptOut()
    ? []
    : await client.emailAnnouncementOptOut.findMany({
      where: { normalizedEmail: { in: emails }, scope: "ALL" },
      select: { normalizedEmail: true },
    });
  const optedOut = new Set(optOuts.map((row) => row.normalizedEmail));
  const recipients = emails
    .filter((email) => !optedOut.has(email))
    .sort()
    .map((email) => byEmail.get(email)!);
  return { recipients, optedOut: emails.length - recipients.length };
}

/** What staff approved: this batch as it reads now and this exact set of addresses. */
export function reminderFingerprint(input: {
  batchId: string;
  daysBefore: number;
  title: string;
  dueOn: string;
  linkUrl: string | null;
  recipientEmails: readonly string[];
}) {
  return createHash("sha256")
    .update(JSON.stringify([input.batchId, input.daysBefore, input.title, input.dueOn, input.linkUrl, [...input.recipientEmails].sort()]))
    .digest("hex");
}

const entrySelect = {
  id: true, title: true, endsOn: true, linkUrl: true, status: true, entryType: true, isPublished: true,
  isHiddenLocally: true, sourceRemovedAt: true, repeatRule: true,
} as const;

type EntryRow = Prisma.CalendarEntryGetPayload<{ select: typeof entrySelect }>;

/** Why a deadline gets no reminder right now, or null when it does (apart from whether a point is reached yet). */
function ineligibleReason(entry: EntryRow | undefined, today: string): string | null {
  if (!entry) return "The calendar entry was removed.";
  if (entry.entryType !== "DEADLINE") return "The entry is no longer marked as a deadline.";
  if (entry.status === "CANCELLED") return "The deadline was cancelled.";
  if (entry.status === "POSTPONED") return "The deadline was postponed.";
  if (!entry.isPublished || entry.isHiddenLocally || entry.sourceRemovedAt) return "The deadline is hidden or unpublished.";
  // A repeating deadline has a due date per occurrence; reminders are for one-off deadlines.
  if (entry.repeatRule) return "The deadline repeats; reminders are only prepared for one-off deadlines.";
  if (entry.endsOn < today) return "The due date has passed.";
  return null;
}

export type ReconcileResult = { prepared: number; updated: number; withdrawn: number };

/**
 * Brings the batches in line with the calendar. Safe to run at any time and as
 * often as wanted, even at once from several places: one lock, one batch per
 * deadline and point, and nothing is sent. Run by the five-minute sweep and
 * after every calendar change.
 */
export async function reconcileDeadlineReminders(now = new Date()): Promise<ReconcileResult> {
  const today = calendarDateIn(now);
  return getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reminderLockKey}))`;
    const result: ReconcileResult = { prepared: 0, updated: 0, withdrawn: 0 };

    const pending = await tx.deadlineReminderBatch.findMany({ where: { status: "PENDING" } });
    const candidates = await tx.calendarEntry.findMany({
      where: { entryType: "DEADLINE", repeatRule: null, endsOn: { gte: today } },
      select: entrySelect,
    });
    const known = new Map(candidates.map((entry) => [entry.id, entry]));
    const missingIds = pending.map((batch) => batch.calendarEntryId).filter((id): id is string => id !== null && !known.has(id));
    if (missingIds.length > 0) {
      for (const entry of await tx.calendarEntry.findMany({ where: { id: { in: missingIds } }, select: entrySelect })) known.set(entry.id, entry);
    }

    const points = new Map<string, DeadlineReminderPoint>();
    for (const entry of candidates) {
      if (ineligibleReason(entry, today)) continue;
      const point = reminderPointFor(entry.endsOn, today);
      if (point) points.set(entry.id, point);
    }

    const withdraw = async (batch: (typeof pending)[number], reason: string) => {
      const updated = await tx.deadlineReminderBatch.updateMany({
        where: { id: batch.id, status: "PENDING" },
        data: { status: "WITHDRAWN", statusReason: reason, decidedAt: new Date() },
      });
      if (updated.count !== 1) return;
      result.withdrawn += 1;
      await writeAuditLog({
        action: "DEADLINE_REMINDER_WITHDRAWN",
        entityType: "DeadlineReminderBatch",
        entityId: batch.id,
        summary: `Withdrew the ${batch.daysBefore}-day reminder for "${batch.title}" before it was sent.`,
        metadata: { reason, daysBefore: batch.daysBefore, dueOn: batch.dueOn },
      }, tx);
    };

    // Pending batches that no longer apply: the deadline went away, or its current point is a different one.
    const stillPending = new Set<string>();
    for (const batch of pending) {
      const entry = batch.calendarEntryId ? known.get(batch.calendarEntryId) : undefined;
      const point = batch.calendarEntryId ? points.get(batch.calendarEntryId) : undefined;
      if (entry && point === batch.daysBefore) {
        stillPending.add(batch.id);
        continue;
      }
      const reason = ineligibleReason(entry, today)
        ?? (point ? "The reminder point changed with the due date; the right one was prepared." : "The due date moved later; a reminder is prepared when its time comes.");
      await withdraw(batch, reason);
    }

    // Prepare, update or revive the batch for each deadline's current point.
    const entryIds = [...points.keys()];
    const existing = entryIds.length === 0
      ? []
      : await tx.deadlineReminderBatch.findMany({ where: { calendarEntryId: { in: entryIds } } });
    for (const [entryId, point] of points) {
      const entry = known.get(entryId)!;
      const snapshot = { title: entry.title, dueOn: entry.endsOn, linkUrl: entry.linkUrl };
      const forPoint = existing.filter((candidate) => candidate.calendarEntryId === entryId && candidate.daysBefore === point);
      // A batch is per due date: if the date moved, an earlier due date's SENT or DISMISSED batch is history and this
      // date gets its own; a still-waiting batch for the old date simply moves along.
      const target = forPoint.find((candidate) => candidate.dueOn === snapshot.dueOn);
      const movable = target ? undefined : forPoint.find((candidate) => candidate.status === "PENDING");
      let activeId: string;
      if (movable) {
        activeId = movable.id;
        await tx.deadlineReminderBatch.update({ where: { id: movable.id }, data: snapshot });
        result.updated += 1;
        await writeAuditLog({
          action: "DEADLINE_REMINDER_UPDATED",
          entityType: "DeadlineReminderBatch",
          entityId: movable.id,
          summary: `Updated the ${point}-day reminder for "${entry.title}" to follow the deadline.`,
          metadata: { daysBefore: point, previousDueOn: movable.dueOn, dueOn: entry.endsOn },
        }, tx);
      } else if (!target) {
        const created = await tx.deadlineReminderBatch.create({ data: { calendarEntryId: entryId, daysBefore: point, ...snapshot } });
        activeId = created.id;
        result.prepared += 1;
        await writeAuditLog({
          action: "DEADLINE_REMINDER_PREPARED",
          entityType: "DeadlineReminderBatch",
          entityId: created.id,
          summary: `Prepared the ${point}-day reminder for "${entry.title}". It waits for staff to send it.`,
          metadata: { daysBefore: point, dueOn: entry.endsOn },
        }, tx);
      } else {
        activeId = target.id;
        if (target.status === "PENDING") {
          if (target.title !== snapshot.title || target.linkUrl !== snapshot.linkUrl) {
            await tx.deadlineReminderBatch.update({ where: { id: target.id }, data: snapshot });
            result.updated += 1;
            await writeAuditLog({
              action: "DEADLINE_REMINDER_UPDATED",
              entityType: "DeadlineReminderBatch",
              entityId: target.id,
              summary: `Updated the ${point}-day reminder for "${entry.title}" to follow the deadline.`,
              metadata: { daysBefore: point, dueOn: entry.endsOn },
            }, tx);
          }
        } else if (target.status === "WITHDRAWN") {
          // The deadline qualifies again (un-hidden, un-cancelled, moved back): the same batch is prepared once more.
          await tx.deadlineReminderBatch.update({
            where: { id: target.id },
            data: { ...snapshot, status: "PENDING", statusReason: null, decidedAt: null, decidedByUserId: null, preparedAt: new Date() },
          });
          result.prepared += 1;
          await writeAuditLog({
            action: "DEADLINE_REMINDER_PREPARED",
            entityType: "DeadlineReminderBatch",
            entityId: target.id,
            summary: `Prepared the ${point}-day reminder for "${entry.title}" again. It waits for staff to send it.`,
            metadata: { daysBefore: point, dueOn: entry.endsOn, revived: true },
          }, tx);
        }
        // SENT and DISMISSED are final for this due date: the same deadline, point and date are never prepared twice.
      }
      for (const other of forPoint.filter((candidate) => candidate.id !== activeId && candidate.status === "PENDING")) {
        await withdraw(other, "The due date moved; this reminder was replaced.");
      }
    }
    return result;
  }, { timeout: 30_000, maxWait: 10_000 });
}

export type PendingReminderBatch = {
  id: string;
  title: string;
  dueOn: string;
  dueLabel: string;
  daysBefore: number;
  linkUrl: string | null;
  preparedAt: string;
  subject: string;
  /** The email as a club role holder reads it, and as an Area Coordinator reads it. */
  bodyText: string;
  areaBodyText: string;
  recipientCount: number;
  clubRecipients: number;
  areaRecipients: number;
  optedOutCount: number;
  fingerprint: string;
};

export type PendingReminders = {
  batches: PendingReminderBatch[];
  /** False when account email is not set up on this server, so Send would refuse. */
  emailConfigured: boolean;
  /** Published Deadlines that repeat: listed for clubs but given no reminder emails. */
  repeatingDeadlines: number;
};

function portalUrl(audience: ReminderAudience) {
  return `${siteBaseUrl()}${audience === "AREA" ? "/account/area-clubs/overview" : "/account/clubs"}`;
}

function messageFor(batch: { title: string; dueOn: string; linkUrl: string | null }, recipient: { name: string; audience: ReminderAudience }, today: string) {
  return buildDeadlineReminderEmail({
    recipientName: recipient.name,
    title: batch.title,
    dueOn: batch.dueOn,
    today,
    linkUrl: batch.linkUrl,
    portalUrl: portalUrl(recipient.audience),
    audience: recipient.audience,
  });
}

/** The batches waiting for staff, soonest due date first, each with what it would say and who it would reach. */
export async function listPendingReminderBatches(now = new Date()): Promise<PendingReminders> {
  const prisma = getPrisma();
  const today = calendarDateIn(now);
  const [batches, audience, repeatingDeadlines] = await Promise.all([
    prisma.deadlineReminderBatch.findMany({ where: { status: "PENDING" }, orderBy: [{ dueOn: "asc" }, { daysBefore: "asc" }, { id: "asc" }] }),
    loadReminderRecipients(prisma, now),
    prisma.calendarEntry.count({
      where: { entryType: "DEADLINE", repeatRule: { not: null }, isPublished: true, isHiddenLocally: false, sourceRemovedAt: null, status: { not: "CANCELLED" } },
    }),
  ]);
  const emailConfigured = isAccountEmailConfigured();
  return {
    emailConfigured,
    repeatingDeadlines,
    batches: batches.map((batch) => {
      const preview = messageFor(batch, { name: "[recipient name]", audience: "CLUB" }, today);
      const areaPreview = messageFor(batch, { name: "[recipient name]", audience: "AREA" }, today);
      return {
        id: batch.id,
        title: batch.title,
        dueOn: batch.dueOn,
        dueLabel: dueLabel(batch.dueOn, today),
        daysBefore: batch.daysBefore,
        linkUrl: batch.linkUrl,
        preparedAt: batch.preparedAt.toISOString(),
        subject: preview.subject,
        bodyText: preview.bodyText,
        areaBodyText: areaPreview.bodyText,
        recipientCount: audience.recipients.length,
        clubRecipients: audience.recipients.filter((recipient) => recipient.audience === "CLUB").length,
        areaRecipients: audience.recipients.filter((recipient) => recipient.audience === "AREA").length,
        optedOutCount: audience.optedOut,
        fingerprint: reminderFingerprint({
          batchId: batch.id,
          daysBefore: batch.daysBefore,
          title: batch.title,
          dueOn: batch.dueOn,
          linkUrl: batch.linkUrl,
          recipientEmails: audience.recipients.map((recipient) => recipient.email),
        }),
      };
    }),
  };
}

export type SendReminderResult = { sent: number; optedOut: number; messageIds: string[] };

/**
 * The one human action: a system administrator approves a batch and its emails
 * are queued. Everything is checked again under the lock, against the calendar
 * as it is now: a batch whose deadline went away is withdrawn, one whose date,
 * title, link or recipients differ from what the administrator read is refused
 * (they look again), and a batch already sent can never be sent twice.
 * Delivery runs after this returns; the sweep is the durable fallback.
 */
export async function sendReminderBatch(
  batchId: string,
  approval: { fingerprint: string },
  actorUserId: string,
  now = new Date(),
): Promise<SendReminderResult> {
  if (!isAccountEmailConfigured()) {
    throw new DeadlineReminderError("EMAIL_NOT_CONFIGURED", "Account email isn't set up on this server, so reminders can't be sent yet.");
  }
  const sender = getAccountEmailSender();
  const today = calendarDateIn(now);
  const outcome = await getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reminderLockKey}))`;
    const batch = await tx.deadlineReminderBatch.findUnique({ where: { id: batchId } });
    if (!batch) return { kind: "missing" as const };
    if (batch.status !== "PENDING") return { kind: "notPending" as const, status: batch.status };

    const entry = batch.calendarEntryId
      ? await tx.calendarEntry.findUnique({ where: { id: batch.calendarEntryId }, select: entrySelect })
      : null;
    const reason = ineligibleReason(entry ?? undefined, today);
    const point = entry && !reason ? reminderPointFor(entry.endsOn, today) : null;
    // A batch belongs to one due date: if it moved, this reminder is withdrawn (the next run prepares one for the new date).
    if (reason || point !== batch.daysBefore || entry!.endsOn !== batch.dueOn) {
      await tx.deadlineReminderBatch.update({
        where: { id: batch.id },
        data: { status: "WITHDRAWN", statusReason: reason ?? "The due date moved; this reminder no longer applies.", decidedAt: now },
      });
      await writeAuditLog({
        actorUserId,
        action: "DEADLINE_REMINDER_WITHDRAWN",
        entityType: "DeadlineReminderBatch",
        entityId: batch.id,
        summary: `Withdrew the ${batch.daysBefore}-day reminder for "${batch.title}" instead of sending it.`,
        metadata: { reason: reason ?? "point changed", daysBefore: batch.daysBefore },
      }, tx);
      return { kind: "withdrawn" as const };
    }

    const current = { title: entry!.title, dueOn: entry!.endsOn, linkUrl: entry!.linkUrl };
    const audience = await loadReminderRecipients(tx, now);
    const fingerprint = reminderFingerprint({
      batchId: batch.id,
      daysBefore: batch.daysBefore,
      ...current,
      recipientEmails: audience.recipients.map((recipient) => recipient.email),
    });
    if (batch.title !== current.title || batch.linkUrl !== current.linkUrl) {
      await tx.deadlineReminderBatch.update({ where: { id: batch.id }, data: current });
    }
    if (fingerprint !== approval.fingerprint) return { kind: "changed" as const };
    if (audience.recipients.length === 0) return { kind: "noRecipients" as const };

    // Compare-and-set: of two clicks, exactly one gets past here (and the keys below make a repeat harmless anyway).
    const claimed = await tx.deadlineReminderBatch.updateMany({
      where: { id: batch.id, status: "PENDING" },
      data: { status: "SENT", decidedAt: now, decidedByUserId: actorUserId, recipientCount: audience.recipients.length, optedOutCount: audience.optedOut },
    });
    if (claimed.count !== 1) return { kind: "notPending" as const, status: "SENT" as const };

    const correlationId = randomUUID();
    const messageIds: string[] = [];
    for (const recipient of audience.recipients) {
      const content = messageFor(current, recipient, today);
      const message = await tx.messageOutbox.create({
        data: {
          eventId: null,
          templateKey: "DEADLINE_REMINDER",
          recipientKind: "ACCOUNT",
          recipientEmail: recipient.email,
          recipientName: recipient.name.trim() || null,
          senderNameSnapshot: sender.name,
          senderEmailSnapshot: sender.address,
          replyToEmailSnapshot: sender.replyTo,
          subjectSnapshot: content.subject,
          bodyTextSnapshot: content.bodyText,
          metadata: { trigger: "DEADLINE_REMINDER", accountEmail: true, realDelivery: true, deadlineReminderBatchId: batch.id, daysBefore: batch.daysBefore },
          idempotencyKey: `deadline-reminder:${batch.id}:${recipient.email}`,
          correlationId,
          status: "PENDING",
        },
        select: { id: true },
      });
      messageIds.push(message.id);
    }
    await writeAuditLog({
      actorUserId,
      action: "DEADLINE_REMINDER_SENT",
      entityType: "DeadlineReminderBatch",
      entityId: batch.id,
      summary: `Approved and sent the ${batch.daysBefore}-day reminder for "${current.title}" to ${audience.recipients.length} ${audience.recipients.length === 1 ? "person" : "people"}.`,
      metadata: { daysBefore: batch.daysBefore, dueOn: current.dueOn, recipients: audience.recipients.length, optedOut: audience.optedOut },
    }, tx);
    return { kind: "sent" as const, messageIds, optedOut: audience.optedOut };
  }, { timeout: 60_000, maxWait: 10_000 });

  switch (outcome.kind) {
    case "missing":
      throw new DeadlineReminderError("BATCH_NOT_FOUND", "That reminder could not be found.");
    case "notPending":
      throw new DeadlineReminderError("BATCH_NOT_PENDING", outcome.status === "SENT" ? "That reminder was already sent." : "That reminder is no longer waiting to be sent.");
    case "withdrawn":
      throw new DeadlineReminderError("BATCH_WITHDRAWN", "The deadline changed, so this reminder was withdrawn and nothing was sent.");
    case "changed":
      throw new DeadlineReminderError("BATCH_CHANGED", "The deadline or the people it goes to changed since you opened this. Review it again, then send.");
    case "noRecipients":
      throw new DeadlineReminderError("NO_RECIPIENTS", "There is nobody to send this reminder to.");
    case "sent":
      return { sent: outcome.messageIds.length, optedOut: outcome.optedOut, messageIds: outcome.messageIds };
  }
}

/** Staff choose not to send a batch. It stays on record, is never prepared again, and nothing is emailed. */
export async function dismissReminderBatch(batchId: string, actorUserId: string, now = new Date()) {
  await getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reminderLockKey}))`;
    const batch = await tx.deadlineReminderBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new DeadlineReminderError("BATCH_NOT_FOUND", "That reminder could not be found.");
    const claimed = await tx.deadlineReminderBatch.updateMany({
      where: { id: batchId, status: "PENDING" },
      data: { status: "DISMISSED", statusReason: "Staff chose not to send it.", decidedAt: now, decidedByUserId: actorUserId },
    });
    if (claimed.count !== 1) throw new DeadlineReminderError("BATCH_NOT_PENDING", "That reminder is no longer waiting to be sent.");
    await writeAuditLog({
      actorUserId,
      action: "DEADLINE_REMINDER_DISMISSED",
      entityType: "DeadlineReminderBatch",
      entityId: batchId,
      summary: `Chose not to send the ${batch.daysBefore}-day reminder for "${batch.title}".`,
      metadata: { daysBefore: batch.daysBefore, dueOn: batch.dueOn },
    }, tx);
  });
}
