import "server-only";

import { logError } from "@/lib/logger";
import { CalendarError } from "@/modules/calendar/errors";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { calendarEntryListLimit, planBulkAction, type BulkAction, type BulkChange, type BulkSkip } from "@/modules/calendar/admin-list";
import {
  addDays,
  calendarDateIn,
  eventTimeLabel,
  sortCalendarItems,
  type CalendarItem,
} from "@/modules/calendar/domain";
import { dismissalKey, entryCanBeLinked, findPossibleMatches } from "@/modules/calendar/event-match";
import { entryTypeEditMark } from "@/modules/calendar/deadlines";
import { reconcileDeadlineReminders } from "@/modules/calendar/deadline-reminders";
import { feedLockKey } from "@/modules/calendar/feed-plan";
import { importedFieldNames } from "@/modules/calendar/ics-import";
import { expandOccurrences, parseRepeatRule, repeatStartProblem, serializeRepeatRule } from "@/modules/calendar/recurrence";
import type { CalendarBulkRequest, CalendarEntryInput, CalendarEntryUpdate, CalendarEventSettings, CalendarRepeatInput } from "@/modules/calendar/schemas";
import { evaluateEventRegistrationPhase } from "@/modules/events/lifecycle";

export { CalendarError };

const publicEventSelect = {
  id: true,
  slug: true,
  name: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  location: true,
  calendarCategory: true,
  isPublished: true,
  archivedAt: true,
  registrationOpensOn: true,
  registrationClosesOn: true,
  waitlistEnabled: true,
} as const;

/**
 * What anyone may see: published events an administrator hasn't hidden, and
 * published entries. Nothing else is ever read here, so nothing else can leak
 * into the page, the feed, or search engines.
 */
export async function listPublicCalendarItems(
  from: string,
  to: string,
  now = new Date(),
  options: { expandRepeats?: boolean } = {},
): Promise<CalendarItem[]> {
  const expandRepeats = options.expandRepeats ?? true;
  const prisma = getPrisma();
  // Widen by a day each side so an event's own time zone can't push it out of range.
  const [events, entries] = await Promise.all([
    prisma.event.findMany({
      where: {
        isPublished: true,
        archivedAt: null,
        showOnCalendar: true,
        startsAt: { lt: new Date(`${addDays(to, 2)}T00:00:00Z`) },
        endsAt: { gte: new Date(`${addDays(from, -1)}T00:00:00Z`) },
      },
      select: publicEventSelect,
    }),
    prisma.calendarEntry.findMany({
      // A repeating entry can reach into the window from long before it, so
      // only its first date is bounded here; its occurrences are cut below.
      // Imported items staff hid, or that left their feed, never show. A Deadline (#910) is for clubs only, never public.
      where: {
        entryType: { not: "DEADLINE" },
        isPublished: true,
        isHiddenLocally: false,
        sourceRemovedAt: null,
        startsOn: { lte: to },
        OR: [{ endsOn: { gte: from } }, { repeatRule: { not: null } }],
      },
    }),
  ]);

  // A linked pair shows once (#445): the event's own entry, with Register. The item stands in for its event only while
  // the event is not published (a draft set up from it, or unpublished), and says nothing about the event then. A
  // published event that staff hid from the calendar stays off it, and so does its item. A deleted event unlinks the
  // item (the link is cleared with it), which then shows on its own.
  const linkedEventIds = [...new Set(entries.flatMap((entry) => (entry.linkedEventId ? [entry.linkedEventId] : [])))];
  const publishedLinked = linkedEventIds.length === 0
    ? new Set<string>()
    : new Set((await prisma.event.findMany({
      // An archived event is off the public calendar (#635), so it doesn't hide its item: the item shows on its own.
      where: { id: { in: linkedEventIds }, isPublished: true, archivedAt: null },
      select: { id: true },
    })).map((event) => event.id));
  const standalone = entries.filter((entry) => !entry.linkedEventId || !publishedLinked.has(entry.linkedEventId));

  const items: CalendarItem[] = [
    ...events.map((event) => ({
      key: `event-${event.id}`,
      kind: "EVENT" as const,
      title: event.name,
      description: "",
      startsOn: calendarDateIn(event.startsAt, event.timezone),
      endsOn: calendarDateIn(event.endsAt, event.timezone),
      timeLabel: eventTimeLabel(event.startsAt, event.endsAt, event.timezone),
      location: event.location ?? "",
      category: event.calendarCategory ?? "",
      href: `/events/${encodeURIComponent(event.slug)}`,
      status: "SCHEDULED" as const,
      registrationOpen: evaluateEventRegistrationPhase(event, now) === "OPEN",
    })),
    // The query already leaves Deadlines out; this keeps one that slips through (a changed query) off every public surface.
    ...standalone.filter((entry) => entry.entryType !== "DEADLINE").flatMap((entry) => entryItems(entry, from, to, expandRepeats)),
  ];
  return sortCalendarItems(items.filter((item) => item.recurrence || (item.startsOn <= to && item.endsOn >= from)));
}

