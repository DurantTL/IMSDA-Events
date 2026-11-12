import { computeRegistrationFlags } from "@/modules/registrations/flags";
import { listNotesForRegistration } from "@/modules/notes/repository";
import type { RegistrationRecord } from "@/modules/registrations/repository";
import { formatPersonName } from "@/lib/person-name";

/**
 * The rows of the registrations export, shared by the staff export route and the event archive (#175) so the two
 * cannot drift. `staffNotes` is the viewer's permissions, which decide which notes show; `null` leaves the
 * "Visible staff notes" column out entirely (the archive never carries notes, which can hold health information).
 */
export async function registrationsExportRows(
  eventId: string,
  registrations: readonly RegistrationRecord[],
  options: { showLocation: boolean; staffNotes: ReadonlySet<string> | null },
): Promise<Array<Array<string | number>>> {
  const { showLocation, staffNotes } = options;
  const rows: Array<Array<string | number>> = [[
    "Confirmation code",
    "Account holder",
    "Email",
    ...(showLocation ? ["Location"] : []),
    "Status",
    "Submitted at (ISO 8601)",
    "Attendees",
    "Total",
    "Net received",
    "Balance",
    "Flags",
    ...(staffNotes ? ["Visible staff notes"] : []),
  ]];
  for (const registration of registrations) {
    const flags = computeRegistrationFlags(registration);
    const visibleNotes = staffNotes ? await listNotesForRegistration(eventId, registration.id, staffNotes) : [];
    rows.push([
      registration.confirmationCode,
      formatPersonName(registration.accountHolder),
      registration.accountHolder.email,
      ...(showLocation ? [registration.location?.name ?? ""] : []),
      registration.status,
      registration.submittedAt ?? "",
      registration.attendeeCount,
      (registration.totalAmountCents / 100).toFixed(2),
      (registration.paidCents / 100).toFixed(2),
      (registration.balanceCents / 100).toFixed(2),
      flags.map((flag) => flag.label).join("; "),
      ...(staffNotes ? [visibleNotes.map((note) => note.body).join(" | ")] : []),
    ]);
  }
  return rows;
}
