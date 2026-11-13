import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import {
  EVENT_ARCHIVED_CODE,
  EVENT_ARCHIVED_READ_ONLY_MESSAGE,
  type ArchivedWriteTarget,
} from "@/modules/events/archived-read-only";

/**
 * Refuses a write to an archived event (#159) before its route handler runs.
 *
 * Order: the caller is recognised first, then the event is read. Someone who may not act on the event gets what the route
 * gives them today (sign-in or access errors), never the archived answer. The check is made just before the change, so a
 * save already in progress when the event is archived can still finish.
 *
 * If a read fails the request is refused with 503 rather than let through. An unknown event passes, so the handler
 * answers 404 itself. (No `server-only` import, like `area-pause.ts`: `withRequestContext` loads this on demand and route
 * tests run it.)
 */
export async function refuseArchivedWriteFor(target: ArchivedWriteTarget): Promise<Response | null> {
  try {
    if (!(await callerMayActOn(target))) return null;
  } catch (error) {
    logError("Archived-event caller check failed", error);
    return unavailable();
  }
  return refuseIfEventArchived(target.eventId);
}

/** Whether the caller holds the access the staff routes require, by the same helpers they use. */
async function callerMayActOn({ eventId }: ArchivedWriteTarget): Promise<boolean> {
  const { user } = await getCurrentSession();
  if (!user) return false;
  if (user.globalRole === "SYSTEM_ADMIN") return true;
  const membership = await findActiveMembership(user.id, eventId);
  return Boolean(membership && membership.status === "ACTIVE");
}

/** For a caller that has already passed its own access checks (for example a report handler about to save a layout). */
export async function refuseIfEventArchived(eventId: string): Promise<Response | null> {
  try {
    const event = await getPrisma().event.findUnique({ where: { id: eventId }, select: { archivedAt: true, isBillingContainer: true } });
    // A billing container (#1688) is created archived and can never be unarchived, yet staff finance work runs against it.
    if (event?.archivedAt && !event.isBillingContainer) {
      return Response.json({ error: EVENT_ARCHIVED_CODE, message: EVENT_ARCHIVED_READ_ONLY_MESSAGE }, { status: 409 });
    }
    return null;
  } catch (error) {
    logError("Archived-event check failed", error);
    return unavailable();
  }
}

function unavailable() {
  return Response.json(
    { error: "EVENT_STATE_UNAVAILABLE", message: "The event's state could not be checked, so nothing was changed. Try again." },
    { status: 503 },
  );
}