type PublicEntryRow = {
  id: string;
  title: string;
  description: string;
  startsOn: string;
  endsOn: string;
  timeLabel: string;
  location: string;
  category: string;
  linkUrl: string | null;
  status: CalendarItem["status"];
  entryType: "STANDARD" | "CLOSURE" | "DEADLINE";
  repeatRule: string | null;
  repeatExceptions: string[];
};

/**
 * One entry as calendar items. A repeating entry becomes one item per
 * occurrence in the window (the page), or a single master carrying its
 * RRULE/EXDATEs (the feed, which lets the subscriber's app do the repeating).
 */
function entryItems(entry: PublicEntryRow, from: string, to: string, expandRepeats: boolean): CalendarItem[] {
  const rule = parseRepeatRule(entry.repeatRule);
  const base = {
    kind: "ENTRY" as const,
    title: entry.title,
    description: entry.description,
    timeLabel: entry.timeLabel,
    location: entry.location,
    category: entry.category,
    href: entry.linkUrl,
    status: entry.status,
    registrationOpen: false,
    isClosure: entry.entryType === "CLOSURE",
  };
  if (rule && !expandRepeats) {
    return [{
      ...base,
      key: `entry-${entry.id}`,
      startsOn: entry.startsOn,
      endsOn: entry.endsOn,
      recurrence: { rule: serializeRepeatRule(rule), exceptions: entry.repeatExceptions ?? [] },
    }];
  }
  return expandOccurrences(entry, rule, entry.repeatExceptions ?? [], from, to).map((occurrence) => ({
    ...base,
    key: rule ? `entry-${entry.id}:${occurrence.startsOn}` : `entry-${entry.id}`,
    seriesId: rule ? `entry-${entry.id}` : undefined,
    startsOn: occurrence.startsOn,
    endsOn: occurrence.endsOn,
    recurrence: null,
  }));
}

export type CalendarAdminEntry = Awaited<ReturnType<typeof listCalendarEntries>>[number];

