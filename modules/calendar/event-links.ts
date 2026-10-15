import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { calendarDateIn } from "@/modules/calendar/domain";
import {
  buildDatePreview,
  datePromptKind,
  datePromptMessage,
  datesNeedDecision,
  pricingDeadlineNote,
  type DateDecision,
  type DatePreview,
} from "@/modules/calendar/event-dates";
import { entryCanBeLinked } from "@/modules/calendar/event-match";
import { CalendarError } from "@/modules/calendar/errors";
import { feedLockKey } from "@/modules/calendar/feed-plan";

/**
 * Calendar items and registration events are one thing (#445). A link is the
 * item's `linkedEventId`: a feed refresh never writes it, so it survives every
 * import. Nothing here ever links on its own, and a date change is only ever
 * applied by a staff member's choice. Audit entries carry ids, enums and dates.
 */

type Tx = Prisma.TransactionClient;

function eventDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

const isoDay = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

async function lockEntry(tx: Tx, entryId: string) {
  await tx.$queryRaw`SELECT "id" FROM "CalendarEntry" WHERE "id" = ${entryId} FOR UPDATE`;
  const entry = await tx.calendarEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new CalendarError("ENTRY_NOT_FOUND", "That calendar item could not be found.");
  return entry;
}

/** Why an item can't stand in for an event, or null. */
function linkProblem(entry: { entryType: "STANDARD" | "CLOSURE" | "DEADLINE"; repeatRule: string | null }) {
  return entryCanBeLinked({ entryType: entry.entryType, hasRepeat: entry.repeatRule !== null })
    ? null
    : "Only an ordinary one-time calendar item can be linked to a registration event. Closures, deadlines and repeating items can't.";
}

/** Links inside the caller's transaction. `how` records whether the event was made from the item or already existed. */
async function linkInTransaction(tx: Tx, entryId: string, eventId: string, actorUserId: string, how: "created" | "existing") {
  const entry = await lockEntry(tx, entryId);
  const problem = linkProblem(entry);
  if (problem) throw new CalendarError("NOT_LINKABLE", problem);
  if (entry.linkedEventId === eventId) return entry;
  if (entry.linkedEventId) throw new CalendarError("ENTRY_ALREADY_LINKED", "That calendar item is already linked to a registration event. Unlink it first.");
  // TODO(#635): when `Event.archivedAt` lands, an archived event is not linkable here; add `archivedAt: null` to this
  // lookup (whichever of #445 and #635 merges second adds it).
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true, startsAt: true, endsAt: true, timezone: true } });
  if (!event) throw new CalendarError("EVENT_NOT_FOUND", "That event could not be found.");
  const other = await tx.calendarEntry.findUnique({ where: { linkedEventId: eventId }, select: { id: true } });
  if (other) throw new CalendarError("EVENT_ALREADY_LINKED", "That event is already linked to another calendar item. Unlink it first.");
  // The baseline is the item's dates when they agree with the event's. If they already differ, there is no baseline:
  // the event asks about it straight away, and says "differs" rather than "moved".
  const agrees = entry.startsOn === calendarDateIn(event.startsAt, event.timezone) && entry.endsOn === calendarDateIn(event.endsAt, event.timezone);
  const linked = await tx.calendarEntry.update({
    where: { id: entryId },
    data: {
      linkedEventId: eventId,
      linkedAt: new Date(),
      linkedByUserId: actorUserId,
      baselineStartsOn: agrees ? entry.startsOn : null,
      baselineEndsOn: agrees ? entry.endsOn : null,
    },
  });
  // A pair staff once said was not the same is now one they chose to link.
  await tx.calendarEventMatchDismissal.deleteMany({ where: { calendarEntryId: entryId, eventId } });
  await writeAuditLog({
    eventId,
    actorUserId,
    action: "CALENDAR_ENTRY_LINKED_TO_EVENT",
    entityType: "CalendarEntry",
    entityId: entryId,
    summary: how === "created" ? "Set up a registration event from a calendar item." : "Linked a calendar item to a registration event.",
    metadata: { calendarEntryId: entryId, eventId, how },
  }, tx);
  return linked;
}

function linkConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new CalendarError("EVENT_ALREADY_LINKED", "That event is already linked to another calendar item. Unlink it first.");
  }
  throw error;
}

