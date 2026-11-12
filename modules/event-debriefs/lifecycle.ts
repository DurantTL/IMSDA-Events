import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { SCHEDULED_EMAIL_MIN_LEAD_MS } from "@/modules/communications/scheduled-email-domain";
import { parseInformationFormDefinition } from "@/modules/information-forms/definition";
import { scopedActorAudit, type ScopedToggleActor } from "@/modules/event-modules/scoped-toggle";
import {
  DEBRIEF_BATCH_NAMES,
  DEBRIEF_BATCH_TEMPLATE_KEYS,
  DEBRIEF_FORM_SLUGS,
  DEBRIEF_FORM_TITLES,
  DEBRIEF_MODULE_KEY,
  DEBRIEF_REMINDER_DAYS_AFTER,
  DEBRIEF_INVITE_DAYS_AFTER,
  DEBRIEF_SEND_LOCAL_TIME,
  ScheduleProjectionError,
  debriefBatchId,
  debriefSchedule,
  starterDefinition,
  type DebriefBatchKind,
  type DebriefFormPurpose,
} from "@/modules/event-debriefs/domain";

type Client = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

const batchKinds: readonly DebriefBatchKind[] = ["INVITE", "REMINDER"];

/** The audit trail of the debrief's own work: ids and counts, never an answer. */
function audit(tx: Tx, actor: ScopedToggleActor | null, eventId: string, action: string, summary: string, metadata: Prisma.InputJsonObject = {}) {
  const who = actor ? scopedActorAudit(actor) : { metadata: {} as Prisma.InputJsonObject };
  return writeAuditLog({
    eventId,
    ...("actorUserId" in who && who.actorUserId ? { actorUserId: who.actorUserId } : {}),
    action,
    entityType: "EventDebrief",
    entityId: eventId,
    summary,
    metadata: { ...who.metadata, eventId, moduleKey: DEBRIEF_MODULE_KEY, ...metadata },
  }, tx);
}

/**
 * Forms are owned by a staff user (a form has no other owner column). When an Area Coordinator switches the module on there
 * is no staff user in the request, so the form is recorded as made by the event's first active administrator, else the
 * first system administrator. The audit entry still names who switched it on.
 */
