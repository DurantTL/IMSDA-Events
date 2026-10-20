import { listEventBackgroundFlags, type BackgroundFlag } from "@/modules/background-checks/repository";

export type DirectorSterlingPerson = Pick<BackgroundFlag, "attendeeId" | "firstName" | "lastName" | "attendeeType" | "state">;

/**
 * A director's Sterling Volunteers follow-up for their own club at one event (#874). Only for a director or
 * deputy (the people who see birth dates and statuses elsewhere; a registrar or reporter gets nothing), only
 * once the club is registered, and only at a youth or children's event (null otherwise). Scoped to the club
 * and reduced to status: no contact, dates or staff-only notes ever leave this function.
 */
export async function loadDirectorSterlingFollowUp(input: {
  eventId: string;
  organizationId: string;
  registered: boolean;
  capabilities: { seeBirthDates: boolean };
}): Promise<DirectorSterlingPerson[] | null> {
  if (!input.registered || !input.capabilities.seeBirthDates) return null;
  const flags = await listEventBackgroundFlags(input.eventId, { organizationId: input.organizationId });
  if (!flags) return null;
  return flags.people.map(({ attendeeId, firstName, lastName, attendeeType, state }) => ({ attendeeId, firstName, lastName, attendeeType, state }));
}
