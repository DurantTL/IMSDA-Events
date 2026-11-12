import { getPrisma } from "@/lib/prisma";
import type { EventLifecycleFacts } from "@/modules/events/lifecycle-state";

/** The event's name and the columns that decide its effective lifecycle state, for the event archive download (#175). Null when the event does not exist. */
export async function findEventArchiveFacts(eventId: string): Promise<({ id: string; name: string } & EventLifecycleFacts) | null> {
  return getPrisma().event.findUnique({
    where: { id: eventId },
    select: { id: true, name: true, lifecycleState: true, isPublished: true, archivedAt: true },
  });
}