/** Link an item to an event that already exists. */
export async function linkCalendarEntryToEvent(entryId: string, eventId: string, actorUserId: string) {
  try {
    await getPrisma().$transaction((tx) => linkInTransaction(tx, entryId, eventId, actorUserId, "existing"));
  } catch (error) {
    linkConflict(error);
  }
}

/** Unlink: the item shows on its own again, and nothing else about it or the event changes. */
export async function unlinkCalendarEntry(entryId: string, actorUserId: string) {
  await getPrisma().$transaction(async (tx) => {
    const entry = await lockEntry(tx, entryId);
    if (!entry.linkedEventId) throw new CalendarError("NOT_LINKED", "That calendar item isn't linked to an event.");
    await tx.calendarEntry.update({
      where: { id: entryId },
      data: { linkedEventId: null, linkedAt: null, linkedByUserId: null, baselineStartsOn: null, baselineEndsOn: null },
    });
    await writeAuditLog({
      eventId: entry.linkedEventId,
      actorUserId,
      action: "CALENDAR_ENTRY_UNLINKED_FROM_EVENT",
      entityType: "CalendarEntry",
      entityId: entryId,
      summary: "Unlinked a calendar item from its registration event.",
      metadata: { calendarEntryId: entryId, eventId: entry.linkedEventId },
    }, tx);
  });
}

/** "Not the same": this pair is never suggested again. Permanent. */
export async function dismissPossibleMatch(entryId: string, eventId: string, actorUserId: string) {
  await getPrisma().$transaction(async (tx) => {
    const [entry, event] = await Promise.all([
      tx.calendarEntry.findUnique({ where: { id: entryId }, select: { id: true } }),
      tx.event.findUnique({ where: { id: eventId }, select: { id: true } }),
    ]);
    if (!entry) throw new CalendarError("ENTRY_NOT_FOUND", "That calendar item could not be found.");
    if (!event) throw new CalendarError("EVENT_NOT_FOUND", "That event could not be found.");
    const existing = await tx.calendarEventMatchDismissal.findUnique({ where: { calendarEntryId_eventId: { calendarEntryId: entryId, eventId } } });
    if (existing) return;
    await tx.calendarEventMatchDismissal.create({ data: { calendarEntryId: entryId, eventId, dismissedByUserId: actorUserId } });
    await writeAuditLog({
      eventId,
      actorUserId,
      action: "CALENDAR_MATCH_DISMISSED",
      entityType: "CalendarEntry",
      entityId: entryId,
      summary: "Marked a calendar item and a registration event as not the same.",
      metadata: { calendarEntryId: entryId, eventId },
    }, tx);
  });
}

export type CalendarEntryPrefill = {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string;
  location: string;
  description: string;
};

/**
 * What the Create event flow starts from when it is opened from a calendar item
 * (#445), or why it can't be: the item is gone, is the wrong kind, or already
 * has an event.
 */
export async function getCalendarEntryPrefill(entryId: string): Promise<
  { ok: true; entry: CalendarEntryPrefill } | { ok: false; reason: string }
> {
  const entry = await getPrisma().calendarEntry.findUnique({ where: { id: entryId } });
  if (!entry) return { ok: false, reason: "That calendar item could not be found." };
  const problem = linkProblem(entry);
  if (problem) return { ok: false, reason: problem };
  if (entry.linkedEventId) return { ok: false, reason: "That calendar item already has a registration event." };
  return { ok: true, entry: { id: entry.id, title: entry.title, startsOn: entry.startsOn, endsOn: entry.endsOn, location: entry.location, description: entry.description } };
}

/**
 * Called by the Create event flows inside the transaction that creates the
 * event: links the item and carries its description into a draft "About this
 * event" section (unpublished, plain text). If the item is no longer eligible
 * the whole creation rolls back, so an event is never made half-linked.
 * Returns the item's location, for a flow that doesn't take one from a form.
 */
export async function linkNewEventToCalendarEntry(tx: Tx, input: { entryId: string; eventId: string; actorUserId: string }) {
  try {
    const entry = await linkInTransaction(tx, input.entryId, input.eventId, input.actorUserId, "created");
    const description = entry.description.trim();
    if (description) {
      const last = await tx.eventContentSection.aggregate({ where: { eventId: input.eventId }, _max: { position: true } });
      await tx.eventContentSection.create({
        data: { eventId: input.eventId, kind: "RICH_TEXT", title: "About this event", body: description, position: (last._max.position ?? -1) + 1, isPublished: false },
      });
    }
    return { location: entry.location.trim() || null };
  } catch (error) {
    return linkConflict(error);
  }
}

