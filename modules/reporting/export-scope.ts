import { findEventSlug } from "@/modules/events/repository";

/**
 * The scope of an event export's file name (#1458): the event slug, or the event id when the slug can't be read.
 * Call it after the route's own permission check. It reads one column and never decides access, so a failed read
 * only costs the nicer name.
 */
export async function eventFileScope(eventId: string): Promise<string> {
  try {
    return (await findEventSlug(eventId)) || eventId;
  } catch {
    return eventId;
  }
}
