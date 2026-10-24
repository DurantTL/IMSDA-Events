import type { AttendeeRegistrationSummary } from "@/modules/attendee-accounts/registrations-repository";
import { upcomingRegistrations } from "@/modules/attendee-accounts/account-overview";

type HistoryRegistration = Pick<AttendeeRegistrationSummary, "id" | "lifecycle" | "balanceCents" | "payment"> & {
  event: Pick<AttendeeRegistrationSummary["event"], "name" | "startsAt" | "endsAt">;
};

export const historyFilters = ["all", "upcoming", "past", "cancelled"] as const;
export type HistoryFilter = (typeof historyFilters)[number];

/** The `?show=` value of My registrations; anything unknown is the full list, never an error. */
export function parseHistoryFilter(value: string | string[] | undefined): HistoryFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return historyFilters.find((filter) => filter === raw) ?? "all";
}

export type RegistrationHistory<T> = {
  /** Events that have not ended and are not cancelled, soonest first. Waitlisted records stay, with their own wording. */
  upcoming: T[];
  /** Events that have ended and were not cancelled, most recent first. */
  past: T[];
  /** Cancelled records, whatever the event date, most recent first. A cancelled record is history, never the next event. */
  cancelled: T[];
};

/**
 * Splits the account's registrations into active work and history (#1176), using the same rule as the Overview
 * (`upcomingRegistrations`, #1100) so a registration is never "coming up" on one page and "past" on the other.
 * A draft was never submitted and appears in none of the groups.
 */
export function splitRegistrationHistory<T extends HistoryRegistration>(registrations: T[], now = new Date()): RegistrationHistory<T> {
  const upcoming = upcomingRegistrations(registrations, now);
  const shown = new Set(upcoming.map((registration) => registration.id));
  const byStartDesc = (a: T, b: T) => b.event.startsAt.localeCompare(a.event.startsAt);
  return {
    upcoming,
    past: registrations
      .filter((registration) => registration.lifecycle !== "CANCELLED" && registration.lifecycle !== "DRAFT" && !shown.has(registration.id))
      .sort(byStartDesc),
    cancelled: registrations.filter((registration) => registration.lifecycle === "CANCELLED").sort(byStartDesc),
  };
}

export type RegistrationActions = {
  /** Always true; the card shows View registration only where the event hub loads the record (see registrationViewLink). */
  view: true;
  /** The existing payment boundary (own session, payable lifecycle, a balance), unchanged from before. */
  continuePayment: boolean;
  /** Contact details through the existing emailed-code edit: only on a live registration, never on history. */
  editContact: boolean;
  /** The existing cancellation request panel (a request for the event team, never a cancellation or refund). */
  cancellation: "request" | "status" | null;
  /** The registration's answers: editable only where the existing policy allows, and read-only inline on a cancelled record (it has no hub page). */
  details: boolean;
  /** Past and cancelled records are read-only history. */
  readOnlyHistory: boolean;
};

/**
 * Which secondary actions a registration card offers. It only narrows what the existing services already allow: it
 * never adds authority. There is no receipt action because no account receipt service exists; a paid past record
 * keeps its money summary instead.
 */
export function registrationActions(
  registration: HistoryRegistration & { answerEditing: { fields: unknown[] } },
  context: {
    /** The person's own session (not a staff user looking at the portal). */
    editable: boolean;
    /** The existing cancellation view (null when there is nothing to offer or show). */
    cancellation: { available: boolean; requests: unknown[] } | null;
    now?: Date;
  },
): RegistrationActions {
  const ended = new Date(registration.event.endsAt) < (context.now ?? new Date());
  const live = registration.lifecycle !== "CANCELLED" && registration.lifecycle !== "DRAFT" && !ended;
  const cancellation = context.cancellation
    ? context.cancellation.available ? "request" : context.cancellation.requests.length > 0 ? "status" : null
    : null;
  return {
    view: true,
    continuePayment: context.editable && registration.payment.paymentEligible && registration.balanceCents > 0,
    editContact: context.editable && live,
    cancellation: context.editable ? cancellation : null,
    details: (live || registration.lifecycle === "CANCELLED") && registration.answerEditing.fields.length > 0,
    readOnlyHistory: !live,
  };
}
