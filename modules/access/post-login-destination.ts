import "server-only";

import type { GlobalRole } from "@prisma/client";
import { NO_EVENTS_PATH, resolveLoginDestination } from "@/modules/access/login-routing";
import { withoutArchivedEvents } from "@/modules/events/archive";
import { readLastUsedEventId } from "@/modules/events/last-used-event";
import { listEventsForUser } from "@/modules/events/repository";

/**
 * Gathers what `resolveLoginDestination` needs (the account's active events
 * and its remembered event) and applies it. Split from the pure function so
 * the routing decision itself stays testable without a database or cookies
 * (#108 queue 1).
 */
export async function resolvePostLoginDestination(
  user: { id: string; globalRole?: GlobalRole | null },
  options: { returnTo?: string | null } = {},
): Promise<string> {
  const isSystemAdmin = user.globalRole === "SYSTEM_ADMIN";
  const [allEvents, lastEventId] = await Promise.all([
    isSystemAdmin ? Promise.resolve([]) : listEventsForUser(user.id, false, { archived: "include" }),
    isSystemAdmin ? Promise.resolve(null) : readLastUsedEventId(),
  ]);
  // Archived events (#635) are never a landing choice.
  const events = withoutArchivedEvents(allEvents);

  const destination = resolveLoginDestination({
    isSystemAdmin,
    events,
    lastEventId,
    returnTo: options.returnTo,
  });
  // Same as /select-event: someone whose only events are archived goes to that list, not "no access".
  return destination === NO_EVENTS_PATH && allEvents.length > 0 ? "/archived-events" : destination;
}
