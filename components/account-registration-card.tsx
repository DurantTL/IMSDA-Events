import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import { eventCardDates, registrationMoneySummary, registrationStateLabel } from "@/modules/attendee-accounts/registration-card";
import type { AttendeeRegistrationSummary } from "@/modules/attendee-accounts/registrations-repository";

export type AccountRegistrationCardData = Pick<
  AttendeeRegistrationSummary,
  | "id" | "confirmationCode" | "lifecycle" | "status" | "event" | "attendeeNames" | "balanceCents" | "totalCents"
  | "paidCents" | "grossPaidCents" | "refundedCents" | "payment" | "churchBilling" | "groupBilling"
>;

/**
 * One registration on the account Overview (#1175): the event, when and where, the registration's state in words,
 * its money meaning and one next action. The action is View registration, which enters the existing event hub; this
 * card adds no new authority and offers no payment link of its own. `primary` fills the button (one per screen).
 */
export function AccountRegistrationCard({ registration, primary }: { registration: AccountRegistrationCardData; primary: boolean }) {
  const dates = eventCardDates(registration.event);
  const money = registrationMoneySummary(registration);
  const people = registration.attendeeNames.length;
  const headingId = `registration-card-${registration.id}`;
  return (
    <li>
      <article className="attendee-ov-card" aria-labelledby={headingId}>
        <div className="attendee-ov-card-top">
          <div className="attendee-ov-date" aria-hidden="true">
            <span>{dates.month}</span>
            <strong>{dates.day}</strong>
          </div>
          <div className="attendee-ov-card-title">
            <h3 id={headingId} translate="no">{registration.event.name}</h3>
            <span className={`attendee-status-pill attendee-status-pill-${registration.status.tone}`}>
              {registrationStateLabel(registration)}
            </span>
          </div>
        </div>
        <ul className="attendee-ov-facts">
          <li><CalendarDays size={16} aria-hidden="true" /> <span>{dates.range}</span></li>
          <li><MapPin size={16} aria-hidden="true" /> <span>{registration.event.location ?? "Location details coming soon"}</span></li>
        </ul>
        <p className="attendee-ov-meta">
          <span>Registration <span translate="no">#{registration.confirmationCode}</span></span>
          {people > 0 && <span>{people === 1 ? "1 person registered" : `${people} people registered`}</span>}
        </p>
        <div className={`attendee-ov-money attendee-ov-money-${money.tone}`}>
          <div>
            <p className="attendee-ov-money-headline">{money.headline}</p>
            {money.detail && <p className="attendee-ov-money-detail">{money.detail}</p>}
          </div>
          <Link
            className={`${primary ? "primary-button" : "secondary-button"} attendee-ov-action`}
            href={`/account/events/${encodeURIComponent(registration.event.slug)}`}
          >
            View registration<span className="sr-only"> for {registration.event.name}</span> <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </article>
    </li>
  );
}