/** Whether an item can still be linked, read inside a creation transaction before the event is written. */
export async function assertCalendarEntryLinkable(tx: Tx, entryId: string) {
  const entry = await tx.calendarEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new CalendarError("ENTRY_NOT_FOUND", "That calendar item could not be found.");
  const problem = linkProblem(entry);
  if (problem) throw new CalendarError("NOT_LINKABLE", problem);
  if (entry.linkedEventId) throw new CalendarError("ENTRY_ALREADY_LINKED", "That calendar item already has a registration event.");
  return { location: entry.location.trim() || null };
}

export type CalendarDatePrompt = {
  entryId: string;
  message: string;
  itemStartsOn: string;
  itemEndsOn: string;
  eventStartsOn: string;
  eventEndsOn: string;
  preview: DatePreview;
  pricingNote: string;
};

export type CalendarLinkNotice = {
  /** Set when the date question is open. */
  datePrompt: CalendarDatePrompt | null;
  /** The item is gone from Google. The event is untouched; staff decide what to do. */
  sourceRemoved: boolean;
};

/** The last window ends of the current cancellation policy, read without trusting the stored JSON's exact shape. */
export function cancellationWindowsOf(rules: unknown): Array<{ label: string; endsOn: string }> {
  const windows = (rules as { windows?: unknown } | null)?.windows;
  if (!Array.isArray(windows)) return [];
  return windows.flatMap((window) => {
    const { label, endsOn } = (window ?? {}) as { label?: unknown; endsOn?: unknown };
    return typeof endsOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(endsOn) ? [{ label: typeof label === "string" ? label : "Window", endsOn }] : [];
  });
}

async function previewInputs(db: Tx | ReturnType<typeof getPrisma>, eventId: string) {
  const [event, locations, lodging, meals, policy, registrationCount] = await Promise.all([
    db.event.findUnique({
      where: { id: eventId },
      select: { startsAt: true, endsAt: true, timezone: true, registrationOpensOn: true, registrationClosesOn: true, seminarPreferenceClosesOn: true },
    }),
    db.eventLocation.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" }, select: { name: true, firstDay: true, lastDay: true, registrationClosesOn: true } }),
    db.eventLodging.findUnique({ where: { eventId }, select: { firstNight: true, lastNight: true, preferencesDeadline: true } }),
    db.eventMealService.findMany({ where: { eventId, status: "ACTIVE" }, select: { serviceDate: true } }),
    db.eventCancellationPolicyVersion.findFirst({ where: { eventId }, orderBy: { version: "desc" }, select: { rules: true } }),
    db.registration.count({ where: { eventId, status: { in: ["SUBMITTED", "CONFIRMED", "WAITLISTED"] } } }),
  ]);
  if (!event) return null;
  return {
    mealServiceDates: meals.map((meal) => meal.serviceDate),
    cancellationWindows: cancellationWindowsOf(policy?.rules),
    registrationCount,
    startsOn: calendarDateIn(event.startsAt, event.timezone),
    endsOn: calendarDateIn(event.endsAt, event.timezone),
    registrationOpensOn: event.registrationOpensOn,
    registrationClosesOn: event.registrationClosesOn,
    seminarPreferenceClosesOn: event.seminarPreferenceClosesOn,
    locations,
    lodging: lodging ? { firstNight: isoDay(lodging.firstNight), lastNight: isoDay(lodging.lastNight), preferencesDeadline: isoDay(lodging.preferencesDeadline) } : null,
  };
}

/**
 * What the event's page shows about its linked calendar item (#445): a banner
 * when the item's dates moved, and a warning when the item left Google. Null
 * when nothing needs attention (or no item is linked).
 */
