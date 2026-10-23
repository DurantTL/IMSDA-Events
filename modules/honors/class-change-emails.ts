import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { getServerEnv } from "@/lib/env";
import { logError } from "@/lib/logger";
import { suppressionNote } from "@/modules/communications/delivery-hold";
import { loadEventEmailSettings } from "@/modules/communications/effective-delivery";
import { processQueuedMessageIdsAfterCommit } from "@/modules/communications/messaging-repository";
import { isNotificationEnabled } from "@/modules/notifications/settings";
import { centralDateKey } from "@/modules/event-locations/waitlist-digest-domain";
import { recordAlertFeedItem } from "@/modules/notifications/feed";
import {
  CLASS_CHANGE_RETENTION_DAYS,
  IMMEDIATE_STALE_MS,
  buildClassChangeNotice,
  buildClassChangeSummary,
  classChangeIdempotencyKey,
  classSummaryIdempotencyKey,
  classSummaryWindow,
  netClassChanges,
  type SummaryClass,
} from "@/modules/honors/class-change-domain";
import { INSTRUCTOR_EDIT_GRACE_DAYS, instructorMarksOpen } from "@/modules/honors/instructor-domain";
import { offeringHonorsSelect, summarizeOfferingHonors } from "@/modules/honors/offering-honors";

/**
 * Emails to Honors Weekend instructors when a youth joins or leaves one of their classes (#1098).
 *
 * The change log (`class-change-log.ts`) is written inside the enrollment transactions; this file is the only sender, and
 * it never runs inside one. Two paths, by each instructor's choice:
 *
 * - DAILY (default): the scheduled outbox sweep calls `sendDueClassChangeEmails`. From about 6:00 AM Central, each
 *   accepted, un-revoked instructor gets one email covering all their classes, only when something really changed since
 *   their last summary (a join and a leave of the same youth cancel out). The instructor's `classChangeSummaryAt` is moved
 *   to the cutoff by a conditional update in the same transaction that queues the email, and the message carries the key
 *   `honor-class-change-summary:<instructor>:<Central date>`, so a second sweep, a retry or two sweeps at once send nothing twice.
 * - IMMEDIATE: one email per change, queued from the log after the enrollment commits (`kickClassChangeEmails`) and again by
 *   the sweep for anything a failed kick left behind. A change is stamped `immediateHandledAt` in the transaction that
 *   queues its emails; the message key is `honor-class-change:<change>:<instructor>`.
 * - OFF sends nothing.
 *
 * The staff switch (#1016) is read first, before any transaction. Paused event email is respected (the message is
 * recorded as SUPPRESSED, like a waitlist offer's), and instructors who were revoked, never accepted, or whose roster
 * has closed get nothing. Delivery happens after the queueing transaction commits; a failure leaves the message queued.
 */

const BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
export { CLASS_CHANGE_RETENTION_DAYS };

/** An event whose end is before this has a closed roster (the rule that stops the emails): end plus the roster window. */
export function rosterClosedBefore(now: Date) {
  return new Date(now.getTime() - INSTRUCTOR_EDIT_GRACE_DAYS * DAY_MS);
}

/**
 * Retention for the youth names, clubs and ages the log holds: every row of an event whose roster has closed, and any row
 * older than eight days (past any daily window; if the staff switch was off longer, those changes are simply not reported).
 * Runs on every sweep whatever the staff switch says.
 */
export async function pruneClassChanges(now = new Date()) {
  const deleted = await getPrisma().honorClassChange.deleteMany({
    where: { OR: [{ at: { lt: new Date(now.getTime() - CLASS_CHANGE_RETENTION_DAYS * DAY_MS) } }, { event: { endsAt: { lt: rosterClosedBefore(now) } } }] },
  });
  return deleted.count;
}

type Settings = Awaited<ReturnType<typeof loadEventEmailSettings>>;

