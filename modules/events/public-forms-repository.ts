import "server-only";

import { getPrisma } from "@/lib/prisma";
import { activeRegistrationStatuses } from "@/modules/events/lifecycle";
import { isListablePublishedDefinition, latestPublishedVersionArgs, publishedFormVersionWhere } from "@/modules/events/public-registration-status";

/**
 * Which of these events list at least one published registration form on their public page (#1201).
 * One query for all of them, never one per event. Applies the event page's own rule: a published
 * version whose latest definition is valid.
 */
export async function listEventIdsWithPublishedForms(eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const forms = await getPrisma().registrationForm.findMany({
    where: { eventId: { in: eventIds }, ...publishedFormVersionWhere },
    select: {
      eventId: true,
      versions: {
        ...latestPublishedVersionArgs,
        select: { definition: true },
      },
    },
  });
  return new Set(forms.flatMap((form) => {
    const version = form.versions[0];
    return version && isListablePublishedDefinition(version.definition) ? [form.eventId] : [];
  }));
}

/**
 * Seats taken per event, counted as the event page counts them (active registrations' attendees; #1215).
 * One grouped query for all of them, never one per event; events with no attendees are absent from the map.
 */
export async function countOccupiedSpotsByEvent(eventIds: string[]): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();
  const rows = await getPrisma().registrationAttendee.groupBy({
    by: ["eventId"],
    where: { eventId: { in: eventIds }, registration: { status: { in: [...activeRegistrationStatuses] } } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.eventId, row._count._all]));
}