export async function listCalendarEntries(now = new Date()) {
  const prisma = getPrisma();
  const entries = await prisma.calendarEntry.findMany({
    orderBy: [{ startsOn: "desc" }, { title: "asc" }],
    take: calendarEntryListLimit,
    include: {
      sourceFeed: { select: { name: true } },
      linkedEvent: { select: { id: true, name: true, slug: true, isPublished: true, archivedAt: true, showOnCalendar: true, startsAt: true, endsAt: true, timezone: true } },
    },
  });

  // Possible matches (#445): imported items not yet linked, against events from the last month on, minus the pairs
  // staff said are not the same. Staff see drafts here, so a draft event can be matched too.
  const since = calendarDateIn(new Date(now.getTime() - 31 * 86_400_000));
  const candidates = entries.filter((entry) => !entry.linkedEventId && Boolean(entry.sourceUid) && entry.endsOn >= since);
  const [matchEvents, dismissals] = candidates.length === 0
    ? [[], []]
    : await Promise.all([
      prisma.event.findMany({
        // An archived event is not a match candidate (#635). An event already linked to an item is not offered to
        // another (also enforced by the database).
        where: { archivedAt: null, endsAt: { gte: new Date(now.getTime() - 32 * 86_400_000) }, calendarEntryLink: null },
        select: { id: true, name: true, startsAt: true, endsAt: true, timezone: true, isPublished: true },
      }),
      prisma.calendarEventMatchDismissal.findMany({
        where: { calendarEntryId: { in: candidates.map((entry) => entry.id) } },
        select: { calendarEntryId: true, eventId: true },
      }),
    ]);
  const eventsById = new Map(matchEvents.map((event) => [event.id, {
    id: event.id,
    name: event.name,
    startsOn: calendarDateIn(event.startsAt, event.timezone),
    endsOn: calendarDateIn(event.endsAt, event.timezone),
    isPublished: event.isPublished,
  }]));
  const matches = new Map(findPossibleMatches(
    candidates.map((entry) => ({
      id: entry.id,
      title: entry.title,
      startsOn: entry.startsOn,
      endsOn: entry.endsOn,
      entryType: entry.entryType,
      hasRepeat: entry.repeatRule !== null,
      isImported: entry.sourceUid !== null,
      linkedEventId: entry.linkedEventId,
      isHiddenLocally: entry.isHiddenLocally,
      sourceRemoved: entry.sourceRemovedAt !== null,
    })),
    [...eventsById.values()],
    new Set(dismissals.map((row) => dismissalKey(row.calendarEntryId, row.eventId))),
    new Set(entries.flatMap((entry) => (entry.linkedEventId ? [entry.linkedEventId] : []))),
  ).map((match) => [match.entryId, match.eventId]));

  return entries.map((entry) => {
    const linkedEvent = entry.linkedEvent
      ? {
        id: entry.linkedEvent.id,
        name: entry.linkedEvent.name,
        slug: entry.linkedEvent.slug,
        isArchived: Boolean(entry.linkedEvent.archivedAt),
        isPublished: entry.linkedEvent.isPublished,
        showOnCalendar: entry.linkedEvent.showOnCalendar,
        startsOn: calendarDateIn(entry.linkedEvent.startsAt, entry.linkedEvent.timezone),
        endsOn: calendarDateIn(entry.linkedEvent.endsAt, entry.linkedEvent.timezone),
      }
      : null;
    return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
    startsOn: entry.startsOn,
    endsOn: entry.endsOn,
    timeLabel: entry.timeLabel,
    location: entry.location,
    category: entry.category,
    linkUrl: entry.linkUrl,
    status: entry.status,
    entryType: entry.entryType,
    repeat: parseRepeatRule(entry.repeatRule),
    repeatExceptions: entry.repeatExceptions,
    isPublished: entry.isPublished,
    sourceFeedId: entry.sourceFeedId,
    sourceFeedName: entry.sourceFeed?.name ?? null,
    isHiddenLocally: entry.isHiddenLocally,
    sourceRemovedAt: entry.sourceRemovedAt?.toISOString() ?? null,
    locallyEditedFields: entry.locallyEditedFields,
    updatedAt: entry.updatedAt.toISOString(),
    /** Linked, but a refresh or an edit since made it a Deadline, closure or repeating item. Never unlinked automatically. */
    linkedIneligible: entry.linkedEventId !== null && !entryCanBeLinked({ entryType: entry.entryType, hasRepeat: entry.repeatRule !== null }),
    /** An ordinary one-off item: the only kind that can stand in for a registration event (#445). */
    canLinkToEvent: entryCanBeLinked({ entryType: entry.entryType, hasRepeat: entry.repeatRule !== null }),
    linkedEvent,
    /** Linked, and the item's dates are not the event's: the event shows a banner asking staff to choose. */
    datesDifferFromEvent: linkedEvent !== null && (linkedEvent.startsOn !== entry.startsOn || linkedEvent.endsOn !== entry.endsOn),
    possibleMatch: eventsById.get(matches.get(entry.id) ?? "") ?? null,
    };
  });
}