export type ClassChangeEmailResult = {
  status: "SWITCHED_OFF" | "RAN";
  immediate: { changes: number; queued: number; skippedStale: number; failed: number };
  summaries: { due: boolean; instructors: number; queued: number; noChanges: number; failed: number };
  delivered: number;
  /** Change rows deleted by retention in this run. */
  pruned: number;
};

function emptyResult(): ClassChangeEmailResult {
  return {
    status: "RAN",
    immediate: { changes: 0, queued: 0, skippedStale: 0, failed: 0 },
    summaries: { due: false, instructors: 0, queued: 0, noChanges: 0, failed: 0 },
    delivered: 0,
    pruned: 0,
  };
}

/** Event email settings, read once per event and always outside a transaction. */
export function settingsLoader() {
  const cache = new Map<string, Promise<Settings>>();
  return (eventId: string) => {
    let known = cache.get(eventId);
    if (!known) {
      known = loadEventEmailSettings(getPrisma(), eventId);
      cache.set(eventId, known);
    }
    return known;
  };
}

type Db = Prisma.TransactionClient;

const ACTIVE = ["SUBMITTED", "CONFIRMED"] as const;

/** The class as the email names it, with who is in it now: every pick on the instructor's list against the class limit. */
async function classFacts(tx: Db, offeringIds: readonly string[]) {
  const ids = [...new Set(offeringIds)];
  const [offerings, counts] = await Promise.all([
    tx.honorOffering.findMany({
      where: { id: { in: ids } },
      select: { id: true, capacity: true, span: true, session: { select: { name: true } }, honors: offeringHonorsSelect },
    }),
    tx.honorEnrollment.groupBy({ by: ["offeringId"], where: { offeringId: { in: ids }, registration: { status: { in: [...ACTIVE] } } }, _count: { _all: true } }),
  ]);
  const enrolled = new Map(counts.map((row) => [row.offeringId, row._count._all]));
  return new Map(offerings.map((offering) => [offering.id, {
    offeringId: offering.id,
    className: summarizeOfferingHonors(offering.honors).honorName,
    session: offering.span === "ALL_SESSIONS" ? "All sessions" : offering.session?.name ?? "Session",
    capacity: offering.capacity,
    enrolled: enrolled.get(offering.id) ?? 0,
  }]));
}

async function queueInstructorMessage(tx: Db, input: {
  eventId: string;
  instructor: { id: string; email: string; name: string };
  settings: NonNullable<Settings>;
  templateKey: "HONOR_INSTRUCTOR_CLASS_SUMMARY" | "HONOR_INSTRUCTOR_CLASS_CHANGE";
  idempotencyKey: string;
  subject: string;
  bodyText: string;
  metadata: Record<string, string | number>;
  /** The Central-time day (YYYY-MM-DD) the emails belong to: the grain of the feed item. */
  day: string;
}) {
  const holdNote = suppressionNote(input.settings);
  const message = await tx.messageOutbox.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      eventId: input.eventId,
      templateKey: input.templateKey,
      recipientKind: "INTERNAL",
      recipientEmail: input.instructor.email,
      recipientName: input.instructor.name.trim() || null,
      senderNameSnapshot: input.settings.senderName,
      senderEmailSnapshot: input.settings.senderEmail,
      replyToEmailSnapshot: input.settings.replyToEmail,
      subjectSnapshot: input.subject,
      bodyTextSnapshot: input.bodyText,
      metadata: {
        trigger: input.templateKey,
        deliveryMode: input.settings.deliveryMode,
        realDelivery: input.settings.deliveryMode === "EXTERNAL_EMAIL",
        honorInstructorId: input.instructor.id,
        ...input.metadata,
      },
      idempotencyKey: input.idempotencyKey,
      correlationId: randomUUID(),
      status: holdNote ? "SUPPRESSED" : "PENDING",
      lastError: holdNote,
    },
    select: { id: true, status: true },
  });
  // The feed item (#1033) beside the email, in the same transaction: one per event per day however many instructors are
  // emailed (a per-instructor item would bury the feed). A paused event queues nothing that can leave, so no item. No names.
  if (message.status === "PENDING") {
    await recordAlertFeedItem(tx, {
      notificationKey: "HONOR_INSTRUCTOR_CLASS_EMAILS",
      occurrenceKey: `honor-instructor-class-emails:${input.eventId}:${input.day}`,
      summary: "Honors instructors were emailed about class changes.",
      href: `/more/honors/instructors?event=${encodeURIComponent(input.eventId)}`,
    });
  }
  return message.status === "PENDING" ? message.id : null;
}

