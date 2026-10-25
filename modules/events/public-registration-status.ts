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
 * True for open dates with at least one listed form. Capacity, a full event and the waitlist are
 * handled separately (not part of #1201); this only answers the dates-plus-form question.
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
