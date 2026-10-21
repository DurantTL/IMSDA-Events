import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { suppressionNote } from "@/modules/communications/delivery-hold";
import { isNotificationEnabled } from "@/modules/notifications/settings";
import { classSummaryWindow, netClassChanges, type LoggedClassChange } from "@/modules/honors/class-change-domain";
import { deliverAfterCommit, rosterClosedBefore, settingsLoader } from "@/modules/honors/class-change-emails";
import { instructorMarksOpen } from "@/modules/honors/instructor-domain";
import { offeringHonorsSelect, summarizeOfferingHonors } from "@/modules/honors/offering-honors";
import {
  buildHonorWatchSummary,
  honorWatchIdempotencyKey,
  watchMatchesClass,
  watchWindow,
  type WatchSummaryClass,
} from "@/modules/honors/watch-domain";

/**
 * The daily honor watch summaries (#1099). Built on the class change log of #1098 (`HonorClassChange`), the same 6:00 AM Central
 * window and the same netting, and sent from the same scheduled outbox sweep. It never runs inside a transaction that sends.
 *
 * From about 6:00 AM Central, each watch of a live event sends one email to each of its addresses listing the picks and drops
 * since its last summary for classes that teach a watched honor (any of the several honors of a class counts, #812) or that are a
 * watched class. A join and a leave of the same youth in the same class inside the window cancel out; with nothing left, nothing
 * is queued.
 *
 * Why a second sweep cannot send twice (any one of these is enough):
 * 1. the watch's `summaryAt` is moved to the cutoff by one conditional update, on the exact value just read, in the same
 *    transaction that queues the messages: only one run wins it, and a rollback leaves both untouched;
 * 2. each message carries the key `honor-watch-summary:<watch>:<Central date>:<address>`, and the outbox reuses an existing message.
 *
 * Retention: the log is pruned after eight days (`CLASS_CHANGE_RETENTION_DAYS`). The summary point moves to the cutoff on every
 * day a watch is due, so a window is about a day long and its rows are always younger than that; the point is what makes pruning
 * safe. If the sweep or the staff switch was off for more than eight days, the rows of that gap are gone and are not reported.
 * A watch holds no youth data, and the messages carry names, clubs and ages only (never a birth date).
 *
 * The staff switch "Honor watch summaries" (#1016) is read first, before any transaction. Paused event email is respected: the
 * messages are recorded as SUPPRESSED, as a waitlist offer's are.
 */

const BATCH = 50;

export type HonorWatchSummaryResult = {
  status: "SWITCHED_OFF" | "RAN";
  due: boolean;
  watches: number;
  /** Watches whose summary was queued (or recorded as suppressed). */
  queued: number;
  /** Watches that were due but had nothing that really changed. */
  noChanges: number;
  failed: number;
  messages: number;
  delivered: number;
};

function emptyResult(): HonorWatchSummaryResult {
  return { status: "RAN", due: false, watches: 0, queued: 0, noChanges: 0, failed: 0, messages: 0, delivered: 0 };
}

type Db = Prisma.TransactionClient;
type Settings = Awaited<ReturnType<ReturnType<typeof settingsLoader>>>;

/** The class as the email names it, for the classes a window's changes were in. */
async function classFacts(tx: Db, offeringIds: readonly string[]) {
  const offerings = await tx.honorOffering.findMany({
    where: { id: { in: [...new Set(offeringIds)] } },
    select: { id: true, span: true, session: { select: { name: true } }, honors: offeringHonorsSelect },
  });
  return new Map(offerings.map((offering) => {
    const summary = summarizeOfferingHonors(offering.honors);
    return [offering.id, {
      offeringId: offering.id,
      className: summary.honorName || "Class",
      session: offering.span === "ALL_SESSIONS" ? "All sessions" : offering.session?.name ?? "Session",
      honorIds: summary.honorIds,
    }] as const;
  }));
}

/**
 * Inside the caller's transaction, after it has claimed the watch's summary point: what really changed in the window for the
 * classes the watch looks at, queued once per address. Returns nothing queued when nothing really changed.
 */