export type CalendarAdminEvent = Awaited<ReturnType<typeof listCalendarEvents>>[number];

/** Events that haven't ended (plus the last month), with whether each shows on the calendar. */
export async function listCalendarEvents(now = new Date()) {
  const events = await getPrisma().event.findMany({
    // An archived event is not offered to link to (#635).
    where: { archivedAt: null, endsAt: { gte: new Date(now.getTime() - 31 * 86_400_000) } },
    orderBy: { startsAt: "asc" },
    select: { ...publicEventSelect, showOnCalendar: true, calendarEntryLink: { select: { id: true, title: true } } },
  });
  return events.map((event) => ({
    id: event.id,
    name: event.name,
    startsOn: calendarDateIn(event.startsAt, event.timezone),
    endsOn: calendarDateIn(event.endsAt, event.timezone),
    isPublished: event.isPublished,
    showOnCalendar: event.showOnCalendar,
    calendarCategory: event.calendarCategory ?? "",
    /** The calendar item linked to this event (#445), when there is one. */
    linkedEntryId: event.calendarEntryLink?.id ?? null,
    linkedEntryTitle: event.calendarEntryLink?.title ?? null,
  }));
}

/** The editor's structured repeat as stored columns; `undefined` leaves the column alone. */
function repeatColumns(input: { repeat?: CalendarRepeatInput | null }) {
  if (input.repeat === undefined) return {};
  return { repeatRule: input.repeat ? serializeRepeatRule(input.repeat) : null };
}

function withoutRepeat<T extends { repeat?: unknown }>(input: T): Omit<T, "repeat"> {
  const fields = { ...input };
  delete fields.repeat;
  return fields;
}

export async function createCalendarEntry(input: CalendarEntryInput, actorUserId: string) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const fields = withoutRepeat(input);
    const entry = await tx.calendarEntry.create({
      data: { ...fields, ...repeatColumns(input), createdByUserId: actorUserId, updatedByUserId: actorUserId },
    });
    await writeAuditLog({
      actorUserId,
      action: "CALENDAR_ENTRY_CREATED",
      entityType: "CalendarEntry",
      entityId: entry.id,
      summary: `Added "${entry.title}" to the calendar${entry.isPublished ? "" : " as a draft"}.`,
      metadata: { startsOn: entry.startsOn, endsOn: entry.endsOn, isPublished: entry.isPublished },
    }, tx);
  });
  await keepRemindersCurrent();
  return listCalendarEntries();
}

/**
 * After a change to the calendar, bring the pending deadline reminder batches in line (#910): a changed date updates
 * its batch, a cancelled, hidden or un-deadlined entry withdraws it. Never lets a calendar edit fail; the sweep does
 * the same every few minutes.
 */
async function keepRemindersCurrent() {
  try {
    await reconcileDeadlineReminders();
  } catch (error) {
    logError("Deadline reminders could not be brought up to date after a calendar change", error);
  }
}

