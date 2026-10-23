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

const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const formatMoney = (cents: number) => moneyFormatter.format(cents / 100);

/**
 * The text of the Balance cell for a directly billed registration (#1100):
 * the lifecycle-aware main line, plus the payment history when money was paid
 * on a registration that is not payable (cancelled or waitlisted).
 */
export function directBalanceCell(registration: Pick<AttendeeRegistrationSummary, "balanceCents" | "totalCents" | "grossPaidCents" | "refundedCents" | "payment">) {
  const total = registration.totalCents ?? 0;
  const { payment } = registration;
  const main = payment.paymentEligible && registration.balanceCents > 0
    ? `${formatMoney(registration.balanceCents)} due of ${formatMoney(total)}`
    : payment.state === "PAID"
      ? `Paid in full \u00b7 ${formatMoney(total)}`
      : payment.label;
  const gross = registration.grossPaidCents ?? 0;
  const refunded = registration.refundedCents ?? 0;
  const history = payment.state === "NOT_DUE" && gross > 0
    ? `${formatMoney(gross)} paid${refunded > 0 ? ` \u00b7 ${formatMoney(refunded)} refunded` : ""}`
    : null;
  return { main, history };
}
