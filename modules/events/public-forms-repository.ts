import "server-only";

import { getPrisma } from "@/lib/prisma";
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
