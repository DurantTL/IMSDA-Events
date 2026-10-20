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
 * import. Several items can link to one event (#1086). Nothing here ever links on its own, and a date change is only ever
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
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true, startsAt: true, endsAt: true, timezone: true, archivedAt: true } });
  if (!event) throw new CalendarError("EVENT_NOT_FOUND", "That event could not be found.");
  // An archived event can't be linked to (#635): unarchive it first. Checked inside the same transaction as the link.
  if (event.archivedAt) throw new CalendarError("EVENT_ARCHIVED", "That event is archived. Unarchive it before linking a calendar item to it.");
  // Other items may already be linked to this event (#1086): one registration can have several calendar items.
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

/** Link an item to an event that already exists. */
export async function linkCalendarEntryToEvent(entryId: string, eventId: string, actorUserId: string) {
  await getPrisma().$transaction((tx) => linkInTransaction(tx, entryId, eventId, actorUserId, "existing"));
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
  const entry = await linkInTransaction(tx, input.entryId, input.eventId, input.actorUserId, "created");
  const description = entry.description.trim();
  if (description) {
    const last = await tx.eventContentSection.aggregate({ where: { eventId: input.eventId }, _max: { position: true } });
    await tx.eventContentSection.create({
      data: { eventId: input.eventId, kind: "RICH_TEXT", title: "About this event", body: description, position: (last._max.position ?? -1) + 1, isPublished: false },
    });
  }
  return { location: entry.location.trim() || null };
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
  entryTitle: string;
  message: string;
  itemStartsOn: string;
  itemEndsOn: string;
  eventStartsOn: string;
  eventEndsOn: string;
  /** "Update the event's dates from this item" is offered only when exactly one item is linked (#1086). */
  canUpdate: boolean;
  /** Null when `canUpdate` is false: with several items the banner is informational and previews nothing. */
  preview: DatePreview | null;
  pricingNote: string;
};

export type CalendarLinkedItem = { id: string; title: string; startsOn: string; endsOn: string };

export type CalendarLinkNotice = {
  /** Every calendar item linked to the event, by date. Shown as a list when there are several. */
  linkedItems: CalendarLinkedItem[];
  /** One question per linked item whose dates need a decision. */
  datePrompts: CalendarDatePrompt[];
  /** Titles of linked items that are gone from Google. The event is untouched; staff decide what to do. */
  sourceRemoved: string[];
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
      select: { startsAt: true, endsAt: true, timezone: true, registrationOpensOn: true, registrationClosesOn: true, seminarPreferenceClosesOn: true, archivedAt: true },
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
    isArchived: event.archivedAt !== null,
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
 * What the event's page shows about its linked calendar items (#445, #1086): a
 * banner per item whose dates moved, and a warning for each item that left
 * Google. With exactly one item the banner can update the event's dates; with
 * several it only informs, because no one item owns the event's dates. Null
 * when nothing needs attention (or no item is linked).
 */
export async function getCalendarLinkNotice(eventId: string): Promise<CalendarLinkNotice | null> {
  const prisma = getPrisma();
  const entries = await prisma.calendarEntry.findMany({ where: { linkedEventId: eventId }, orderBy: [{ startsOn: "asc" }, { title: "asc" }, { id: "asc" }] });
  if (entries.length === 0) return null;
  const event = await previewInputs(prisma, eventId);
  // An archived event (#635) is read-only history: no banner and no warning, so nothing invites a change to it.
  if (!event || event.isArchived) return null;
  const single = entries.length === 1;
  const datePrompts: CalendarDatePrompt[] = [];
  const sourceRemoved: string[] = [];
  for (const entry of entries) {
    if (entry.sourceRemovedAt !== null) sourceRemoved.push(entry.title);
    const needsDecision = datesNeedDecision({
      itemStartsOn: entry.startsOn,
      itemEndsOn: entry.endsOn,
      eventStartsOn: event.startsOn,
      eventEndsOn: event.endsOn,
      baselineStartsOn: entry.baselineStartsOn,
      baselineEndsOn: entry.baselineEndsOn,
    });
    // A removed item's dates are stale; asking staff to adopt them would be asking about a ghost.
    if (!needsDecision || entry.sourceRemovedAt !== null) continue;
    datePrompts.push({
      entryId: entry.id,
      entryTitle: entry.title,
      message: single
        ? datePromptMessage({
          imported: entry.sourceUid !== null,
          kind: datePromptKind({ baselineStartsOn: entry.baselineStartsOn, baselineEndsOn: entry.baselineEndsOn }),
          itemStartsOn: entry.startsOn,
          itemEndsOn: entry.endsOn,
        })
        : "This item's dates differ from the event's.",
      itemStartsOn: entry.startsOn,
      itemEndsOn: entry.endsOn,
      eventStartsOn: event.startsOn,
      eventEndsOn: event.endsOn,
      canUpdate: single,
      preview: single ? buildDatePreview(event, { startsOn: entry.startsOn, endsOn: entry.endsOn }) : null,
      pricingNote: pricingDeadlineNote,
    });
  }
  if (datePrompts.length === 0 && sourceRemoved.length === 0) return null;
  return {
    linkedItems: entries.map((entry) => ({ id: entry.id, title: entry.title, startsOn: entry.startsOn, endsOn: entry.endsOn })),
    datePrompts,
    sourceRemoved,
  };
}

/**
 * Staff's answer to the banner, for one linked item (`entryId`; optional only
 * when exactly one item is linked). Update is refused unless exactly one item is
 * linked (#1086): with several, no single item owns the event's dates, and Keep
 * is the only answer. `expected` is the item's dates the staff member
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
  entryId?: string,
) {
  await getPrisma().$transaction(async (tx) => {
    const linked = await tx.calendarEntry.findMany({ where: { linkedEventId: eventId }, select: { id: true, sourceFeedId: true } });
    if (linked.length === 0) throw new CalendarError("NOT_LINKED", "No calendar item is linked to this event.");
    if (!entryId && linked.length > 1) throw new CalendarError("ENTRY_REQUIRED", "Choose which calendar item you are answering about.");
    const found = entryId ? linked.find((row) => row.id === entryId) : linked[0];
    if (!found) throw new CalendarError("NOT_LINKED", "That calendar item isn't linked to this event.");
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
    // Neither answer applies to an archived event (#635), read under the same lock as the dates.
    if (event.isArchived) throw new CalendarError("EVENT_ARCHIVED", "That event is archived, so its dates can't be changed. Unarchive it first.");
    if (decision === "update") {
      // Counted under the event's lock, so the answer matches what the staff member's page offered.
      const linkedCount = await tx.calendarEntry.count({ where: { linkedEventId: eventId } });
      if (linkedCount !== 1) {
        throw new CalendarError("UPDATE_NEEDS_SINGLE_LINK", "Several calendar items are linked to this event, so none of them can set its dates. Change the event's dates in its settings, or choose Keep.");
      }
    }
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
