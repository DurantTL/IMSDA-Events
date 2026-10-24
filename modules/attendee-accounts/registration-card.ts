import type { AttendeeRegistrationSummary } from "@/modules/attendee-accounts/registrations-repository";

type CardRegistration = Pick<
  AttendeeRegistrationSummary,
  "lifecycle" | "status" | "balanceCents" | "totalCents" | "paidCents" | "grossPaidCents" | "refundedCents" | "payment" | "churchBilling" | "groupBilling"
>;

const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const formatMoney = (cents: number) => moneyFormatter.format(cents / 100);

/**
 * The state wording on an Overview card (#1175). A submitted registration reads "Registration received": it arrived,
 * and nothing says it is confirmed. Every other state keeps the shared wording from describePublicRegistrationStatus.
 */
export function registrationStateLabel(registration: Pick<CardRegistration, "lifecycle" | "status">) {
  return registration.lifecycle === "SUBMITTED" ? "Registration received" : registration.status.label;
}

export type RegistrationMoneySummary = {
  headline: string;
  detail: string | null;
  /** "due" only when the signed-in person can pay something right now. */
  tone: "due" | "calm";
};

function sentence(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The money block on an Overview card (#1175), built on the same lifecycle-aware meaning as checkout and #1100:
 * waitlisted and cancelled records owe nothing now, and church-billed or group-billed records never make the
 * signed-in person a debtor for an organization invoice (a church-billed record never shows an amount owed).
 */
export function registrationMoneySummary(registration: CardRegistration): RegistrationMoneySummary {
  const total = registration.totalCents ?? 0;
  const gross = registration.grossPaidCents ?? 0;
  const refunded = registration.refundedCents ?? 0;
  const history = gross > 0 ? `${formatMoney(gross)} paid${refunded > 0 ? ` · ${formatMoney(refunded)} refunded` : ""}.` : null;

  if (registration.churchBilling) {
    return registration.churchBilling.billed
      ? { headline: "Billed to your church", detail: "Nothing to pay online. Your church is billed after the event.", tone: "calm" }
      : { headline: sentence(registration.churchBilling.label), detail: null, tone: "calm" };
  }
  if (registration.groupBilling) {
    return registration.groupBilling.billed
      ? { headline: `Estimated total ${formatMoney(registration.groupBilling.estimateCents)}`, detail: registration.groupBilling.notice, tone: "calm" }
      : { headline: sentence(registration.groupBilling.label), detail: null, tone: "calm" };
  }
  if (registration.lifecycle === "WAITLISTED") {
    return { headline: "No payment due while waitlisted", detail: history ?? "A place is not confirmed yet.", tone: "calm" };
  }
  if (registration.lifecycle === "CANCELLED") {
    // The original charges stay on the record: the total, what was paid and what was refunded (#1176).
    // A cancelled registration that never had a charge has no history to keep: only the no-payment-due sentence.
    if (total === 0 && gross === 0 && refunded === 0) {
      return { headline: "Nothing due now", detail: "No payment is due on a cancelled registration.", tone: "calm" };
    }
    const kept = [`Original total ${formatMoney(total)}`, gross > 0 ? `${formatMoney(gross)} paid` : "nothing paid", refunded > 0 ? `${formatMoney(refunded)} refunded` : null]
      .filter(Boolean)
      .join(" \u00b7 ");
    return { headline: "Nothing due now", detail: `${kept}. No payment is due on a cancelled registration.`, tone: "calm" };
  }
  if (registration.payment.paymentEligible && registration.balanceCents > 0) {
    const paid = registration.paidCents ?? 0;
    return {
      headline: `${formatMoney(registration.balanceCents)} remaining`,
      detail: paid > 0 ? `${formatMoney(paid)} paid toward your ${formatMoney(total)} registration.` : `Your registration total is ${formatMoney(total)}.`,
      tone: "due",
    };
  }
  if (registration.payment.state === "PAID") {
    return { headline: "Paid in full", detail: `${formatMoney(total)} registration.`, tone: "calm" };
  }
  return { headline: registration.payment.label, detail: null, tone: "calm" };
}

/** The date tile parts and range line for a card, in the event's own time zone. */
export function eventCardDates(event: { startsAt: string; endsAt: string; timezone: string }) {
  const part = (options: Intl.DateTimeFormatOptions, iso: string) =>
    new Intl.DateTimeFormat("en-US", { ...options, timeZone: event.timezone }).format(new Date(iso));
  const full = { month: "long", day: "numeric", year: "numeric" } as const;
  const start = part(full, event.startsAt);
  const end = part(full, event.endsAt);
  return {
    month: part({ month: "short" }, event.startsAt),
    day: part({ day: "numeric" }, event.startsAt),
    range: start === end ? start : `${start} – ${end}`,
  };
}

/** The registration statuses the event hub (`/account/events/[slug]`) loads. It must match the status filter in event-hub-repository.ts; a test pins them. */
export const HUB_REGISTRATION_LIFECYCLES = ["SUBMITTED", "CONFIRMED"] as const;

/** The id of a registration's card on the page that lists it, so another page can link straight to it. */
export const registrationAnchorId = (registrationId: string) => `registration-${registrationId}`;

/**
 * Where a card's default action goes (#1176): the event hub, and only for the statuses the hub loads, because it 404s for
 * anything else. A waitlisted or cancelled record has no hub page, so this returns null: on My registrations its details are
 * already inline. (/account/waitlists is the Area Coordinator's club page and is never a destination here.)
 */
export function registrationViewLink(registration: Pick<AttendeeRegistrationSummary, "lifecycle" | "event">): { href: string; label: string } | null {
  if ((HUB_REGISTRATION_LIFECYCLES as readonly string[]).includes(registration.lifecycle)) {
    return { href: `/account/events/${encodeURIComponent(registration.event.slug)}`, label: "View registration" };
  }
  return null;
}

/** The Overview's filled card (#1176): the first one that opens its event hub, so a waitlisted card listed earlier never takes the fill. */
export function overviewPrimaryCardId(registrations: Pick<AttendeeRegistrationSummary, "id" | "lifecycle" | "event">[]): string | undefined {
  return (registrations.find((registration) => registrationViewLink(registration)) ?? registrations[0])?.id;
}