export async function deliverAfterCommit(messageIds: string[]) {
  if (messageIds.length === 0) return 0;
  try {
    const delivery = await processQueuedMessageIdsAfterCommit(messageIds);
    return delivery.sentIds.length + delivery.capturedIds.length;
  } catch (error) {
    // The messages stay queued; the outbox sweep delivers them.
    logError("Instructor class change emails were queued but not delivered on the first attempt.", error, { messages: messageIds.length });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Right away
// ---------------------------------------------------------------------------

/**
 * Queues one email per change for every IMMEDIATE instructor of the class, for changes not yet handled. Safe to call from
 * anywhere after a commit and from the sweep: each change is claimed by a conditional stamp, so it is handled once.
 */
export async function dispatchImmediateClassChangeEmails(now = new Date(), result: ClassChangeEmailResult = emptyResult(), only?: readonly string[]): Promise<ClassChangeEmailResult> {
  // The staff switch is read here, before any transaction below opens (#1016).
  if (!await isNotificationEnabled("HONOR_INSTRUCTOR_CLASS_EMAILS")) return { ...result, status: "SWITCHED_OFF" };
  const prisma = getPrisma();
  const settingsFor = settingsLoader();
  const baseUrl = getServerEnv().APP_BASE_URL;
  const failedIds: string[] = [];
  const messageIds: string[] = [];
  if (only) {
    // A kick after one save works on its own rows only; the backlog is the sweep's. With nobody on right-away for these
    // classes there is nothing to queue, so the rows are stamped in one statement and no per-row transaction opens.
    const mine = await prisma.honorClassChange.findMany({ where: { id: { in: [...only] }, immediateHandledAt: null }, select: { offeringId: true } });
    if (mine.length === 0) return result;
    const anyone = await prisma.honorInstructor.count({
      where: { classChangeEmails: "IMMEDIATE", acceptedAt: { not: null }, revokedAt: null, classes: { some: { offeringId: { in: [...new Set(mine.map((row) => row.offeringId))] } } } },
    });
    if (anyone === 0) {
      await prisma.honorClassChange.updateMany({ where: { id: { in: [...only] }, immediateHandledAt: null }, data: { immediateHandledAt: now } });
      return result;
    }
  }
  for (;;) {
    const changes = await prisma.honorClassChange.findMany({
      where: {
        immediateHandledAt: null,
        ...(only ? { id: { in: [...only], ...(failedIds.length > 0 ? { notIn: failedIds } : {}) } } : failedIds.length > 0 ? { id: { notIn: failedIds } } : {}),
      },
      orderBy: [{ at: "asc" }, { id: "asc" }],
      take: BATCH,
    });
    if (changes.length === 0) break;
    for (const change of changes) {
      result.immediate.changes += 1;
      if (now.getTime() - change.at.getTime() > IMMEDIATE_STALE_MS) {
        // Too old to be news (the sweep or the staff switch was off): handled without an email.
        const stamped = await prisma.honorClassChange.updateMany({ where: { id: change.id, immediateHandledAt: null }, data: { immediateHandledAt: now } });
        result.immediate.skippedStale += stamped.count;
        continue;
      }
      try {
        const settings = await settingsFor(change.eventId);
        const queued = await prisma.$transaction(async (tx) => {
          const claimed = await tx.honorClassChange.updateMany({ where: { id: change.id, immediateHandledAt: null }, data: { immediateHandledAt: now } });
          if (claimed.count === 0) return [] as string[];
          const instructors = await tx.honorInstructor.findMany({
            where: {
              classChangeEmails: "IMMEDIATE",
              acceptedAt: { not: null, lte: change.at },
              revokedAt: null,
              // A change at or before the instructor's summary point was covered by that summary (a final one, for an
              // instructor who has since switched): it is not sent again.
              OR: [{ classChangeSummaryAt: null }, { classChangeSummaryAt: { lt: change.at } }],
              classes: { some: { offeringId: change.offeringId } },
            },
            select: { id: true, email: true, name: true, event: { select: { name: true, endsAt: true, archivedAt: true } } },
          });
          const open = instructors.filter((instructor) => !instructor.event.archivedAt && instructorMarksOpen(instructor.event.endsAt, now));
          if (open.length === 0 || !settings) return [] as string[];
          const facts = (await classFacts(tx, [change.offeringId])).get(change.offeringId);
          if (!facts) return [] as string[];
          const ids: string[] = [];
          for (const instructor of open) {
            const content = buildClassChangeNotice({
              recipientName: instructor.name,
              eventName: instructor.event.name,
              change: { ...facts, kind: change.kind, youthName: change.youthName, clubName: change.clubName, ageOnEventDate: change.ageOnEventDate, joined: [], left: [] },
              baseUrl,
            });
            const id = await queueInstructorMessage(tx, {
              eventId: change.eventId,
              instructor,
              settings,
              templateKey: "HONOR_INSTRUCTOR_CLASS_CHANGE",
              idempotencyKey: classChangeIdempotencyKey(change.id, instructor.id),
              subject: content.subject,
              bodyText: content.bodyText,
              metadata: { honorClassChangeId: change.id },
              day: centralDateKey(now),
            });
            if (id) ids.push(id);
          }
          return ids;
        });
        result.immediate.queued += queued.length;
        messageIds.push(...queued);
      } catch (error) {
        failedIds.push(change.id);
        result.immediate.failed += 1;
        logError("An instructor class change could not be queued; the next sweep will try again.", error, { honorClassChangeId: change.id });
      }
    }
  }
  result.delivered += await deliverAfterCommit(messageIds);
  return result;
}

/**
 * Called after an enrollment transaction commits, with the ids of the change rows it wrote (and no others). Never throws: the enrollment is
 * already saved, and the sweep sends anything this misses.
 */
export async function kickClassChangeEmails(changeIds: readonly string[], now = new Date()) {
  if (changeIds.length === 0) return;
  try {
    await dispatchImmediateClassChangeEmails(now, emptyResult(), changeIds);
  } catch (error) {
    logError("Right-away instructor class emails could not be sent after a class change; the sweep will.", error);
  }
}

// ---------------------------------------------------------------------------
// Daily summary
// ---------------------------------------------------------------------------

type SummaryInstructor = { id: string; email: string; name: string; eventId: string; event: { name: string }; classes: Array<{ offeringId: string }> };

/**
 * Builds and queues one summary for what happened to the instructor's classes in (since, until], netted. Inside the caller's
 * transaction, after it has claimed the instructor's summary point. Queues nothing when nothing really changed.
 */
async function queueSummary(tx: Db, input: { instructor: SummaryInstructor; settings: Settings; since: Date; until: Date; idempotencyKey: string; summaryDate: string; baseUrl: string }) {
  const { instructor, settings } = input;
  const logged = await tx.honorClassChange.findMany({
    where: { offeringId: { in: instructor.classes.map((entry) => entry.offeringId) }, at: { gt: input.since, lte: input.until } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  const net = netClassChanges(logged);
  if (net.length === 0 || !settings) return { messageId: null as string | null, changes: 0 };
  const facts = await classFacts(tx, net.map((change) => change.offeringId));
  const classes: SummaryClass[] = [];
  for (const offeringId of [...new Set(net.map((change) => change.offeringId))]) {
    const fact = facts.get(offeringId);
    if (!fact) continue;
    const mine = net.filter((change) => change.offeringId === offeringId);
    classes.push({
      ...fact,
      joined: mine.filter((change) => change.kind === "JOINED"),
      left: mine.filter((change) => change.kind === "LEFT"),
    });
  }
  if (classes.length === 0) return { messageId: null, changes: 0 };
  classes.sort((a, b) => a.className.localeCompare(b.className) || a.session.localeCompare(b.session));
  const content = buildClassChangeSummary({ recipientName: instructor.name, eventName: instructor.event.name, classes, baseUrl: input.baseUrl });
  const messageId = await queueInstructorMessage(tx, {
    eventId: instructor.eventId,
    instructor,
    settings: settings,
    templateKey: "HONOR_INSTRUCTOR_CLASS_SUMMARY",
    idempotencyKey: input.idempotencyKey,
    subject: content.subject,
    bodyText: content.bodyText,
    metadata: { summaryDate: input.summaryDate, changeCount: content.changes },
    day: centralDateKey(input.until),
  });
  return { messageId, changes: content.changes };
}

async function sendDueSummaries(now: Date, result: ClassChangeEmailResult) {
  const window = classSummaryWindow(now);
  result.summaries.due = window.due;
  if (!window.due) return;
  const prisma = getPrisma();
  const settingsFor = settingsLoader();
  const baseUrl = getServerEnv().APP_BASE_URL;
  const messageIds: string[] = [];
  let after: string | undefined;
  for (;;) {
    const instructors = await prisma.honorInstructor.findMany({
      where: {
        classChangeEmails: "DAILY",
        acceptedAt: { not: null },
        revokedAt: null,
        classes: { some: {} },
        // A closed roster is not read again: the same end-plus-window rule that stops the emails.
        event: { archivedAt: null, endsAt: { gte: rosterClosedBefore(now) } },
        OR: [{ classChangeSummaryAt: null }, { classChangeSummaryAt: { lt: window.sendAt } }],
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, email: true, name: true, acceptedAt: true, classChangeSummaryAt: true, eventId: true, event: { select: { name: true, endsAt: true } }, classes: { select: { offeringId: true } } },
    });
    if (instructors.length === 0) break;
    after = instructors[instructors.length - 1]!.id;
    for (const instructor of instructors) {
      // A closed roster gets no email, and is left alone: nothing is stamped.
      if (!instructorMarksOpen(instructor.event.endsAt, now) || !instructor.acceptedAt) continue;
      result.summaries.instructors += 1;
      try {
        const settings = await settingsFor(instructor.eventId);
        const acceptedAt = instructor.acceptedAt;
        const queued = await prisma.$transaction(async (tx) => {
          // The claim: only one run can move the instructor's summary point to this cutoff, so a double sweep stops here.
          const claimed = await tx.honorInstructor.updateMany({
            where: {
              id: instructor.id,
              classChangeEmails: "DAILY",
              revokedAt: null,
              OR: [{ classChangeSummaryAt: null }, { classChangeSummaryAt: { lt: window.sendAt } }],
            },
            data: { classChangeSummaryAt: window.sendAt },
          });
          if (claimed.count === 0) return { messageId: null as string | null, changes: 0, claimed: false };
          const built = await queueSummary(tx, {
            instructor,
            settings,
            since: new Date(Math.max(instructor.classChangeSummaryAt?.getTime() ?? 0, acceptedAt.getTime())),
            until: window.sendAt,
            idempotencyKey: classSummaryIdempotencyKey(instructor.id, window.dateKey),
            summaryDate: window.dateKey,
            baseUrl,
          });
          return { ...built, claimed: true };
        });
        if (!queued.claimed) continue;
        if (queued.changes === 0) result.summaries.noChanges += 1;
        else result.summaries.queued += 1;
        if (queued.messageId) messageIds.push(queued.messageId);
      } catch (error) {
        result.summaries.failed += 1;
        logError("An instructor's class change summary could not be queued; the next sweep will try again.", error, { honorInstructorId: instructor.id });
      }
    }
  }
  result.delivered += await deliverAfterCommit(messageIds);
}

/** The scheduled sweep's entry: right-away emails left behind, then the daily summaries if it is time. Safe on every sweep. */
export async function sendDueClassChangeEmails(now = new Date()): Promise<ClassChangeEmailResult> {
  // Retention runs whatever the switch says: it only deletes, and holds youth names that must not be kept for ever.
  const pruned = await pruneClassChanges(now).catch((error) => {
    logError("Old instructor class change rows could not be pruned; the next sweep will try again.", error);
    return 0;
  });
  // The staff switch (#1016) comes first, before any transaction. Off: nothing is queued or stamped, so changes wait.
  if (!await isNotificationEnabled("HONOR_INSTRUCTOR_CLASS_EMAILS")) return { ...emptyResult(), pruned, status: "SWITCHED_OFF" };
  const result = { ...emptyResult(), pruned };
  await dispatchImmediateClassChangeEmails(now, result);
  await sendDueSummaries(now, result);
  return result;
}

/**
 * An instructor who leaves the daily summary (for right-away or no emails) gets one last summary of what changed since their
 * previous one, so nothing is lost by switching. Call it after the choice has committed. Claims the summary point exactly as the
 * daily run does, so it cannot double up with a sweep; if nothing changed it only moves the point.
 */
export async function sendFinalClassChangeSummary(instructorId: string, now = new Date()) {
  // The staff switch is read before any transaction below (#1016). Everything runs under one catch: the choice has already
  // committed, so a failure here must never turn into an error for the person who saved it.
  try {
    if (!await isNotificationEnabled("HONOR_INSTRUCTOR_CLASS_EMAILS")) return { queued: false };
    const prisma = getPrisma();
    const instructor = await prisma.honorInstructor.findFirst({
      where: { id: instructorId, acceptedAt: { not: null }, revokedAt: null, classes: { some: {} } },
      select: { id: true, email: true, name: true, acceptedAt: true, classChangeSummaryAt: true, eventId: true, event: { select: { name: true, endsAt: true, archivedAt: true } }, classes: { select: { offeringId: true } } },
    });
    if (!instructor?.acceptedAt || instructor.event.archivedAt || !instructorMarksOpen(instructor.event.endsAt, now)) return { queued: false };
    if (instructor.classChangeSummaryAt && instructor.classChangeSummaryAt.getTime() >= now.getTime()) return { queued: false };
    const acceptedAt = instructor.acceptedAt;
    const settings = await settingsLoader()(instructor.eventId);
    const queued = await prisma.$transaction(async (tx) => {
      // The claim is on the exact summary point that was read (or null): of two runs that read the same one, only one wins.
      const claimed = await tx.honorInstructor.updateMany({
        where: { id: instructor.id, revokedAt: null, classChangeSummaryAt: instructor.classChangeSummaryAt },
        data: { classChangeSummaryAt: now },
      });
      if (claimed.count === 0) return { messageId: null as string | null };
      return queueSummary(tx, {
        instructor,
        settings,
        since: new Date(Math.max(instructor.classChangeSummaryAt?.getTime() ?? 0, acceptedAt.getTime())),
        until: now,
        idempotencyKey: `honor-class-change-summary:${instructor.id}:final:${now.toISOString()}`,
        summaryDate: "final",
        baseUrl: getServerEnv().APP_BASE_URL,
      });
    });
    if (queued.messageId) await deliverAfterCommit([queued.messageId]);
    return { queued: queued.messageId !== null };
  } catch (error) {
    logError("An instructor's final class change summary could not be queued.", error, { honorInstructorId: instructorId });
    return { queued: false };
  }
}
