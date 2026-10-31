import "server-only";

import { IMPORTED_SUBMISSION_KEY_PREFIX } from "@/modules/imports/submission-keys";
import { getPrisma } from "@/lib/prisma";
import { evaluateEventRegistrationPhase } from "@/modules/events/lifecycle";
import { publishedFormVersionWhere } from "@/modules/events/public-registration-status";

/**
 * The reads behind the registration and checkout checks (#1375). Read-only, and only counts and event names leave:
 * never a registration, a confirmation code or a person.
 */

export type OpenRegistrationEvent = { id: string; name: string; hasPublishedForm: boolean };

/**
 * Events that are open for registration right now (the same `evaluateEventRegistrationPhase` rule the public page
 * uses), among published, unarchived events that have not ended more than the window ago. `hasPublishedForm` uses the
 * public page's own published-form rule.
 */
export async function readOpenRegistrationEvents(now: Date, windowStart: Date): Promise<OpenRegistrationEvent[]> {
  const events = await getPrisma().event.findMany({
    where: { archivedAt: null, isPublished: true, endsAt: { gte: windowStart } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      name: true,
      isPublished: true,
      timezone: true,
      registrationOpensOn: true,
      registrationClosesOn: true,
      waitlistEnabled: true,
      archivedAt: true,
      lifecycleState: true,
      endsAt: true,
      _count: { select: { registrationForms: { where: publishedFormVersionWhere } } },
    },
  });
  return events
    .filter((event) => evaluateEventRegistrationPhase(event, now) === "OPEN")
    .map((event) => ({ id: event.id, name: event.name, hasPublishedForm: event._count.registrationForms > 0 }));
}

/**
 * Capacity reservations never released by their registration. A reservation is released only when its registration is
 * cancelled or moved to the waitlist, so one that is still unreleased on a CANCELLED or WAITLISTED registration was missed.
 * One grouped count per event, in the order the events were given.
 */
export async function readUnreleasedHoldCounts(eventIds: string[]): Promise<Array<{ eventId: string; count: number }>> {
  if (eventIds.length === 0) return [];
  const groups = await getPrisma().registrationCapacityReservation.groupBy({
    by: ["eventId"],
    where: { eventId: { in: eventIds }, releasedAt: null, registration: { status: { in: ["CANCELLED", "WAITLISTED"] } } },
    _count: { _all: true },
  });
  const counts = new Map(groups.map((group) => [group.eventId, group._count._all]));
  return eventIds.filter((id) => (counts.get(id) ?? 0) > 0).map((id) => ({ eventId: id, count: counts.get(id)! }));
}

/**
 * Public form submissions (one `PublicRegistrationSubmission` per registration made through the public form) since a
 * time. Imports also write these rows, stamped with the import time, so they are left out.
 */
export async function countPublicSubmissionsSince(eventIds: string[], since: Date): Promise<number> {
  if (eventIds.length === 0) return 0;
  return getPrisma().publicRegistrationSubmission.count({
    where: { eventId: { in: eventIds }, createdAt: { gte: since }, NOT: { idempotencyKey: { startsWith: IMPORTED_SUBMISSION_KEY_PREFIX } } },
  });
}
