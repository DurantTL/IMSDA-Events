import {
  evaluateEventRegistrationPhase,
  hasEventEnded,
  remainingEventCapacity,
  type EventRegistrationPhase,
} from "@/modules/events/lifecycle";
import { publicStatusLine, resolvePublicCapacityStatus, resolvePublicRegistrationStatus } from "@/modules/events/public-registration-status";
import { pluralAttendeeLabel } from "@/modules/forms/attendee-label";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";

export type PublicEventRegistrationState =
  | "UPCOMING"
  | "OPEN"
  | "WAITLIST"
  | "FULL"
  | "CLOSED";

/**
 * The one primary action the event page's status block offers (#1205): Register (or Join the waitlist) when
 * registration can be used now, Add to my calendar while it is not open yet, nothing once it is closed, full or over.
 */
export type PublicEventStatusAction = "REGISTER" | "ADD_TO_CALENDAR" | "NONE";

export type PublicEventLifecycleSummary = {
  phase: EventRegistrationPhase;
  state: PublicEventRegistrationState;
  /** The page's single status message. Open/upcoming/opening-soon/closed wording is `publicStatusLine`, shared with the homepage and calendar. */
  statusLabel: string;
  /** One supporting sentence under the status message (the exact date, the closing date, spots left). */
  detail: string;
  /** The primary action's label (Register, Join the waitlist, Add to my calendar), or the status when there is none. */
  ctaLabel: string;
  /** Registration can be used now (the Register / Join the waitlist action is offered). */
  ctaEnabled: boolean;
  action: PublicEventStatusAction;
  /** The event itself is over (registration is closed for good). */
  ended: boolean;
  /** Heading above the list of registration forms, shown only when `action` is REGISTER. */
  formsHeading: string;
  /** Null on closed or ended events. */
  remainingSpots: number | null;
};

export type PublicAnnouncementPriority = "NORMAL" | "IMPORTANT" | "URGENT";

export type PublicAnnouncementCandidate = {
  title: string;
  body: string;
  audience: unknown;
  placement: string;
  status: string;
  priority: PublicAnnouncementPriority;
  publishedAt: Date | null;
};

export type PublicEventAnnouncement = {
  title: string;
  body: string;
  placement: string;
  placementLabel: string;
  priority: PublicAnnouncementPriority;
  priorityLabel: string;
  publishedAt: string;
  publishedLabel: string;
  isFeatured: boolean;
};

type PublicEventLifecycleInput = {
  isPublished: boolean;
  archivedAt: Date | null;
  timezone: string;
  capacity: number | null;
  registrationOpensOn: string | null;
  registrationClosesOn: string | null;
  waitlistEnabled: boolean;
  endsAt?: Date | null;
  /** "CLUB" words the opening month as "Club registration opens in ..." (#1204). */
  audience?: string | null;
};

export const publicAnnouncementPriorityRank: Record<
  PublicAnnouncementPriority,
  number
> = {
  URGENT: 0,
  IMPORTANT: 1,
  NORMAL: 2,
};

export function isExactAllAttendeesAudience(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const audience = value as Record<string, unknown>;
  return Object.keys(audience).length === 1
    && audience.type === "ALL_ATTENDEES";
}

function publicAnnouncementPlacementLabel(placement: string) {
  if (placement === "HOME_BANNER") return "Featured notice";
  if (placement === "REGISTRATION_PAGE") return "Registration update";
  return "Attendee update";
}

function publicAnnouncementPriorityLabel(
  priority: PublicAnnouncementPriority,
) {
  if (priority === "URGENT") return "Urgent";
  if (priority === "IMPORTANT") return "Important";
  return "Update";
}

export function buildPublicEventAnnouncementFeed(
  candidates: PublicAnnouncementCandidate[],
  timeZone: string,
  now = new Date(),
): PublicEventAnnouncement[] {
  const publishedFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });

  return candidates
    .filter((candidate) => (
      candidate.status === "PUBLISHED"
      && isExactAllAttendeesAudience(candidate.audience)
      && candidate.publishedAt !== null
      && Number.isFinite(candidate.publishedAt.valueOf())
      && candidate.publishedAt.getTime() <= now.getTime()
      && candidate.title.trim().length > 0
      && candidate.body.trim().length > 0
    ))
    .sort((left, right) => (
      publicAnnouncementPriorityRank[left.priority]
        - publicAnnouncementPriorityRank[right.priority]
      || right.publishedAt!.getTime() - left.publishedAt!.getTime()
      || left.placement.localeCompare(right.placement)
      || left.title.localeCompare(right.title)
      || left.body.localeCompare(right.body)
    ))
    .map((candidate) => {
      const publishedAt = candidate.publishedAt!;
      return {
        title: candidate.title.trim(),
        body: candidate.body.trim(),
        placement: candidate.placement,
        placementLabel: publicAnnouncementPlacementLabel(candidate.placement),
        priority: candidate.priority,
        priorityLabel: publicAnnouncementPriorityLabel(candidate.priority),
        publishedAt: publishedAt.toISOString(),
        publishedLabel: publishedFormatter.format(publishedAt),
        isFeatured: candidate.placement === "HOME_BANNER",
      };
    });
}

function calendarDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

type LifecyclePresentation = Pick<
  PublicEventLifecycleSummary,
  | "state"
  | "statusLabel"
  | "detail"
  | "ctaLabel"
  | "ctaEnabled"
  | "ended"
  | "action"
  | "formsHeading"
> & { showCapacity: boolean };

function spotsPhrase(remainingSpots: number) {
  return `${remainingSpots} spot${remainingSpots === 1 ? "" : "s"}`;
}

/**
 * One presentation per lifecycle state (#642). The hero, the forms heading and
 * empty state, the availability card, and the call to action all come from
 * this single result, so a page can never say "closed" in one place and show a
 * capacity number or "forms are being prepared" in another.
 */
function presentPublicEventLifecycle(
  event: PublicEventLifecycleInput,
  phase: EventRegistrationPhase,
  remainingSpots: number | null,
  now: Date,
  formsListed: boolean,
): LifecyclePresentation {
  const isClubEvent = event.audience === "CLUB";
  const calendarAction = { action: "ADD_TO_CALENDAR" as const, ctaLabel: "Add to my calendar", ctaEnabled: false };
  const noAction = (label: string) => ({ action: "NONE" as const, ctaLabel: label, ctaEnabled: false });

  if (phase === "UPCOMING") {
    const opens = event.registrationOpensOn ? calendarDateLabel(event.registrationOpensOn) : null;
    return {
      state: "UPCOMING",
      statusLabel: publicStatusLine({ status: "UPCOMING", opensOn: event.registrationOpensOn, isClubEvent, timeZone: event.timezone }, now),
      detail: opens
        ? `Registration opens ${opens}. Review the event details below in the meantime.`
        : "Review the event details below. Registration dates will be posted here.",
      ...calendarAction,
      ended: false,
      formsHeading: "Registration options",
      showCapacity: true,
    };
  }

  if (phase === "CLOSED" && hasEventEnded(event, now)) {
    return {
      state: "CLOSED",
      statusLabel: "This event has ended",
      detail: "Online registration is no longer available. Contact the event team if you need help.",
      ...noAction("This event has ended"),
      ended: true,
      formsHeading: "Registration is closed",
      showCapacity: false,
    };
  }

  if (phase === "CLOSED" || phase === "DRAFT") {
    const closed = event.registrationClosesOn
      ? ` on ${calendarDateLabel(event.registrationClosesOn)}`
      : "";
    return {
      state: "CLOSED",
      statusLabel: publicStatusLine({ status: "CLOSED" }, now),
      detail: `Online registration is no longer available${closed}. Contact the event team if you need help.`,
      ...noAction("Registration closed"),
      ended: false,
      formsHeading: "Registration is closed",
      showCapacity: false,
    };
  }

  if (remainingSpots === 0) {
    if (event.waitlistEnabled) {
      return {
        state: "WAITLIST",
        statusLabel: publicStatusLine({ status: resolvePublicCapacityStatus(phase, formsListed, { remaining: 0, waitlistEnabled: true }) }, now),
        detail: formsListed
          ? "The event is currently full, but you can submit a registration to join the waitlist."
          : "The event is currently full. The waitlist form will appear here when it is ready.",
        ...(formsListed
          ? { action: "REGISTER" as const, ctaLabel: "Join the waitlist", ctaEnabled: true }
          : noAction("Waitlist opening soon")),
        ended: false,
        formsHeading: "Join the waitlist",
        showCapacity: true,
      };
    }
    return {
      state: "FULL",
      statusLabel: publicStatusLine({ status: "FULL" }, now),
      detail: "All available places are currently filled. Contact the event team with questions.",
      ...noAction("Event full"),
      ended: false,
      formsHeading: "Event full",
      showCapacity: true,
    };
  }

  // Open dates with no forms to choose from yet: say so, never "Registration open" without a way to register.
  if (resolvePublicRegistrationStatus("OPEN", formsListed) === "OPENING_SOON") {
    return {
      state: "OPEN",
      statusLabel: publicStatusLine({ status: "OPENING_SOON", isClubEvent }, now),
      detail: "Registration forms are not listed yet. Check back soon, or add the event to your calendar.",
      ...calendarAction,
      ended: false,
      formsHeading: "Registration options",
      showCapacity: true,
    };
  }

  const closes = event.registrationClosesOn
    ? ` through ${calendarDateLabel(event.registrationClosesOn)}`
    : "";
  return {
    state: "OPEN",
    statusLabel: publicStatusLine({ status: "OPEN", isClubEvent }, now),
    detail: `Online registration is available${closes}.${remainingSpots === null ? "" : ` ${spotsPhrase(remainingSpots)} currently remain.`}`,
    action: "REGISTER",
    ctaLabel: "Register",
    ctaEnabled: true,
    ended: false,
    formsHeading: "Choose how you\u2019re registering",
    showCapacity: true,
  };
}