export async function updateCalendarEntry(entryId: string, input: CalendarEntryUpdate, actorUserId: string) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    let existing = await tx.calendarEntry.findUnique({ where: { id: entryId } });
    if (!existing) throw new CalendarError("ENTRY_NOT_FOUND", "That calendar entry could not be found.");
    if (existing.sourceFeedId) {
      // Wait out a refresh of this feed (it holds the same lock), then read again, so a refresh can't overwrite this edit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${feedLockKey(existing.sourceFeedId)}))`;
      existing = await tx.calendarEntry.findUnique({ where: { id: entryId } });
      if (!existing) throw new CalendarError("ENTRY_NOT_FOUND", "That calendar entry could not be found.");
    }
    const fields = withoutRepeat(input);
    const columns = repeatColumns(input);
    // A PATCH may carry only the start date or only the repeat, so check the pair as it will be stored.
    const rule = input.repeat === undefined ? parseRepeatRule(existing.repeatRule) : input.repeat;
    const problem = rule ? repeatStartProblem(rule, input.startsOn ?? existing.startsOn) : null;
    if (problem) throw new CalendarError("INVALID_REPEAT", problem);
    // An imported item remembers which of its imported fields staff changed, so a refresh leaves them alone.
    const edits: Record<string, unknown> = { ...fields, ...columns };
    // A detached item (sourceUid kept) records edits too, so they survive a later re-link.
    const locallyEdited = existing.sourceFeedId || existing.sourceUid
      ? importedFieldNames.filter((name) => name in edits && JSON.stringify(existing[name]) !== JSON.stringify(edits[name]))
      : [];
    // A type staff changed (Deadline on or off, #910) is theirs: a refresh must not move it back.
    const typeChosen = (existing.sourceFeedId || existing.sourceUid) && edits.entryType !== undefined && edits.entryType !== existing.entryType
      ? [entryTypeEditMark]
      : [];
    const locallyEditedFields = locallyEdited.length > 0 || typeChosen.length > 0
      ? { locallyEditedFields: [...new Set([...existing.locallyEditedFields, ...locallyEdited, ...typeChosen])] }
      : {};
    const entry = await tx.calendarEntry.update({ where: { id: entryId }, data: { ...fields, ...columns, ...locallyEditedFields, updatedByUserId: actorUserId } });
    const changed = Object.keys({ ...fields, ...columns }).filter((key) =>
      JSON.stringify(existing[key as keyof typeof existing]) !== JSON.stringify(entry[key as keyof typeof entry]));
    await writeAuditLog({
      actorUserId,
      action: existing.isPublished !== entry.isPublished
        ? (entry.isPublished ? "CALENDAR_ENTRY_PUBLISHED" : "CALENDAR_ENTRY_UNPUBLISHED")
        : "CALENDAR_ENTRY_UPDATED",
      entityType: "CalendarEntry",
      entityId: entry.id,
      summary: `Updated "${entry.title}" on the calendar.`,
      metadata: { changed },
    }, tx);
  });
  await keepRemindersCurrent();
  return listCalendarEntries();
}

export type CalendarBulkResult = {
  action: BulkAction["action"];
  changed: number;
  skipped: BulkSkip[];
};

/**
 * One bulk change over up to `maxBulkEntries` entries, all in one transaction.
 * Imported entries' feeds are locked first (in a fixed order), so a refresh
 * can't overwrite the change. One summary audit row lists the entry ids.
 */
