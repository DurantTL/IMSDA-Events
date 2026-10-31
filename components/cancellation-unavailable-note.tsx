/**
 * The line My registrations shows when the event has no cancellation policy (#1408): the request control is hidden, so say
 * why and who to ask. The support contact is plain text so it can be copied.
 */
export function CancellationUnavailableNote({ supportContact }: { supportContact: string | null }) {
  const contact = supportContact?.trim();
  return (
    <p className="attendee-reg-readonly">
      <strong>Cancellation isn&rsquo;t available online for this event.</strong>{" "}
      To cancel or change plans, contact the event team{contact ? <>: <span translate="no">{contact}</span>.</> : "."}
    </p>
  );
}
