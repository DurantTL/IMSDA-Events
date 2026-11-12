import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type ScheduledEmailBatch } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { AccountEmailNotConfiguredError, getAccountEmailSender } from "@/modules/communications/account-email";
import { SCHEDULED_EMAIL_MAX_LATE_MS } from "@/modules/communications/scheduled-email-domain";
import {
  DEBRIEF_MODULE_KEY,
  debriefEmailContent,
  debriefFillPath,
  debriefMessageKey,
  debriefSchedule,
  nonResponders,
  type DebriefBatchKind,
  type DebriefFormPurpose,
  type DebriefRecipient,
} from "@/modules/event-debriefs/domain";
import { answeredAccountIds, resolveDebriefRecipients } from "@/modules/event-debriefs/recipients";

export type DebriefDispatchResult = {
  batchId: string;
  outcome: "completed" | "paused" | "failed" | "skipped" | "partial";
  queued: number;
  excluded: number;
  messageIds: string[];
  reason?: string;
};

const CHUNK = 25;

function kindOf(templateKey: string): DebriefBatchKind | null {
  if (templateKey === "EVENT_DEBRIEF_INVITE") return "INVITE";
  if (templateKey === "EVENT_DEBRIEF_REMINDER") return "REMINDER";
  return null;
}

/**
 * Sends one due debrief batch: the invitation or the reminder. Called by the scheduled email dispatcher for a batch it has
 * already claimed (`runScheduledEmailBatch`), so a second worker or a retry cannot run it again; and every message has a
 * key made from the batch, the person and the form, so a retry after a crash queues nothing twice.
 *
 * The recipients are the debrief audience as it is now (`resolveDebriefRecipients`), not registrations. The reminder goes
 * only to those who have not answered. The director evaluation is included only while its switch is on. Nothing is sent when
 * the module has been switched off, when the batch is more than six hours late, or when the event's dates moved (the batch
 * is moved to its new time instead).
 */
