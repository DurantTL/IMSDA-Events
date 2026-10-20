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
import {
  IMMEDIATE_STALE_MS,
  buildClassChangeNotice,
  buildClassChangeSummary,
  classChangeIdempotencyKey,
  classSummaryIdempotencyKey,
  classSummaryWindow,
  netClassChanges,
  type SummaryClass,
} from "@/modules/honors/class-change-domain";
import { instructorMarksOpen } from "@/modules/honors/instructor-domain";
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

type Settings = Awaited<ReturnType<typeof loadEventEmailSettings>>;

export type ClassChangeEmailResult = {
  status: "SWITCHED_OFF" | "RAN";
  immediate: { changes: number; queued: number; skippedStale: number; failed: number };
  summaries: { due: boolean; instructors: number; queued: number; noChanges: number; failed: number };
  delivered: number;
};

function emptyResult(): ClassChangeEmailResult {
  return {
    status: "RAN",
    immediate: { changes: 0, queued: 0, skippedStale: 0, failed: 0 },
    summaries: { due: false, instructors: 0, queued: 0, noChanges: 0, failed: 0 },
    delivered: 0,
  };
}

/** Event email settings, read once per event and always outside a transaction. */
function settingsLoader() {
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
  return message.status === "PENDING" ? message.id : null;
}

async function deliverAfterCommit(messageIds: string[]) {
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
export async function dispatchImmediateClassChangeEmails(now = new Date(), result: ClassChangeEmailResult = emptyResult()): Promise<ClassChangeEmailResult> {
  // The staff switch is read here, before any transaction below opens (#1016).
  if (!await isNotificationEnabled("HONOR_INSTRUCTOR_CLASS_EMAILS")) return { ...result, status: "SWITCHED_OFF" };
  const prisma = getPrisma();
  const settingsFor = settingsLoader();
  const baseUrl = getServerEnv().APP_BASE_URL;
  const failedIds: string[] = [];
  const messageIds: string[] = [];
  for (;;) {
    const changes = await prisma.honorClassChange.findMany({
      where: { immediateHandledAt: null, ...(failedIds.length > 0 ? { id: { notIn: failedIds } } : {}) },
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
 * Called after an enrollment transaction commits, with how many change rows it wrote. Never throws: the enrollment is
 * already saved, and the sweep sends anything this misses.
 */
export async function kickClassChangeEmails(logged: number, now = new Date()) {
  if (logged <= 0) return;
  try {
    await dispatchImmediateClassChangeEmails(now);
  } catch (error) {
    logError("Right-away instructor class emails could not be sent after a class change; the sweep will.", error);
  }
}

// ---------------------------------------------------------------------------
// Daily summary
// ---------------------------------------------------------------------------

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
        event: { archivedAt: null },
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
          // What happened since the last summary, but never before they accepted: a change they weren't yet an instructor for isn't news.
          const since = new Date(Math.max(instructor.classChangeSummaryAt?.getTime() ?? 0, acceptedAt.getTime()));
          const logged = await tx.honorClassChange.findMany({
            where: { offeringId: { in: instructor.classes.map((entry) => entry.offeringId) }, at: { gt: since, lte: window.sendAt } },
            orderBy: [{ at: "asc" }, { id: "asc" }],
          });
          const net = netClassChanges(logged);
          if (net.length === 0 || !settings) return { messageId: null, changes: 0, claimed: true };
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
          if (classes.length === 0) return { messageId: null, changes: 0, claimed: true };
          classes.sort((a, b) => a.className.localeCompare(b.className) || a.session.localeCompare(b.session));
          const content = buildClassChangeSummary({ recipientName: instructor.name, eventName: instructor.event.name, classes, baseUrl });
          const messageId = await queueInstructorMessage(tx, {
            eventId: instructor.eventId,
            instructor,
            settings,
            templateKey: "HONOR_INSTRUCTOR_CLASS_SUMMARY",
            idempotencyKey: classSummaryIdempotencyKey(instructor.id, window.dateKey),
            subject: content.subject,
            bodyText: content.bodyText,
            metadata: { summaryDate: window.dateKey, changeCount: content.changes },
          });
          return { messageId, changes: content.changes, claimed: true };
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
  // The staff switch (#1016) comes first, before any transaction. Off: nothing is queued or stamped, so changes wait.
  if (!await isNotificationEnabled("HONOR_INSTRUCTOR_CLASS_EMAILS")) return { ...emptyResult(), status: "SWITCHED_OFF" };
  const result = emptyResult();
  await dispatchImmediateClassChangeEmails(now, result);
  await sendDueSummaries(now, result);
  return result;
}
