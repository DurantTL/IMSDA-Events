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
 * handled separately (not part of #1201); this only answers the dates-plus-form question.
 */
export function isPublicRegistrationOpen(phase: EventRegistrationPhase, formsListed: boolean) {
  return resolvePublicRegistrationStatus(phase, formsListed) === "OPEN";
}

/**
 * The status a list or page shows once capacity is known: the dates-and-form status, or FULL / WAITLIST when the event's
 * places are all taken (#1204). Full with a waitlist and a listed form is WAITLIST (joining is possible); without a listed
 * form it is FULL, since there is nothing to join. The calendar and the event page both call this.
 */
export type PublicCapacityStatus = PublicRegistrationStatus | "FULL" | "WAITLIST";

export function resolvePublicCapacityStatus(
  phase: EventRegistrationPhase,
  formsListed: boolean,
  capacity: { remaining: number | null; waitlistEnabled: boolean },
): PublicCapacityStatus {
  if (phase === "OPEN" && capacity.remaining === 0) return capacity.waitlistEnabled && formsListed ? "WAITLIST" : "FULL";
  return resolvePublicRegistrationStatus(phase, formsListed);
}

export const eventFullLabel = "Event full";
export const eventWaitlistLabel = "Event full \u00b7 waitlist open";

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function conferenceYear(now: Date) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric" }).format(now));
}

/**
 * The one plain-language status line the homepage, the calendar and the event page share (#1204, #1205). It comes
 * from the status above, never from a second rule: "Registration open", "Registration opens in February",
 * "Club registration opens in December", "Registration opening soon" (open dates, no listed form) and
 * "Registration closed". The year is added only when the opening month falls in a later year than today's, so
 * "in February" never reads as a month that has already passed.
 */
export function publicStatusLine(
  { status, opensOn, isClubEvent = false }: { status: PublicCapacityStatus; opensOn?: string | null; isClubEvent?: boolean },
  now = new Date(),
): string {
  const noun = isClubEvent ? "Club registration" : "Registration";
  if (status === "OPEN") return "Registration open";
  if (status === "WAITLIST") return eventWaitlistLabel;
  if (status === "FULL") return eventFullLabel;
  if (status === "OPENING_SOON") return "Registration opening soon";
  if (status === "UPCOMING") {
    const match = opensOn ? /^(\d{4})-(\d{2})-\d{2}$/.exec(opensOn) : null;
    const month = match ? monthNames[Number(match[2]) - 1] : undefined;
    if (!match || !month) return `${noun} opens soon`;
    const year = Number(match[1]);
    return `${noun} opens in ${month}${year > conferenceYear(now) ? ` ${year}` : ""}`;
  }
  // CLOSED and DRAFT: a draft is not public, so it reads as closed.
  if (status === "CLOSED" || status === "DRAFT") return "Registration closed";
  return "Registration closed";
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