async function formOwnerUserId(tx: Tx, eventId: string, actor: ScopedToggleActor | null): Promise<string | null> {
  if (actor?.kind === "staff") return actor.userId;
  const admin = await tx.eventMembership.findFirst({ where: { eventId, role: "EVENT_ADMIN", status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { userId: true } });
  if (admin) return admin.userId;
  const sysadmin = await tx.user.findFirst({ where: { globalRole: "SYSTEM_ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return sysadmin?.id ?? null;
}

/**
 * Makes the event's debrief (or evaluation) form if it has none: a published, open, sign-in-only information form marked
 * with its purpose. The questions are the source event's published ones when this event is a copy of one that had a debrief
 * (staff's edits carry forward), else the starter questions. Safe to repeat.
 */
export async function ensureDebriefForm(tx: Tx, input: { eventId: string; purpose: DebriefFormPurpose; actor: ScopedToggleActor | null }): Promise<string | null> {
  const existing = await tx.informationForm.findFirst({ where: { eventId: input.eventId, purpose: input.purpose }, select: { id: true } });
  if (existing) return existing.id;
  const event = await tx.event.findUnique({ where: { id: input.eventId }, select: { name: true, debrief: { select: { carriedFromEventId: true } } } });
  if (!event) return null;
  const ownerId = await formOwnerUserId(tx, input.eventId, input.actor);
  if (!ownerId) return null;
  let definition = parseInformationFormDefinition(starterDefinition(input.purpose, event.name));
  const sourceEventId = event.debrief?.carriedFromEventId;
  if (sourceEventId) {
    const source = await tx.informationFormVersion.findFirst({
      where: { status: "PUBLISHED", form: { eventId: sourceEventId, purpose: input.purpose } },
      select: { definition: true },
    });
    if (source) {
      try {
        const carried = parseInformationFormDefinition(source.definition);
        definition = { ...carried, title: DEBRIEF_FORM_TITLES[input.purpose], description: starterDefinition(input.purpose, event.name).description };
      } catch {
        // A stored definition that no longer parses is not copied; the starter questions stand.
      }
    }
  }
  const taken = await tx.informationForm.findUnique({ where: { scopeKey_slug: { scopeKey: input.eventId, slug: DEBRIEF_FORM_SLUGS[input.purpose] } }, select: { id: true } });
  const slug = taken ? `${DEBRIEF_FORM_SLUGS[input.purpose]}-event` : DEBRIEF_FORM_SLUGS[input.purpose];
  const form = await tx.informationForm.create({
    data: {
      scope: "EVENT",
      eventId: input.eventId,
      scopeKey: input.eventId,
      name: DEBRIEF_FORM_TITLES[input.purpose],
      slug,
      status: "OPEN",
      fillAccess: "SIGNED_IN",
      purpose: input.purpose,
      createdByUserId: ownerId,
      versions: { create: { createdByUserId: ownerId, versionNumber: 1, status: "PUBLISHED", publishedAt: new Date(), definition: definition as Prisma.InputJsonValue } },
    },
    select: { id: true },
  });
  await audit(tx, input.actor, input.eventId, "EVENT_DEBRIEF_FORM_CREATED", `Made the ${DEBRIEF_FORM_TITLES[input.purpose].toLowerCase()} form with its starter questions.`, { formId: form.id, purpose: input.purpose });
  return form.id;
}

type EventTiming = { id: string; timezone: string; endsAt: Date };

async function loadTiming(client: Client, eventId: string): Promise<EventTiming | null> {
  return client.event.findUnique({ where: { id: eventId }, select: { id: true, timezone: true, endsAt: true } });
}

/** The columns a debrief batch is stored with, from a projection. Everything an approval would hold, with no person's approval to wait for. */
function batchColumns(kind: DebriefBatchKind, projection: ReturnType<typeof debriefSchedule>["invite"]) {
  return {
    name: DEBRIEF_BATCH_NAMES[kind],
    templateKey: DEBRIEF_BATCH_TEMPLATE_KEYS[kind],
    trigger: "AFTER_EVENT_END" as const,
    localDate: null,
    localTime: DEBRIEF_SEND_LOCAL_TIME,
    daysBefore: kind === "INVITE" ? DEBRIEF_INVITE_DAYS_AFTER : DEBRIEF_REMINDER_DAYS_AFTER,
    eventTimezone: projection.eventTimezone,
    anchorAt: projection.anchorAt,
    sendAt: projection.sendAt,
    dstBehavior: projection.dstBehavior,
    dstNote: projection.dstNote,
  };
}

/**
 * Creates the invitation and the reminder as ACTIVE scheduled email batches (switching the module on is the human approval),
 * visible in the event's scheduled email list. A batch whose time has already passed is not created. A batch that was
 * cancelled by switching off and has not been sent is given its time again. Sent, failed and finished batches are never
 * touched, so switching on twice cannot send twice.
 */
export async function createDebriefBatches(tx: Tx, input: { eventId: string; actor: ScopedToggleActor | null; now: Date }): Promise<{ created: DebriefBatchKind[]; skipped: DebriefBatchKind[] }> {
  const result = { created: [] as DebriefBatchKind[], skipped: [] as DebriefBatchKind[] };
  const event = await loadTiming(tx, input.eventId);
  if (!event) return result;
  let schedule: ReturnType<typeof debriefSchedule>;
  try {
    schedule = debriefSchedule(event);
  } catch (error) {
    if (error instanceof ScheduleProjectionError) return { created: [], skipped: [...batchKinds] };
    throw error;
  }
  const who = input.actor?.kind === "staff"
    ? { createdByUserId: input.actor.userId, activatedByUserId: input.actor.userId }
    : input.actor ? { createdByAttendeeAccountId: input.actor.accountId, activatedByAttendeeAccountId: input.actor.accountId } : {};
  for (const kind of batchKinds) {
    const projection = kind === "INVITE" ? schedule.invite : schedule.reminder;
    const id = debriefBatchId(input.eventId, kind);
    if (projection.sendAt.getTime() < input.now.getTime() + SCHEDULED_EMAIL_MIN_LEAD_MS) {
      result.skipped.push(kind);
      continue;
    }
    const columns = batchColumns(kind, projection);
    const existing = await tx.scheduledEmailBatch.findUnique({ where: { id }, select: { status: true, claimToken: true } });
    if (existing) {
      // Sent, being sent or failed: left exactly as it is. Only a stopped, unsent one is given its time again.
      if (existing.claimToken || existing.status === "COMPLETED" || existing.status === "FAILED") continue;
      await tx.scheduledEmailBatch.update({
        where: { id },
        data: { ...columns, status: "ACTIVE", activatedAt: input.now, activatedByUserId: input.actor?.kind === "staff" ? input.actor.userId : null, activatedByAttendeeAccountId: input.actor?.kind === "area-coordinator" ? input.actor.accountId : null, cancelledAt: null, cancelledByUserId: null, pausedAt: null, pauseReason: null, revision: { increment: 1 } },
      });
    } else {
      await tx.scheduledEmailBatch.create({
        data: {
          id,
          eventId: input.eventId,
          ...columns,
          audienceQuery: { source: "EVENT_DEBRIEF" },
          audienceQueryVersion: "event-debrief-1",
          audienceQueryHash: "event-debrief",
          audienceFingerprint: "event-debrief",
          status: "ACTIVE",
          activatedAt: input.now,
          ...who,
        },
      });
    }
    result.created.push(kind);
  }
  await audit(tx, input.actor, input.eventId, "EVENT_DEBRIEF_SCHEDULED", "Scheduled the debrief invitation and reminder.", { created: result.created, skipped: result.skipped });
  return result;
}

/** Cancels every unsent debrief batch of the event, and the messages still waiting in the queue. Sent messages stay sent. */
export async function cancelDebriefBatches(tx: Tx, input: { eventId: string; actor: ScopedToggleActor | null; now: Date }): Promise<number> {
  const ids = batchKinds.map((kind) => debriefBatchId(input.eventId, kind));
  const stopped = await tx.scheduledEmailBatch.updateMany({
    where: { id: { in: ids }, status: { in: ["SCHEDULED", "ACTIVE", "PAUSED"] } },
    data: {
      status: "CANCELLED",
      cancelledAt: input.now,
      ...(input.actor?.kind === "staff" ? { cancelledByUserId: input.actor.userId } : {}),
    },
  });
  if (stopped.count > 0) {
    await tx.messageOutbox.updateMany({
      where: { eventId: input.eventId, status: "PENDING", OR: ids.map((id) => ({ metadata: { path: ["debriefBatchId"], equals: id } })) },
      data: { status: "CANCELLED", lockedAt: null, lockToken: null, lastError: "The debrief was switched off before this was sent." },
    });
  }
  return stopped.count;
}

/** Everything that follows the module being switched on. Repeating it changes nothing. */
export async function onDebriefEnabled(tx: Tx, input: { eventId: string; actor: ScopedToggleActor | null; now?: Date }) {
  const now = input.now ?? new Date();
  await tx.eventDebrief.upsert({ where: { eventId: input.eventId }, create: { eventId: input.eventId }, update: {} });
  await ensureDebriefForm(tx, { eventId: input.eventId, purpose: "DEBRIEF", actor: input.actor });
  const settings = await tx.eventDebrief.findUnique({ where: { eventId: input.eventId }, select: { evaluationEnabled: true } });
  if (settings?.evaluationEnabled) await ensureDebriefForm(tx, { eventId: input.eventId, purpose: "DIRECTOR_EVALUATION", actor: input.actor });
  return createDebriefBatches(tx, { eventId: input.eventId, actor: input.actor, now });
}

/** Everything that follows the module being switched off: unsent batches stop. The forms and answers are kept. */
export async function onDebriefDisabled(tx: Tx, input: { eventId: string; actor: ScopedToggleActor | null; now?: Date }) {
  const cancelled = await cancelDebriefBatches(tx, { eventId: input.eventId, actor: input.actor, now: input.now ?? new Date() });
  await audit(tx, input.actor, input.eventId, "EVENT_DEBRIEF_UNSCHEDULED", "Stopped the unsent debrief emails. The questions and answers are kept.", { cancelledBatches: cancelled });
  return cancelled;
}

/**
 * Moves the unsent debrief batches to the times the event's dates and zone give now, so a changed end date moves the send
 * with it. A batch already being sent, sent or failed is left alone. Run inside the transaction that saves the event.
 */
export async function reprojectDebriefBatches(tx: Tx, eventId: string): Promise<number> {
  const ids = batchKinds.map((kind) => debriefBatchId(eventId, kind));
  const open = await tx.scheduledEmailBatch.findMany({ where: { id: { in: ids }, status: { in: ["SCHEDULED", "ACTIVE", "PAUSED"] }, claimToken: null }, select: { id: true } });
  if (open.length === 0) return 0;
  const event = await loadTiming(tx, eventId);
  if (!event) return 0;
  let schedule: ReturnType<typeof debriefSchedule>;
  try {
    schedule = debriefSchedule(event);
  } catch {
    return 0;
  }
  let moved = 0;
  for (const kind of batchKinds) {
    const id = debriefBatchId(eventId, kind);
    if (!open.some((row) => row.id === id)) continue;
    const projection = kind === "INVITE" ? schedule.invite : schedule.reminder;
    const changed = await tx.scheduledEmailBatch.updateMany({
      where: { id, claimToken: null, OR: [{ sendAt: { not: projection.sendAt } }, { eventTimezone: { not: projection.eventTimezone } }] },
      data: { ...batchColumns(kind, projection), revision: { increment: 1 } },
    });
    moved += changed.count;
  }
  return moved;
}

/**
 * For an event created with the Debrief already chosen on the features step: gives it the questions and the schedule the same
 * way switching it on later would. Nothing to do when the Debrief was not chosen.
 */
export async function afterCreationModules(tx: Tx, input: { eventId: string; moduleKeys: readonly string[]; actorUserId: string }) {
  if (!input.moduleKeys.includes(DEBRIEF_MODULE_KEY)) return;
  await onDebriefEnabled(tx, { eventId: input.eventId, actor: { kind: "staff", userId: input.actorUserId } });
}

/**
 * When an event is copied for next year (#1679): the copy remembers which event it came from, so its Debrief page shows that
 * event's answers read only, and keeps the director evaluation switch as the source had it. The copy's module row has already
 * been written by the clone's module rule (on or off as the source was); when it is on, the copy gets its form (built from the
 * source's published questions) and its own schedule from its own dates. Answers are never copied, and nothing is carried
 * from an event that never had a debrief.
 */
export async function copyDebriefSetup(tx: Tx, input: { sourceEventId: string; targetEventId: string; actorUserId: string; now?: Date }) {
  const [source, sourceForm] = await Promise.all([
    tx.eventDebrief.findUnique({ where: { eventId: input.sourceEventId }, select: { evaluationEnabled: true } }),
    tx.informationForm.findFirst({ where: { eventId: input.sourceEventId, purpose: { not: null } }, select: { id: true } }),
  ]);
  if (!source && !sourceForm) return false;
  await tx.eventDebrief.upsert({
    where: { eventId: input.targetEventId },
    create: { eventId: input.targetEventId, evaluationEnabled: source?.evaluationEnabled ?? false, carriedFromEventId: input.sourceEventId },
    update: { carriedFromEventId: input.sourceEventId },
  });
  const moduleRow = await tx.eventModule.findUnique({ where: { eventId_moduleKey: { eventId: input.targetEventId, moduleKey: DEBRIEF_MODULE_KEY } }, select: { id: true } });
  if (moduleRow) await onDebriefEnabled(tx, { eventId: input.targetEventId, actor: { kind: "staff", userId: input.actorUserId }, now: input.now });
  return true;
}
