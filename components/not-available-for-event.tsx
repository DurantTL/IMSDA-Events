import { CalendarOff } from "lucide-react";

/**
 * A page that does not apply to the selected event (#981): a club page on a
 * non-club event, or health information after the event has ended. It is not a
 * permission failure, so it must not read "Permission required"; use
 * `AccessRestricted` for those. One line of reason, no call to ask for access.
 */
export function NotAvailableForEvent({ reason }: { reason: string }) {
  return (
    <section className="page-stack">
      <div className="forbidden-state panel" data-testid="not-available-for-event">
        <span><CalendarOff aria-hidden="true" size={26} /></span>
        <h2>Not available for this event</h2>
        <p>{reason}</p>
      </div>
    </section>
  );
}
