import type { RegistrationRecord } from "@/modules/registrations/repository";
import { formatPersonName } from "@/lib/person-name";

/**
 * Every name, email, and code a staff member might type when hunting for one
 * registration — including each attendee on it, not only the account holder.
 *
 * A household or group books under a single contact, so a search that reads
 * only the account holder cannot find the people travelling with them. Finance
 * staff hit this hardest: someone calls about their own balance and the name
 * they give is an attendee's, not the payer's.
 */
export function registrationSearchTerms(registration: RegistrationRecord) {
  return [
    registration.confirmationCode,
    registration.accountHolder.firstName,
    registration.accountHolder.lastName,
    registration.accountHolder.email,
    registration.accountHolder.phone,
    ...registration.attendees.flatMap((attendee) => [
      attendee.firstName,
      attendee.lastName,
      attendee.email,
      attendee.phone,
    ]),
  ].filter((term) => term.trim().length > 0);
}

export function registrationMatchesSearch(
  registration: RegistrationRecord,
  query: string,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return registrationSearchTerms(registration)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/**
 * The attendee names to show beside a registration when the row itself is
 * keyed to the account holder. Trimmed so a fifty-person group does not push
 * the balance column off the screen.
 */
export function attendeeSummaryLabel(
  registration: RegistrationRecord,
  limit = 3,
) {
  const names = registration.attendees.map(
    (attendee) => formatPersonName(attendee),
  ).filter((name) => name.length > 0);
  if (names.length === 0) return "";
  const shown = names.slice(0, limit).join(", ");
  const remaining = names.length - Math.min(names.length, limit);
  return remaining > 0 ? `${shown} +${remaining} more` : shown;
}

/**
 * The record a `?registration=` link opens: a row of the list, else the
 * separately loaded off-page record (#180: a link to a registration that is not
 * on this page of search results). That record only opens the detail; it is
 * never added to the list, its count, or Select all.
 */
export function findRegistrationToOpen(
  rows: readonly RegistrationRecord[],
  openOnly: RegistrationRecord | null,
  id: string | undefined,
): RegistrationRecord | null {
  if (!id) return null;
  return rows.find((registration) => registration.id === id) ?? (openOnly?.id === id ? openOnly : null);
}
