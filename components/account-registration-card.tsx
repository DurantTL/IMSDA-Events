import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import { eventCardDates, registrationMoneySummary, registrationStateLabel, registrationViewLink } from "@/modules/attendee-accounts/registration-card";
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
export function AccountRegistrationCard({
  registration,
  primary,
  headingLevel = 3,
  showPeople = false,
  children,
}: {
  registration: AccountRegistrationCardData;
  primary: boolean;
  /** 3 on the Overview; 4 where the card sits under a group heading (My registrations history). */
  headingLevel?: 3 | 4;
  /** Name the included people (My registrations); the Overview only counts them. */
  showPeople?: boolean;
  /** Contextual secondary actions, below the money block (My registrations, #1176). */
  children?: ReactNode;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const dates = eventCardDates(registration.event);
  const money = registrationMoneySummary(registration);
  const people = registration.attendeeNames.length;
  const view = registrationViewLink(registration);
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
            <Heading id={headingId} translate="no">{registration.event.name}</Heading>
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
        {showPeople && people > 0 && (
          <p className="attendee-ov-people"><span className="attendee-ov-people-label">Included: </span><span translate="no">{registration.attendeeNames.join(", ")}</span></p>
        )}
        <div className={`attendee-ov-money attendee-ov-money-${money.tone}`}>
          <div>
            <p className="attendee-ov-money-headline">{money.headline}</p>
            {money.detail && <p className="attendee-ov-money-detail">{money.detail}</p>}
          </div>
          {view && (
            <Link className={`${primary ? "primary-button" : "secondary-button"} attendee-ov-action`} href={view.href}>
              {view.label}<span className="sr-only"> for {registration.event.name}</span> <ArrowRight size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
        {children}
      </article>
    </li>
  );
}
