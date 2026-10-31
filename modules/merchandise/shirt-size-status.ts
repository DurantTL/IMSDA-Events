/**
 * The status shown next to an attendee on the private shirt-size page (#1406). Display only: a size chosen on the
 * registration form reads "Chosen on the form" rather than "Needs confirmation", and nothing about the registration
 * is written by showing it.
 */
export function shirtSizeStatus(
  attendee: { shirtSize: string | null; shirtSizeConfirmedAt: string | null },
): { label: string; isConfirmed: boolean } {
  if (attendee.shirtSizeConfirmedAt) {
    return {
      label: `Confirmed ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(attendee.shirtSizeConfirmedAt))}`,
      isConfirmed: true,
    };
  }
  if (attendee.shirtSize) return { label: "Chosen on the form", isConfirmed: true };
  return { label: "Needs confirmation", isConfirmed: false };
}
