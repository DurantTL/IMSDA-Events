import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ChevronRight } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentSession } from "@/modules/access/current-session";
import { listArchivedEventsForUser } from "@/modules/events/archive-repository";

export const metadata: Metadata = {
  title: "Archived events",
  robots: { index: false, follow: false, nocache: true },
};

function formatEventDates(start: Date, end: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone }).formatRange(start, end);
}

/**
 * The Archived events list (#635): every archived event this account may open,
 * and the way back to one. Opening it is an ordinary `?event=` link, which
 * `resolveEventContext` honours for an archived event, so its records, reports
 * and exports stay readable. Unarchiving is in the event's Danger zone. These
 * links do not record the event as the last-used one, so an archived event is
 * never chosen automatically.
 */
export default async function ArchivedEventsPage() {
  const session = await getCurrentSession();
  if (!session.user) redirect(await staffLoginRedirectPath());
  const isSystemAdmin = session.user.globalRole === "SYSTEM_ADMIN";
  const events = await listArchivedEventsForUser(session.user.id, isSystemAdmin);
  const backHref = isSystemAdmin ? "/admin" : "/select-event";

  return (
    <main className="auth-page">
      <section className="auth-card select-event-card">
        <div className="auth-brand">
          <BrandMark />
          <span><strong>IMSDA</strong><small>Events</small></span>
        </div>
        <div className="auth-heading">
          <p className="eyebrow">Staff workspace</p>
          <h1>Archived events</h1>
          <p>Archived events are hidden from pickers and the public site, and registration is closed. Their records, reports and exports are still here.</p>
        </div>
        {events.length === 0 ? (
          <p role="status">There are no archived events.</p>
        ) : (
          <ul className="select-event-list">
            {events.map((event) => (
              <li key={event.id}>
                <Link className="select-event-option" href={`/overview?event=${encodeURIComponent(event.id)}`}>
                  <span>
                    <strong>{event.name}</strong>
                    <small><CalendarDays aria-hidden="true" size={13} /> {formatEventDates(event.startsAt, event.endsAt, event.timezone)}</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={17} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link className="secondary-button full-button" href={backHref}>Back to events</Link>
        <SignOutButton className="secondary-button full-button" />
      </section>
    </main>
  );
}