export function describePublicEventLifecycle(
  event: PublicEventLifecycleInput,
  occupiedSpots: number,
  now = new Date(),
  /** False when the event page lists no registration forms (an open event with none says so). */
  formsListed = true,
): PublicEventLifecycleSummary {
  const phase = evaluateEventRegistrationPhase(event, now);
  const capacityLeft = remainingEventCapacity(event.capacity, occupiedSpots);
  const { showCapacity, ...presentation } = presentPublicEventLifecycle(
    event,
    phase,
    capacityLeft,
    now,
    formsListed,
  );

  return {
    phase,
    ...presentation,
    // A closed or ended event shows no capacity number (#642).
    remainingSpots: showCapacity ? capacityLeft : null,
  };
}

export function summarizePublicRegistrationForm(
  definition: RegistrationFormDefinition,
) {
  const fields = definition.sections.flatMap((section) => section.fields);
  const attendeeFields = fields.filter((field) => field.scope === "ATTENDEE");
  const roster = definition.attendeeRoster?.enabled
    ? definition.attendeeRoster
    : null;
  const hasPricing = fields.some((field) => (
    field.priceCents !== undefined
    || Object.keys(field.choicePricesCents ?? {}).length > 0
  ));

  return {
    title: definition.title,
    description: definition.description?.trim() || "Complete this form to register for the event.",
    /** True when the form collects a list of people (a roster form). */
    isRoster: roster !== null,
    audienceLabel: roster
      ? `${roster.attendeeLabel} roster`
      : attendeeFields.length > 0
        ? "Individual attendee"
        : "Event registration",
    highlights: [
      roster
        ? `Add up to ${roster.maxAttendees} ${pluralAttendeeLabel(roster.attendeeLabel, roster.maxAttendees)}`
        : "One registration at a time",
      `${definition.sections.length} section${definition.sections.length === 1 ? "" : "s"}`,
      ...(definition.payment?.enabled || hasPricing ? ["Includes fee calculation"] : []),
    ],
  };
}

export function formatPublicEventSchedule(
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
) {
  const dates = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
  const dayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  const zoneOf = (date: Date) => new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "";
  const weekday = (date: Date, style: "long" | "short") => new Intl.DateTimeFormat("en-US", { weekday: style, timeZone }).format(date);

  // One day: "Saturday, 9:00 AM \u2013 5:00 PM CST". Several days: "Fri 9:00 AM \u2013 Sun 12:00 PM CST", so the days
  // always agree with the date range beside it and the zone is stated once (#1205).
  const startZone = zoneOf(startsAt);
  const endZone = zoneOf(endsAt);
  const zones = startZone === endZone ? ` ${endZone}` : "";
  const startClock = `${clock.format(startsAt)}${zones ? "" : ` ${startZone}`}`;
  const endClock = `${clock.format(endsAt)}${zones ? "" : ` ${endZone}`}`;
  const timeLabel = dayKey.format(startsAt) === dayKey.format(endsAt)
    ? `${weekday(startsAt, "long")}, ${startClock} \u2013 ${endClock}${zones}`
    : `${weekday(startsAt, "short")} ${startClock} \u2013 ${weekday(endsAt, "short")} ${endClock}${zones}`;

  return {
    dateLabel: dates.formatRange(startsAt, endsAt),
    timeLabel,
  };
}

/**
 * The IMSDA.org information page is an optional setting (#467), not a
 * required one: event information now lives on IMSDA Events. When neither a
 * configured `publicInfoUrl` nor a known legacy page exists for this event,
 * `detailsUrl` is `null` so a caller drops the "More information" link
 * instead of rendering one that points nowhere useful.
 */
export function publicEventWebsiteLinks(
  eventSlug: string,
  configuredDetailsUrl?: string | null,
) {
  const eventDetailsBySlug: Record<string, string> = {
    "womens-retreat-2026": "https://imsda.org/event/womens-retreat-3/",
  };

  return {
    detailsUrl: configuredDetailsUrl
      || eventDetailsBySlug[eventSlug]
      || null,
    supportUrl: "https://imsda.org/contact/",
  };
}
