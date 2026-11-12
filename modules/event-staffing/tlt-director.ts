import "server-only";

import { getPrisma } from "@/lib/prisma";
import { requireTltDirectorStaffingActor } from "@/modules/event-staffing/access";
import { ACTIVE_REGISTRATION_STATUSES, STAFFING_MODULE_KEY, type ActivityView } from "@/modules/event-staffing/domain";
import { currentTltPersonIds } from "@/modules/tlt-directory/current-tlt";
import { listTltDirectoryRows } from "@/modules/tlt-directory/repository";

/**
 * What the TLT director's staffing pages read (#1678): the club events with the sheet switched on, and the registered TLTs of
 * one event. Read only. The caller has already passed `assertStaffingAccess` (the event page) or `requireTltDirectorStaffingActor`
 * (the overview). A TLT's year and help-area tags come from the TLT directory, which only she sees; no age, birth date, contact
 * detail, shirt answer or form answer is read or returned here.
 */

export { requireTltDirectorStaffingActor };

export type TltStaffingEventRow = {
  id: string;
  name: string;
  startsAt: Date;
  timezone: string;
  activityCount: number;
  tltsNeeded: number;
  tltsAssigned: number;
};

/** TLTs needed and assigned (people still registered and still a current TLT) on one sheet. */
export function tltCounts(activities: readonly ActivityView[]): { needed: number; assigned: number } {
  return {
    needed: activities.reduce((total, activity) => total + activity.tltsNeeded, 0),
    assigned: activities.reduce((total, activity) => total + activity.assignments.filter((assignment) => assignment.role === "TLT" && assignment.active).length, 0),
  };
}

/**
 * The upcoming and current published club events with Event staffing on, soonest first, with TLTs needed against assigned.
 * Needed numbers and activity counts come from one grouped read; only the TLT rows (event and person ids) are loaded for the
 * assigned count, which still counts a TLT only while registered for that event and still a current TLT.
 */
export async function listTltStaffingEvents(now = new Date()): Promise<TltStaffingEventRow[]> {
  const prisma = getPrisma();
  const events = await prisma.event.findMany({
    where: { archivedAt: null, isPublished: true, audience: "CLUB", endsAt: { gte: now }, modules: { some: { moduleKey: STAFFING_MODULE_KEY } } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: 60,
    select: { id: true, name: true, startsAt: true, timezone: true },
  });
  if (events.length === 0) return [];
  const eventIds = events.map((event) => event.id);
  const [totals, tltRows] = await Promise.all([
    prisma.eventStaffingActivity.groupBy({ by: ["eventId"], where: { eventId: { in: eventIds } }, _count: { _all: true }, _sum: { tltsNeeded: true } }),
    prisma.eventStaffingAssignment.findMany({ where: { eventId: { in: eventIds }, role: "TLT", personId: { not: null } }, select: { eventId: true, personId: true } }),
  ]);
  const personIds = [...new Set(tltRows.flatMap((row) => (row.personId ? [row.personId] : [])))];
  const [registered, current] = personIds.length === 0 ? [[], new Set<string>()] as const : await Promise.all([
    prisma.registrationAttendee.findMany({
      where: { eventId: { in: eventIds }, personId: { in: personIds }, registration: { status: { in: [...ACTIVE_REGISTRATION_STATUSES] } } },
      select: { eventId: true, personId: true },
    }),
    currentTltPersonIds(prisma, personIds, now),
  ]);
  const registeredKeys = new Set(registered.map((row) => `${row.eventId}:${row.personId}`));
  const assignedByEvent = new Map<string, number>();
  for (const row of tltRows) {
    if (row.personId && current.has(row.personId) && registeredKeys.has(`${row.eventId}:${row.personId}`)) assignedByEvent.set(row.eventId, (assignedByEvent.get(row.eventId) ?? 0) + 1);
  }
  const totalsByEvent = new Map(totals.map((row) => [row.eventId, row]));
  return events.map((event) => {
    const total = totalsByEvent.get(event.id);
    return { id: event.id, name: event.name, startsAt: event.startsAt, timezone: event.timezone, activityCount: total?._count._all ?? 0, tltsNeeded: total?._sum.tltsNeeded ?? 0, tltsAssigned: assignedByEvent.get(event.id) ?? 0 };
  });
}

export type EventTltOption = {
  personId: string;
  /** First Last, as the directory writes it. */
  name: string;
  clubId: string;
  clubName: string;
  tltYear: number | null;
  tags: Array<{ id: string; name: string }>;
};

/**
 * The current TLTs who are registered (submitted or confirmed) for this event: the directory's roster TLTs for this club year,
 * kept to those with an active registration on THIS event. A cancelled or draft registration is left out.
 */
export async function listEventTlts(eventId: string, now = new Date()): Promise<EventTltOption[]> {
  const rows = await listTltDirectoryRows(now);
  if (rows.length === 0) return [];
  const registered = await getPrisma().registrationAttendee.findMany({
    where: { eventId, personId: { in: rows.map((row) => row.personId) }, registration: { eventId, status: { in: [...ACTIVE_REGISTRATION_STATUSES] } } },
    distinct: ["personId"],
    select: { personId: true },
  });
  const onEvent = new Set(registered.map((row) => row.personId));
  return rows
    .filter((row) => onEvent.has(row.personId))
    .map((row) => ({ personId: row.personId, name: row.name, clubId: row.clubId, clubName: row.clubName, tltYear: row.tltYear, tags: row.tags }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-US") || a.personId.localeCompare(b.personId));
}
