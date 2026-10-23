import type { AttendeeRegistrationSummary } from "@/modules/attendee-accounts/registrations-repository";

type Lifecycle = Pick<AttendeeRegistrationSummary, "lifecycle" | "balanceCents" | "payment"> & {
  event: Pick<AttendeeRegistrationSummary["event"], "name" | "endsAt" | "startsAt">;
};

/**
 * Registrations for events that haven't ended yet, soonest first. A cancelled
 * registration is history, never an upcoming event, and a draft was never
 * submitted (#1100). Waitlisted ones stay, shown with their own wording.
 */
export function upcomingRegistrations<T extends Lifecycle>(registrations: T[], now = new Date()): T[] {
  return registrations
    .filter((registration) => registration.lifecycle !== "CANCELLED" && registration.lifecycle !== "DRAFT")
    .filter((registration) => new Date(registration.event.endsAt) >= now)
    .sort((a, b) => a.event.startsAt.localeCompare(b.event.startsAt));
}

/**
 * What the account owes right now, across every registration it can see.
 * Only registrations that are payable (submitted or confirmed, not church
 * billed) count, so waitlisted and cancelled records never read as owing.
 */
export function accountAmountDue<T extends Lifecycle>(registrations: T[]) {
  const payable = registrations.filter((registration) => registration.payment.paymentEligible && registration.balanceCents > 0);
  const totalCents = payable.reduce((total, registration) => total + registration.balanceCents, 0);
  return {
    totalCents,
    registrationCount: payable.length,
    /** Names the population so an all-registration total never looks like the featured event's balance. */
    scope: payable.length === 1 ? `for ${payable[0]!.event.name}` : `across ${payable.length} registrations`,
  };
}
