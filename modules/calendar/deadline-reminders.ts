import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { addDays, calendarDateIn } from "@/modules/calendar/domain";
import { expandOccurrences, parseRepeatRule } from "@/modules/calendar/recurrence";
import {
  buildDeadlineReminderEmail,
  deadlineReminderPoints,
  dueLabel,
  reminderDate,
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
 * A repeating deadline is reminded for each occurrence: only the next
 * occurrence's latest reached point is prepared (occurrences come from the
 * calendar's own recurrence expansion, in conference time), and the batch of an
 * occurrence that has passed is withdrawn.
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
 * - Deadlines count as essential (owner decision, #915): people who opted out of
 *   announcements are still reminded. Provider suppression (bounces and
 *   complaints) still applies at delivery.
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
};

/**
 * Who a reminder goes to right now: every account holding an active role on an
 * active club, and every lasting Area Coordinator. Disabled or unverified
 * accounts, revoked or ended roles and invalid addresses are left out, and one
 * person is one email however many roles they hold. An opt-out of announcements
 * does not apply (deadlines are essential) unless the one switch
 * `deadlineRemindersHonourAnnouncementOptOut()` is turned back on.
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
  return { recipients };
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
  id: true, title: true, startsOn: true, endsOn: true, repeatExceptions: true, linkUrl: true, status: true, entryType: true, isPublished: true,
  isHiddenLocally: true, sourceRemovedAt: true, repeatRule: true,
} as const;

type EntryRow = Prisma.CalendarEntryGetPayload<{ select: typeof entrySelect }>;

type Assessment = {
  reason: string | null;
  /** The due date being reminded: a one-off's end date, or a repeating deadline's next occurrence. */
  dueOn: string | null;
  repeating: boolean;
  /** The reminder points that may be prepared for `dueOn` (a repeating deadline's closely spaced occurrences drop some). */
  allowedPoints: readonly DeadlineReminderPoint[];
};

/** A point can only be reached within this many days of its due date, so repeats are only expanded this far from today. */
const maxPointDays = Math.max(...deadlineReminderPoints);

/** How far ahead to look (about five years) to tell a sparse series from one that has ended. */
const laterLookaheadDays = 5 * 366;

/**
 * The due date a deadline is reminded for right now, and why it gets no
 * reminder (null when it does, apart from whether a point is reached yet).
 * A one-off deadline is due on its end date. A repeating one is reminded for
 * its next occurrence on or after today, from the calendar's own recurrence
 * expansion (calendar dates in the conference time zone, so a daylight-saving
 * change never moves one), skipping the dates staff skipped. Only a window
 * around today is expanded (a point is reached at most 14 days before its due
 * date), so a long-running daily rule costs a handful of steps, not thousands.
 *
 * A repeating deadline's point is prepared only if the point's date falls after
 * the previous occurrence's due date: after its first occurrence (which has no
 * previous one and so gets both points), a weekly deadline gets just the 2-day
 * reminder, and a daily one none, instead of a batch per occurrence that is
 * withdrawn a few days later.
 */