export async function getCalendarLinkNotice(eventId: string): Promise<CalendarLinkNotice | null> {
  const prisma = getPrisma();
  const entry = await prisma.calendarEntry.findUnique({ where: { linkedEventId: eventId } });
  if (!entry) return null;
  const event = await previewInputs(prisma, eventId);
  if (!event) return null;
  const sourceRemoved = entry.sourceRemovedAt !== null;
  const needsDecision = datesNeedDecision({
    itemStartsOn: entry.startsOn,
    itemEndsOn: entry.endsOn,
    eventStartsOn: event.startsOn,
    eventEndsOn: event.endsOn,
    baselineStartsOn: entry.baselineStartsOn,
    baselineEndsOn: entry.baselineEndsOn,
  });
  // A removed item's dates are stale; asking staff to adopt them would be asking about a ghost.
  const datePrompt: CalendarDatePrompt | null = needsDecision && !sourceRemoved
    ? {
      entryId: entry.id,
      message: datePromptMessage({
        imported: entry.sourceUid !== null,
        kind: datePromptKind({ baselineStartsOn: entry.baselineStartsOn, baselineEndsOn: entry.baselineEndsOn }),
        itemStartsOn: entry.startsOn,
        itemEndsOn: entry.endsOn,
      }),
      itemStartsOn: entry.startsOn,
      itemEndsOn: entry.endsOn,
      eventStartsOn: event.startsOn,
      eventEndsOn: event.endsOn,
      preview: buildDatePreview(event, { startsOn: entry.startsOn, endsOn: entry.endsOn }),
      pricingNote: pricingDeadlineNote,
    }
    : null;
  if (!datePrompt && !sourceRemoved) return null;
  return { datePrompt, sourceRemoved };
}

/**
 * Staff's answer to the banner. `expected` is the item's dates the staff member
 * saw: if Google moved them again meanwhile, nothing is applied and they decide
 * again. Update changes the event's first and last day only (see
 * `buildDatePreview`); Keep remembers these item dates so the banner stays away
 * until the item moves again. Both are audited.
 */
export async function resolveCalendarDateChange(
  eventId: string,
  decision: DateDecision,
  expected: { startsOn: string; endsOn: string },
  actorUserId: string,
) {
  await getPrisma().$transaction(async (tx) => {
    const found = await tx.calendarEntry.findUnique({ where: { linkedEventId: eventId }, select: { id: true, sourceFeedId: true } });
    if (!found) throw new CalendarError("NOT_LINKED", "No calendar item is linked to this event.");
    // Wait out a refresh of the item's feed, then read again, so we never act on dates a refresh is about to change.
    if (found.sourceFeedId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${feedLockKey(found.sourceFeedId)}))`;
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR NO KEY UPDATE`;
    const entry = await lockEntry(tx, found.id);
    if (entry.linkedEventId !== eventId) throw new CalendarError("NOT_LINKED", "No calendar item is linked to this event.");
    if (entry.startsOn !== expected.startsOn || entry.endsOn !== expected.endsOn) {
      throw new CalendarError("DATES_CHANGED", "The calendar item's dates changed again while you were looking. Reload the event to see the new dates.");
    }
    const event = await previewInputs(tx, eventId);
    if (!event) throw new CalendarError("EVENT_NOT_FOUND", "That event could not be found.");
    if (decision === "keep") {
      await tx.calendarEntry.update({ where: { id: entry.id }, data: { baselineStartsOn: entry.startsOn, baselineEndsOn: entry.endsOn } });
      await writeAuditLog({
        eventId,
        actorUserId,
        action: "CALENDAR_EVENT_DATES_KEPT",
        entityType: "Event",
        entityId: eventId,
        summary: "Kept the registration event's dates when its calendar item moved.",
        metadata: { calendarEntryId: entry.id, eventId, decision, itemStartsOn: entry.startsOn, itemEndsOn: entry.endsOn, eventStartsOn: event.startsOn, eventEndsOn: event.endsOn },
      }, tx);
      return;
    }
    const preview = buildDatePreview(event, { startsOn: entry.startsOn, endsOn: entry.endsOn });
    if (preview.blockedReason) throw new CalendarError("DATES_CONFLICT", preview.blockedReason);
    await tx.event.update({ where: { id: eventId }, data: { startsAt: eventDate(entry.startsOn), endsAt: eventDate(entry.endsOn) } });
    await tx.calendarEntry.update({ where: { id: entry.id }, data: { baselineStartsOn: entry.startsOn, baselineEndsOn: entry.endsOn } });
    await writeAuditLog({
      eventId,
      actorUserId,
      action: "CALENDAR_EVENT_DATES_UPDATED",
      entityType: "Event",
      entityId: eventId,
      summary: "Updated the registration event's dates to match its calendar item.",
      metadata: { calendarEntryId: entry.id, eventId, decision, from: { startsOn: event.startsOn, endsOn: event.endsOn }, to: { startsOn: entry.startsOn, endsOn: entry.endsOn } },
    }, tx);
  }, { timeout: 30_000, maxWait: 10_000 });
}