export async function bulkUpdateCalendarEntries(request: CalendarBulkRequest, actorUserId: string) {
  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => {
    const found = await tx.calendarEntry.findMany({ where: { id: { in: request.ids } }, select: { sourceFeedId: true } });
    const feedIds = [...new Set(found.map((row) => row.sourceFeedId).filter((id): id is string => id !== null))].sort();
    for (const feedId of feedIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${feedLockKey(feedId)}))`;
    }
    // Read again under the locks, so the plan sees what a refresh just wrote.
    const rows = await tx.calendarEntry.findMany({ where: { id: { in: request.ids } } });
    const locked = new Set(feedIds);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = request.ids.flatMap((id) => byId.get(id) ?? []);
    // An entry that joined a feed we did not lock (re-linked meanwhile) is not safe to change now.
    const stable = ordered.filter((row) => row.sourceFeedId === null || locked.has(row.sourceFeedId));
    const plan = planBulkAction(stable, request.change);
    for (const row of ordered.filter((candidate) => !stable.includes(candidate))) {
      plan.skipped.push({ id: row.id, title: row.title, reason: "Changed while saving, try again." });
    }
    for (const missing of request.ids.filter((id) => !byId.has(id))) {
      plan.skipped.push({ id: missing, title: "", reason: "No longer exists." });
    }
    // Entries getting the same values go in one statement.
    const groups = new Map<string, { data: BulkChange["data"]; ids: string[] }>();
    for (const change of plan.changes) {
      const key = JSON.stringify(change.data);
      const group = groups.get(key) ?? { data: change.data, ids: [] };
      group.ids.push(change.id);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      await tx.calendarEntry.updateMany({ where: { id: { in: group.ids } }, data: { ...group.data, updatedByUserId: actorUserId } });
    }
    // An imported entry whose type staff chose also records that choice, so a refresh keeps it (#910).
    for (const change of plan.changes.filter((candidate) => candidate.markTypeEdited)) {
      const row = byId.get(change.id);
      if (!row) continue;
      await tx.calendarEntry.update({
        where: { id: change.id },
        data: { locallyEditedFields: [...new Set([...row.locallyEditedFields, entryTypeEditMark])] },
      });
    }
    if (plan.changes.length > 0) {
      await writeAuditLog({
        actorUserId,
        action: "CALENDAR_ENTRIES_BULK_UPDATED",
        entityType: "CalendarEntry",
        summary: `Bulk "${request.change.action}" on ${plan.changes.length} calendar ${plan.changes.length === 1 ? "entry" : "entries"}.`,
        metadata: {
          change: request.change,
          entryIds: plan.changes.map((change) => change.id),
          skipped: plan.skipped.map(({ id, reason }) => ({ id, reason })),
        },
      }, tx);
    }
    return { action: request.change.action, changed: plan.changes.length, skipped: plan.skipped } satisfies CalendarBulkResult;
  }, { timeout: 30_000, maxWait: 10_000 });
  await keepRemindersCurrent();
  return { result, entries: await listCalendarEntries() };
}

export async function deleteCalendarEntry(entryId: string, actorUserId: string) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const existing = await tx.calendarEntry.findUnique({ where: { id: entryId } });
    if (!existing) throw new CalendarError("ENTRY_NOT_FOUND", "That calendar entry could not be found.");
    // A refresh would bring a deleted import straight back; hiding it is the way to take it off.
    if (existing.sourceFeedId) {
      throw new CalendarError("INVALID_FEED", "Imported items can't be deleted. Hide it instead, or remove it in the source calendar.");
    }
    await tx.calendarEntry.delete({ where: { id: entryId } });
    await writeAuditLog({
      actorUserId,
      action: "CALENDAR_ENTRY_DELETED",
      entityType: "CalendarEntry",
      entityId: entryId,
      summary: `Removed "${existing.title}" from the calendar.`,
      metadata: { startsOn: existing.startsOn, endsOn: existing.endsOn, wasPublished: existing.isPublished },
    }, tx);
  });
  await keepRemindersCurrent();
  return listCalendarEntries();
}

export async function updateEventCalendarSettings(eventId: string, input: CalendarEventSettings, actorUserId: string) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const existing = await tx.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, showOnCalendar: true, calendarCategory: true } });
    if (!existing) throw new CalendarError("EVENT_NOT_FOUND", "That event could not be found.");
    const updated = await tx.event.update({
      where: { id: eventId },
      data: {
        ...(input.showOnCalendar === undefined ? {} : { showOnCalendar: input.showOnCalendar }),
        ...(input.calendarCategory === undefined ? {} : { calendarCategory: input.calendarCategory }),
      },
      select: { showOnCalendar: true, calendarCategory: true },
    });
    await writeAuditLog({
      eventId,
      actorUserId,
      action: "EVENT_CALENDAR_SETTINGS_UPDATED",
      entityType: "Event",
      entityId: eventId,
      summary: existing.showOnCalendar !== updated.showOnCalendar
        ? `${updated.showOnCalendar ? "Showed" : "Hid"} ${existing.name} on the public calendar.`
        : `Changed the calendar category for ${existing.name}.`,
      metadata: {
        showOnCalendar: updated.showOnCalendar,
        calendarCategory: updated.calendarCategory ?? "",
      },
    }, tx);
  });
  return listCalendarEvents();
}

/** Today's date in the conference time zone, for the default month. */
export function conferenceToday(now = new Date()) {
  return calendarDateIn(now);
}
