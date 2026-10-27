import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import type { EventRegistrationPhase } from "@/modules/events/lifecycle";

/**
 * The one public answer to "can someone register for this event right now?" (#1201).
 * The event page, the homepage "Coming up" list and the public calendar all take it from here, so
 * open dates with no published form never read "Registration open" (or show Register) in one place
 * and "opening soon" in another.
 *
 * OPENING_SOON: the dates are open but no registration form is listed yet.
 */
export type PublicRegistrationStatus = EventRegistrationPhase | "OPENING_SOON";

export function resolvePublicRegistrationStatus(
  phase: EventRegistrationPhase,
  formsListed: boolean,
): PublicRegistrationStatus {
  return phase === "OPEN" && !formsListed ? "OPENING_SOON" : phase;
}

/**
 * The public status once capacity is known (#1215). WAITLIST: the event is full and takes waitlist
 * registrations. FULL: the event is full and does not.
 */
export type PublicRegistrationState = PublicRegistrationStatus | "WAITLIST" | "FULL";

/**
 * The single capacity-aware decision behind the event page, the homepage and the calendar. A full event is
 * checked before forms, as the event page always has: with no seats left it reads full (or waitlist) even if no
 * form is listed. `remainingSpots` is null when the event has no capacity limit.
 */
export function resolvePublicRegistrationState(
  phase: EventRegistrationPhase,
  formsListed: boolean,
  remainingSpots: number | null,
  waitlistEnabled: boolean,
): PublicRegistrationState {
  if (phase !== "OPEN") return phase;
  if (remainingSpots === 0) return waitlistEnabled ? "WAITLIST" : "FULL";
  return resolvePublicRegistrationStatus(phase, formsListed);
}

/**
 * What staff dashboards call each public status (#1227, #1228). Both dashboards read the status from
 * `resolvePublicRegistrationStatus`, so an open event with no listed form says "Opens soon", the same as the public page.
 */
export const registrationStatusLabels: Record<PublicRegistrationStatus, string> = {
  OPEN: "Registration open",
  UPCOMING: "Opens soon",
  OPENING_SOON: "Opens soon",
  DRAFT: "Draft",
  CLOSED: "Registration closed",
};

export function registrationStatusLabel(phase: EventRegistrationPhase, formsListed: boolean): string {
  return registrationStatusLabels[resolvePublicRegistrationStatus(phase, formsListed)];
}

/**
 * True for open dates with at least one listed form. Capacity, a full event and the waitlist are
 * not considered here (#1215): use `resolvePublicRegistrationState` for the public answer.
 */
export function isPublicRegistrationOpen(phase: EventRegistrationPhase, formsListed: boolean) {
  return resolvePublicRegistrationStatus(phase, formsListed) === "OPEN";
}

/**
 * What makes a form "published" for the public: a form with a PUBLISHED version whose latest
 * published definition is valid. The event page lists exactly these, and the calendar uses the same
 * rule, so the two cannot disagree.
 */
export const publishedFormVersionWhere = { versions: { some: { status: "PUBLISHED" as const } } };

/** The version a public page uses for a form: its latest published one. Shared by the event page and the calendar check. */
export const latestPublishedVersionArgs = {
  where: { status: "PUBLISHED" as const },
  orderBy: { versionNumber: "desc" as const },
  take: 1,
};

export function isListablePublishedDefinition(definition: unknown) {
  return registrationFormDefinitionSchema.safeParse(definition).success;
}
