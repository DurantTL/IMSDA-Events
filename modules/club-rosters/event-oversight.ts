import "server-only";

import { getPrisma } from "@/lib/prisma";
import { resolveEventContext } from "@/modules/events/selection";

/**
 * Pathfinder event managers (#387): staff who are event administrators on a
 * club event (explicit CLUB audience, #481 — independent of billing mode, so
 * an attendee-paid club event still qualifies) oversee the clubs registered
 * for it — each club's roster with ages only, and every club's monthly
 * reports — view only, and for that event only (decision).
 */
export async function resolveClubOversight(requestedEventId?: string) {
  const context = await resolveEventContext(requestedEventId);
  const event = await getPrisma().event.findUnique({
    where: { id: context.event.id },
    select: { id: true, name: true, audience: true },
  });
  const clubEvent = event?.audience === "CLUB";
  const manager = context.user.globalRole === "SYSTEM_ADMIN" || context.membership?.role === "EVENT_ADMIN";
  return { ...context, allowed: Boolean(event && clubEvent && manager), clubEvent, systemAdmin: context.user.globalRole === "SYSTEM_ADMIN" };
}

/** Clubs with an active registration for this event. */
export async function listRegisteredClubs(eventId: string) {
  const registrations = await getPrisma().clubEventRegistration.findMany({
    where: { eventId, registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } },
    orderBy: [{ organization: { name: "asc" } }, { teamKey: "asc" }],
    select: {
      teamKey: true,
      teamName: true,
      organization: { select: { id: true, name: true, parentOrganization: { select: { name: true } } } },
      registration: { select: { confirmationCode: true, _count: { select: { attendees: true } } } },
    },
  });
  return registrations.map((row) => ({
    organizationId: row.organization.id,
    name: row.organization.name,
    // A club's teams (#809) are listed one to a row, each with its own registration.
    teamKey: row.teamKey,
    teamName: row.teamName,
    sponsoringChurch: row.organization.parentOrganization?.name ?? null,
    confirmationCode: row.registration.confirmationCode,
    attendeeCount: row.registration._count.attendees,
  }));
}

export async function isClubRegisteredForEvent(eventId: string, organizationId: string) {
  const row = await getPrisma().clubEventRegistration.findFirst({
    where: { eventId, organizationId, registration: { status: { in: ["SUBMITTED", "CONFIRMED"] } } },
    select: { id: true },
  });
  return Boolean(row);
}

type OversightScope = { eventId: string; systemAdmin: boolean };

/**
 * Whether this viewer may open one club's submitted records through event oversight. An event
 * administrator's role is for this event only, so the club must be registered for it; system
 * administrators keep their wider access.
 */
export async function canOpenClubRecords(scope: OversightScope, organizationId: string) {
  if (scope.systemAdmin) return true;
  return isClubRegisteredForEvent(scope.eventId, organizationId);
}

/** The clubs this viewer may open records for: every club for a system administrator, otherwise those registered for the event. */
export async function restrictToOverseenClubs<T extends { id: string }>(scope: OversightScope, clubs: readonly T[]): Promise<T[]> {
  if (scope.systemAdmin) return [...clubs];
  const registered = new Set((await listRegisteredClubs(scope.eventId)).map((club) => club.organizationId));
  return clubs.filter((club) => registered.has(club.id));
}
