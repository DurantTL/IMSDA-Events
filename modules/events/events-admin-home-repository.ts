import "server-only";

import { getPrisma } from "@/lib/prisma";
import { findDashboardEvents, toDashboardEventSource } from "@/modules/system-admin/repository";
import type { EventsAdminEventSource } from "@/modules/events/events-admin-home-model";

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
  return rows.map((row) => ({
    ...toDashboardEventSource(row),
    billingMode: byId.get(row.id)?.billingMode ?? "ATTENDEE_PAY",
    draftRegistrationCount: byId.get(row.id)?._count.registrations ?? 0,
  }));
}