export async function runDebriefBatch(
  prisma: PrismaClient,
  batch: ScheduledEmailBatch,
  claimToken: string,
  now: Date,
): Promise<DebriefDispatchResult> {
  const result: DebriefDispatchResult = { batchId: batch.id, outcome: "completed", queued: 0, excluded: 0, messageIds: [] };
  const kind = kindOf(batch.templateKey);
  const held = { id: batch.id, claimToken, status: "ACTIVE" as const };
  const stop = async (data: Prisma.ScheduledEmailBatchUpdateManyMutationInput, reason: string, outcome: DebriefDispatchResult["outcome"], summary: string) => {
    const updated = await prisma.scheduledEmailBatch.updateMany({ where: held, data });
    if (updated.count === 1) {
      await prisma.auditLog.create({
        data: { eventId: batch.eventId, action: "EVENT_DEBRIEF_NOT_SENT", entityType: "ScheduledEmailBatch", entityId: batch.id, correlationId: randomUUID(), summary, metadata: { reason } },
      });
    }
    return { ...result, outcome, reason };
  };

  if (!kind) {
    return stop({ status: "FAILED", failedAt: now, failureReason: "This is not a debrief message." }, "NOT_DEBRIEF", "failed", "A debrief batch could not be sent.");
  }
  const moduleRow = await prisma.eventModule.findUnique({ where: { eventId_moduleKey: { eventId: batch.eventId, moduleKey: DEBRIEF_MODULE_KEY } }, select: { id: true } });
  if (!moduleRow) {
    return stop({ status: "CANCELLED", cancelledAt: now }, "MODULE_OFF", "skipped", "Did not send the debrief because it was switched off.");
  }
  if (now.getTime() - batch.sendAt.getTime() > SCHEDULED_EMAIL_MAX_LATE_MS) {
    return stop(
      { status: "FAILED", failedAt: now, failureReason: "The debrief email was not sent within six hours of its time, so it was not sent at all." },
      "MISSED_WINDOW", "failed", "A debrief email was not sent because its time had passed.",
    );
  }
  const event = await prisma.event.findUnique({ where: { id: batch.eventId }, select: { name: true, slug: true, timezone: true, endsAt: true, debrief: { select: { evaluationEnabled: true } } } });
  if (!event) return stop({ status: "CANCELLED", cancelledAt: now }, "EVENT_GONE", "skipped", "Did not send the debrief because the event is gone.");

  // The event's dates moved after this was scheduled: follow them. Released, not sent.
  const projection = debriefSchedule(event)[kind === "INVITE" ? "invite" : "reminder"];
  if (projection.sendAt.getTime() !== batch.sendAt.getTime()) {
    await prisma.scheduledEmailBatch.updateMany({
      where: held,
      data: { sendAt: projection.sendAt, anchorAt: projection.anchorAt, eventTimezone: projection.eventTimezone, dstBehavior: projection.dstBehavior, dstNote: projection.dstNote, claimToken: null, claimedAt: null, revision: { increment: 1 } },
    });
    return { ...result, outcome: "skipped", reason: "EVENT_TIMING_CHANGED" };
  }

  let sender: ReturnType<typeof getAccountEmailSender>;
  try {
    sender = getAccountEmailSender();
  } catch (error) {
    if (!(error instanceof AccountEmailNotConfiguredError)) throw error;
    return stop({ status: "FAILED", failedAt: now, failureReason: "Email sending is not set up, so the debrief could not be sent." }, "EMAIL_NOT_CONFIGURED", "failed", "A debrief email could not be sent because email is not set up.");
  }

  const purposes: DebriefFormPurpose[] = event.debrief?.evaluationEnabled ? ["DEBRIEF", "DIRECTOR_EVALUATION"] : ["DEBRIEF"];
  const baseUrl = getServerEnv().APP_BASE_URL;
  const planned: Array<{ purpose: DebriefFormPurpose; recipient: DebriefRecipient }> = [];
  for (const purpose of purposes) {
    const audience = await resolveDebriefRecipients(prisma, batch.eventId, purpose, now);
    const wanted = kind === "REMINDER" ? nonResponders(audience, await answeredAccountIds(prisma, batch.eventId, purpose)) : audience;
    result.excluded += audience.length - wanted.length;
    for (const recipient of wanted) planned.push({ purpose, recipient });
  }

  for (let offset = 0; offset < planned.length; offset += CHUNK) {
    const chunk = planned.slice(offset, offset + CHUNK);
    const ids = await prisma.$transaction(async (tx) => {
      const stillHeld = await tx.scheduledEmailBatch.updateMany({ where: held, data: { claimedAt: new Date() } });
      if (stillHeld.count !== 1) return null;
      const keys = chunk.map(({ purpose, recipient }) => debriefMessageKey(batch.id, recipient.accountId, purpose));
      const already = new Set((await tx.messageOutbox.findMany({ where: { idempotencyKey: { in: keys } }, select: { idempotencyKey: true } })).map((row) => row.idempotencyKey));
      const queued: string[] = [];
      for (const { purpose, recipient } of chunk) {
        const key = debriefMessageKey(batch.id, recipient.accountId, purpose);
        if (already.has(key)) continue;
        const content = debriefEmailContent({ kind, purpose, eventName: event.name, recipientName: recipient.name, url: new URL(debriefFillPath(event.slug, purpose), baseUrl).toString() });
        const message = await tx.messageOutbox.create({
          data: {
            eventId: batch.eventId,
            templateKey: batch.templateKey,
            recipientKind: "INTERNAL",
            recipientEmail: recipient.email,
            recipientName: recipient.name || null,
            senderNameSnapshot: sender.name,
            senderEmailSnapshot: sender.address,
            replyToEmailSnapshot: sender.replyTo,
            subjectSnapshot: content.subject,
            bodyTextSnapshot: content.bodyText,
            // `debriefBatchId`, not `scheduledEmailBatchId`: this audience is not a list of registrations, so the registration check
            // that guards the other scheduled messages does not apply to it.
            metadata: { trigger: "EVENT_DEBRIEF", debriefBatchId: batch.id, purpose, accountEmail: false, realDelivery: true },
            idempotencyKey: key,
            correlationId: batch.id,
            status: "PENDING",
          },
          select: { id: true },
        });
        queued.push(message.id);
      }
      return queued;
    });
    if (ids === null) return { ...result, outcome: "partial", reason: "CLAIM_LOST" };
    result.queued += ids.length;
    result.messageIds.push(...ids);
  }

  const done = await prisma.scheduledEmailBatch.updateMany({
    where: held,
    data: { status: "COMPLETED", completedAt: now, eligibleCount: planned.length, excludedCount: result.excluded },
  });
  if (done.count === 1) {
    await prisma.auditLog.create({
      data: {
        eventId: batch.eventId,
        action: "EVENT_DEBRIEF_SENT",
        entityType: "ScheduledEmailBatch",
        entityId: batch.id,
        correlationId: randomUUID(),
        summary: kind === "INVITE" ? "Queued the debrief invitation." : "Queued the debrief reminder for people who had not answered.",
        metadata: { kind, queued: result.queued, alreadyAnswered: result.excluded },
      },
    });
  }
  return result;
}
