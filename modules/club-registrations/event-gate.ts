import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";

/**
 * The gate every club event passes (#481): published, not archived, CLUB audience and church billing. One definition, so
 * the club portal's event list, `requireClubEvent` and the visiting club invites (#835) cannot drift apart.
 */
export const CLUB_EVENT_GATE = {
  isPublished: true,
  archivedAt: null,
  audience: "CLUB",
  billingMode: "DEFERRED_ORGANIZATION_INVOICE",
} as const satisfies Prisma.EventWhereInput;

/**
 * Whether a club may use this event (#835). A visiting guest club (`guestEventId` set) may use only its own event; a
 * conference club has no `guestEventId` and may use any. One read, so every club-event path asks the same question.
 */
export async function clubMayUseEvent(organizationId: string, eventId: string): Promise<boolean> {
  const club = await getPrisma().organization.findUnique({ where: { id: organizationId }, select: { guestEventId: true } });
  return !club?.guestEventId || club.guestEventId === eventId;
}

/**
 * For a club-event route: a not-found response when a guest club asks about another event, else null. Called after the
 * route's own access check, so it never tells a stranger anything.
 */
export async function rejectGuestClubOtherEvent(organizationId: string, eventId: string): Promise<Response | null> {
  if (await clubMayUseEvent(organizationId, eventId)) return null;
  return Response.json({ error: "EVENT_NOT_FOUND", message: "That club event could not be found." }, { status: 404, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