function assess(entry: EntryRow | undefined, today: string): Assessment {
  const none = (reason: string, repeating = false): Assessment => ({ reason, dueOn: null, repeating, allowedPoints: [] });
  if (!entry) return none("The calendar entry was removed.");
  if (entry.entryType !== "DEADLINE") return none("The entry is no longer marked as a deadline.");
  if (entry.status === "CANCELLED") return none("The deadline was cancelled.");
  if (entry.status === "POSTPONED") return none("The deadline was postponed.");
  if (!entry.isPublished || entry.isHiddenLocally || entry.sourceRemovedAt) return none("The deadline is hidden or unpublished.");
  const rule = parseRepeatRule(entry.repeatRule);
  if (!rule) {
    return entry.endsOn < today
      ? none("The due date has passed.")
      : { reason: null, dueOn: entry.endsOn, repeating: false, allowedPoints: deadlineReminderPoints };
  }
  const occurrences = expandOccurrences(entry, rule, entry.repeatExceptions, addDays(today, -maxPointDays), addDays(today, maxPointDays));
  const next = occurrences.find((occurrence) => occurrence.endsOn >= today);
  if (!next) {
    // Nothing within reach: either a later occurrence exists (a sparse rule) or the series has ended.
    const later = expandOccurrences(entry, rule, entry.repeatExceptions, addDays(today, maxPointDays + 1), addDays(today, laterLookaheadDays));
    return none(
      later.length > 0
        ? "The due date moved later; a reminder is prepared when its time comes."
        : "No occurrence of the repeating deadline is left.",
      true,
    );
  }
  const allowedPoints = deadlineReminderPoints.filter((point) => {
    const pointDate = reminderDate(next.endsOn, point);
    return !occurrences.some((occurrence) => occurrence.endsOn >= pointDate && occurrence.endsOn < next.endsOn);
  });
  return { reason: null, dueOn: next.endsOn, repeating: true, allowedPoints };
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
    const assessed = new Map<string, Assessment>();
    const assessOnce = (entry: EntryRow | undefined) => {
      if (!entry) return assess(entry, today);
      let found = assessed.get(entry.id);
      if (!found) assessed.set(entry.id, (found = assess(entry, today)));
      return found;
    };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reminderLockKey}))`;
    const result: ReconcileResult = { prepared: 0, updated: 0, withdrawn: 0 };

    const pending = await tx.deadlineReminderBatch.findMany({ where: { status: "PENDING" } });
    const candidates = await tx.calendarEntry.findMany({
      // A repeating deadline can start long before today; its next occurrence is worked out below.
      where: { entryType: "DEADLINE", OR: [{ endsOn: { gte: today } }, { repeatRule: { not: null } }] },
      select: entrySelect,
    });
    const known = new Map(candidates.map((entry) => [entry.id, entry]));
    const missingIds = pending.map((batch) => batch.calendarEntryId).filter((id): id is string => id !== null && !known.has(id));
    if (missingIds.length > 0) {
      for (const entry of await tx.calendarEntry.findMany({ where: { id: { in: missingIds } }, select: entrySelect })) known.set(entry.id, entry);
    }

    // Per deadline: the occurrence being reminded (its due date) and the latest reminder point reached for it.
    const points = new Map<string, { point: DeadlineReminderPoint; dueOn: string }>();
    for (const entry of candidates) {
      const { reason, dueOn, allowedPoints } = assessOnce(entry);
      if (reason || !dueOn) continue;
      const point = reminderPointFor(dueOn, today);
      if (point && allowedPoints.includes(point)) points.set(entry.id, { point, dueOn });
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
      const current = batch.calendarEntryId ? points.get(batch.calendarEntryId) : undefined;
      const assessment = assessOnce(entry);
      const repeating = assessment.repeating;
      // A one-off deadline's waiting batch follows its date; a repeating one's belongs to its occurrence.
      if (entry && current?.point === batch.daysBefore && (!repeating || current.dueOn === batch.dueOn)) {
        stillPending.add(batch.id);
        continue;
      }
      const reason = assessment.reason
        ?? (repeating && assessment.dueOn === batch.dueOn && !assessment.allowedPoints.includes(batch.daysBefore as DeadlineReminderPoint)
          ? `Occurrences are too close together for a ${batch.daysBefore}-day reminder.`
          : repeating && assessment.dueOn && assessment.dueOn !== batch.dueOn
          ? "That occurrence has passed or no longer applies; the next one's reminder follows."
          : current ? "The reminder point changed with the due date; the right one was prepared." : "The due date moved later; a reminder is prepared when its time comes.");
      await withdraw(batch, reason);
    }

    // Prepare, update or revive the batch for each deadline's current point.
    const entryIds = [...points.keys()];
    const existing = entryIds.length === 0
      ? []
      : await tx.deadlineReminderBatch.findMany({ where: { calendarEntryId: { in: entryIds } } });
    for (const [entryId, { point, dueOn }] of points) {
      const entry = known.get(entryId)!;
      const repeating = assessOnce(entry).repeating;
      const snapshot = { title: entry.title, dueOn, linkUrl: entry.linkUrl };
      const forPoint = existing.filter((candidate) => candidate.calendarEntryId === entryId && candidate.daysBefore === point);
      // A batch is per due date: if the date moved, an earlier due date's SENT or DISMISSED batch is history and this
      // date gets its own; a still-waiting batch for the old date simply moves along.
      const target = forPoint.find((candidate) => candidate.dueOn === snapshot.dueOn);
      // A repeating deadline's occurrences are separate due dates, never moved onto one another.
      const movable = target || repeating ? undefined : forPoint.find((candidate) => candidate.status === "PENDING");
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
          metadata: { daysBefore: point, previousDueOn: movable.dueOn, dueOn },
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
          metadata: { daysBefore: point, dueOn },
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
              metadata: { daysBefore: point, dueOn },
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
            metadata: { daysBefore: point, dueOn, revived: true },
          }, tx);
        }
        // SENT and DISMISSED are final for this due date: the same deadline, point and date are never prepared twice.
      }
      for (const other of forPoint.filter((candidate) => candidate.id !== activeId && candidate.status === "PENDING")) {
        await withdraw(other, repeating ? "That occurrence's reminder was replaced." : "The due date moved; this reminder was replaced.");
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
  /** The same point was already sent or dismissed for a different due date: a near-duplicate staff should know about. */
  earlierDecision: { status: "SENT" | "DISMISSED"; dueOn: string } | null;
  subject: string;
  /** The email as a club role holder reads it, and as an Area Coordinator reads it. */
  bodyText: string;
  areaBodyText: string;
  recipientCount: number;
  clubRecipients: number;
  areaRecipients: number;
  fingerprint: string;
};

export type PendingReminders = {
  batches: PendingReminderBatch[];
  /** False when account email is not set up on this server, so Send would refuse. */
  emailConfigured: boolean;
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
  const [batches, audience] = await Promise.all([
    prisma.deadlineReminderBatch.findMany({ where: { status: "PENDING" }, orderBy: [{ dueOn: "asc" }, { daysBefore: "asc" }, { id: "asc" }] }),
    loadReminderRecipients(prisma, now),
  ]);
  const emailConfigured = isAccountEmailConfigured();
  const decided = batches.length === 0
    ? []
    : await prisma.deadlineReminderBatch.findMany({
      where: { calendarEntryId: { in: batches.map((batch) => batch.calendarEntryId).filter((id): id is string => id !== null) }, status: { in: ["SENT", "DISMISSED"] } },
      orderBy: [{ decidedAt: "desc" }],
    });
  return {
    emailConfigured,
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
        earlierDecision: (() => {
          const earlier = decided.find((other) => other.calendarEntryId === batch.calendarEntryId && other.daysBefore === batch.daysBefore && other.dueOn !== batch.dueOn);
          return earlier ? { status: earlier.status as "SENT" | "DISMISSED", dueOn: earlier.dueOn } : null;
        })(),
        subject: preview.subject,
        bodyText: preview.bodyText,
        areaBodyText: areaPreview.bodyText,
        recipientCount: audience.recipients.length,
        clubRecipients: audience.recipients.filter((recipient) => recipient.audience === "CLUB").length,
        areaRecipients: audience.recipients.filter((recipient) => recipient.audience === "AREA").length,
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

export type SendReminderResult = { sent: number; messageIds: string[] };

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
    const { reason, dueOn: currentDueOn, allowedPoints } = assess(entry ?? undefined, today);
    const reached = currentDueOn && !reason ? reminderPointFor(currentDueOn, today) : null;
    const point = reached && allowedPoints.includes(reached) ? reached : null;
    // A batch belongs to one due date: if it moved, this reminder is withdrawn (the next run prepares one for the new date).
    if (reason || point !== batch.daysBefore || currentDueOn !== batch.dueOn) {
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

    const current = { title: entry!.title, dueOn: currentDueOn!, linkUrl: entry!.linkUrl };
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
      data: { status: "SENT", decidedAt: now, decidedByUserId: actorUserId, recipientCount: audience.recipients.length },
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
      metadata: { daysBefore: batch.daysBefore, dueOn: current.dueOn, recipients: audience.recipients.length },
    }, tx);
    return { kind: "sent" as const, messageIds };
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
      return { sent: outcome.messageIds.length, messageIds: outcome.messageIds };
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