async function queueWatchSummary(tx: Db, input: {
  watch: { id: string; eventId: string; name: string; recipients: string[]; honorIds: string[]; offeringIds: string[]; summaryAt: Date | null; createdAt: Date };
  eventName: string;
  settings: NonNullable<Settings>;
  until: Date;
  dateKey: string;
}) {
  const { watch, settings } = input;
  const { since, until } = watchWindow(watch, input.until);
  const logged = await tx.honorClassChange.findMany({
    where: { eventId: watch.eventId, at: { gt: since, lte: until } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  if (logged.length === 0) return { messageIds: [] as string[], changes: 0, messages: 0 };
  const facts = await classFacts(tx, logged.map((row) => row.offeringId));
  const mine: LoggedClassChange[] = logged.filter((row) => {
    const fact = facts.get(row.offeringId);
    return fact ? watchMatchesClass(watch, { id: fact.offeringId, honorIds: fact.honorIds }) : false;
  });
  const net = netClassChanges(mine);
  if (net.length === 0) return { messageIds: [] as string[], changes: 0, messages: 0 };
  const classes: WatchSummaryClass[] = [];
  for (const offeringId of [...new Set(net.map((change) => change.offeringId))]) {
    const fact = facts.get(offeringId)!;
    const here = net.filter((change) => change.offeringId === offeringId);
    classes.push({
      offeringId,
      className: fact.className,
      session: fact.session,
      joined: here.filter((change) => change.kind === "JOINED"),
      left: here.filter((change) => change.kind === "LEFT"),
    });
  }
  classes.sort((a, b) => a.className.localeCompare(b.className) || a.session.localeCompare(b.session) || a.offeringId.localeCompare(b.offeringId));
  const content = buildHonorWatchSummary({ watchName: watch.name, eventName: input.eventName, classes });
  const holdNote = suppressionNote(settings);
  const messageIds: string[] = [];
  for (const email of watch.recipients) {
    const idempotencyKey = honorWatchIdempotencyKey(watch.id, input.dateKey, email);
    const message = await tx.messageOutbox.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        eventId: watch.eventId,
        templateKey: "HONOR_WATCH_SUMMARY",
        recipientKind: "INTERNAL",
        recipientEmail: email,
        recipientName: null,
        senderNameSnapshot: settings.senderName,
        senderEmailSnapshot: settings.senderEmail,
        replyToEmailSnapshot: settings.replyToEmail,
        subjectSnapshot: content.subject,
        bodyTextSnapshot: content.bodyText,
        // Ids and counts only: never a name or an address.
        metadata: {
          trigger: "HONOR_WATCH_SUMMARY",
          deliveryMode: settings.deliveryMode,
          realDelivery: settings.deliveryMode === "EXTERNAL_EMAIL",
          honorWatchId: watch.id,
          summaryDate: input.dateKey,
          changeCount: content.changes,
        },
        idempotencyKey,
        correlationId: randomUUID(),
        status: holdNote ? "SUPPRESSED" : "PENDING",
        lastError: holdNote,
      },
      select: { id: true, status: true },
    });
    if (message.status === "PENDING") messageIds.push(message.id);
  }
  return { messageIds, changes: content.changes, messages: watch.recipients.length };
}

/**
 * The scheduled sweep's entry: from 6:00 AM Central (plus the usual two-minute grace), each due watch of a live event sends its
 * summary. Safe on every sweep, and for several sweeps at once.
 */
export async function sendDueHonorWatchSummaries(now = new Date()): Promise<HonorWatchSummaryResult> {
  // The staff switch (#1016) comes first, before any transaction. Off: nothing is queued or stamped, so changes wait for the
  // next window (and are reported then, if they are still in the log).
  if (!await isNotificationEnabled("HONOR_WATCH_SUMMARIES")) return { ...emptyResult(), status: "SWITCHED_OFF" };
  const result = emptyResult();
  const window = classSummaryWindow(now);
  result.due = window.due;
  if (!window.due) return result;
  const prisma = getPrisma();
  const settingsFor = settingsLoader();
  const messageIds: string[] = [];
  let after: string | undefined;
  for (;;) {
    const watches = await prisma.honorWatch.findMany({
      where: {
        // A closed roster is not read again: the same end-plus-window rule that stops the instructor emails and prunes the log.
        event: { archivedAt: null, endsAt: { gte: rosterClosedBefore(now) } },
        OR: [{ summaryAt: null }, { summaryAt: { lt: window.sendAt } }],
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, eventId: true, event: { select: { name: true, endsAt: true } } },
    });
    if (watches.length === 0) break;
    after = watches[watches.length - 1]!.id;
    for (const listed of watches) {
      if (!instructorMarksOpen(listed.event.endsAt, now)) continue;
      result.watches += 1;
      try {
        const settings = await settingsFor(listed.eventId);
        // An event with no email settings cannot be mailed: leave the watch alone so its changes are not skipped.
        if (!settings) continue;
        const queued = await prisma.$transaction(async (tx) => {
          // Read the watch again under the transaction: staff may have saved it since the list above was read.
          const watch = await tx.honorWatch.findUnique({ where: { id: listed.id } });
          if (!watch || (watch.summaryAt && watch.summaryAt.getTime() >= window.sendAt.getTime())) return { claimed: false, messageIds: [] as string[], changes: 0, messages: 0 };
          // The claim: only one run can move the summary point from this exact value to the cutoff, so a double sweep stops here.
          const claimed = await tx.honorWatch.updateMany({ where: { id: watch.id, summaryAt: watch.summaryAt }, data: { summaryAt: window.sendAt } });
          if (claimed.count === 0) return { claimed: false, messageIds: [] as string[], changes: 0, messages: 0 };
          const built = await queueWatchSummary(tx, { watch, eventName: listed.event.name, settings, until: window.sendAt, dateKey: window.dateKey });
          return { claimed: true, ...built };
        });
        if (!queued.claimed) continue;
        if (queued.changes === 0) result.noChanges += 1;
        else result.queued += 1;
        result.messages += queued.messages;
        messageIds.push(...queued.messageIds);
      } catch (error) {
        result.failed += 1;
        logError("An honor watch summary could not be queued; the next sweep will try again.", error, { honorWatchId: listed.id });
      }
    }
  }
  // Never inside a transaction: delivery happens only after every queueing transaction above has committed.
  result.delivered += await deliverAfterCommit(messageIds);
  return result;
}
