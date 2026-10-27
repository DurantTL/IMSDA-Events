import "server-only";

import { getPrisma } from "@/lib/prisma";
import { findDashboardEvents, toDashboardEventSource } from "@/modules/system-admin/repository";
import { failedEmailWheres } from "@/modules/system-admin/email-problem-filters";
import { EMAIL_PROBLEM_WINDOW_DAYS } from "@/modules/system-admin/attention-model";
import { buildEventsAdminHome, type EventsAdminEventSource } from "@/modules/events/events-admin-home-model";

/**
 * The Events Administrator dashboard's read (#1227). `eventIds` must come from `resolveAdminRoles(user).eventAdminEventIds`
 * on the server: only those events are read, archived and ended events are left out in the query, and an empty list
 * runs no query at all. Read-only.
 */
export async function getEventsAdminEventSources(eventIds: readonly string[], now = new Date()): Promise<EventsAdminEventSource[]> {
  const prisma = getPrisma();
  const rows = await findDashboardEvents(prisma, { eventIds, endsOnOrAfter: now });
  if (rows.length === 0) return [];
  // Billing mode and draft registrations, for exactly the events the shared read returned.
  const extras = await prisma.event.findMany({
    where: { id: { in: rows.map((row) => row.id) }, archivedAt: null },
    select: {
      id: true,
      billingMode: true,
      _count: { select: { registrations: { where: { status: "DRAFT" } } } },
    },
  });
  const byId = new Map(extras.map((extra) => [extra.id, extra]));
  // Failed messages: the System attention rule (last 7 days, not later resent), only for the returned events.
  const since = new Date(now.getTime() - EMAIL_PROBLEM_WINDOW_DAYS * 24 * 60 * 60_000);
  const [failedWhere, providerWhere] = failedEmailWheres(since, rows.map((row) => row.id));
  const [failed, providerProblems] = await Promise.all([
    prisma.messageOutbox.groupBy({ by: ["eventId"], where: failedWhere, _count: { _all: true } }),
    prisma.messageOutbox.groupBy({ by: ["eventId"], where: providerWhere, _count: { _all: true } }),
  ]);
  const failedByEvent = new Map<string, number>();
  for (const group of [...failed, ...providerProblems]) {
    if (group.eventId) failedByEvent.set(group.eventId, (failedByEvent.get(group.eventId) ?? 0) + group._count._all);
  }
  return rows.map((row) => ({
    ...toDashboardEventSource(row),
    billingMode: byId.get(row.id)?.billingMode ?? "ATTENDEE_PAY",
    draftRegistrationCount: byId.get(row.id)?._count.registrations ?? 0,
    failedEmailCount: failedByEvent.get(row.id) ?? 0,
  }));
}

/**
 * What the Events Administrator pill counts (#1245): the dashboard's "Need attention" total, from the same read and the
 * same model, so the pill and the page cannot disagree. `eventIds` is the signed-in person's own
 * `resolveAdminRoles(user).eventAdminEventIds`. Callers leave the count off when this throws, never show it as zero.
 */
export async function countEventsAdminWaiting(eventIds: readonly string[], now = new Date()): Promise<number> {
  return buildEventsAdminHome(await getEventsAdminEventSources(eventIds, now), now).counts.needAttention;
}
