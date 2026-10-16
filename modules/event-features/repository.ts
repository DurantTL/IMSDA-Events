import "server-only";

import { getPrisma } from "@/lib/prisma";

/**
 * The facts the Event features page reads that no existing page-level loader
 * returns in one place (#965): the public calendar choice, and whether lodging
 * and meals are set up. Read only. Lodging is set up when the event has an
 * `EventLodging` row (a property was chosen for it); meals are set up when it has
 * at least one meal service that is not cancelled.
 */
export async function loadEventFeatureFacts(eventId: string) {
  const prisma = getPrisma();
  const [event, lodging, activeMealServices] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { showOnCalendar: true } }),
    prisma.eventLodging.findUnique({ where: { eventId }, select: { id: true } }),
    prisma.eventMealService.count({ where: { eventId, status: "ACTIVE" } }),
  ]);
  return {
    showOnCalendar: event?.showOnCalendar ?? true,
    lodgingSetUp: lodging !== null,
    mealsSetUp: activeMealServices > 0,
  };
}
