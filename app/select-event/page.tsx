import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { SelectEventList } from "@/components/select-event-list";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentSession } from "@/modules/access/current-session";
import { listArchivedEventsForUser } from "@/modules/events/archive-repository";
import { listEventsForUser } from "@/modules/events/repository";

export const metadata: Metadata = {
  title: "Choose an event",
  robots: { index: false, follow: false, nocache: true },
};

function formatEventDates(start: Date, end: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone });
  return formatter.formatRange(start, end);
}

/**
 * A minimal event picker for a staff account with several active event
 * memberships and no usable remembered event (#108 queue 1). Lives outside
 * `(workspace)`, whose layout would otherwise pick an event for them before
 * this page ever renders.
 *
 * Also where `resolveEventContext` sends a request for an event id that
 * doesn't match one of this account's own events — missing, mistyped,
 * deleted, or just not permitted (#465). `?unavailable=1` marks that case: it
 * shows a "that event isn't available" notice instead of the ordinary
 * greeting, and, unlike the ordinary picker, does not auto-continue into an
 * account's one remaining event without saying why it's here.
 */
export default async function SelectEventPage({
  searchParams,
}: {
  searchParams: Promise<{ unavailable?: string }>;
}) {
  const { unavailable: unavailableParam } = await searchParams;
  const unavailable = unavailableParam === "1";

  const session = await getCurrentSession();
  if (!session.user) redirect(await staffLoginRedirectPath());
  if (session.user.globalRole === "SYSTEM_ADMIN") redirect("/admin");

  const events = await listEventsForUser(session.user.id, false);
  // Archived events are not choices (#635); an account whose events are all archived goes to that list.
  const archivedEvents = await listArchivedEventsForUser(session.user.id, false);
  if (events.length === 0) redirect(archivedEvents.length > 0 ? "/archived-events" : "/no-access");
  if (events.length === 1 && !unavailable) {
    redirect(`/overview?event=${encodeURIComponent(events[0].id)}`);
  }

  return (
    <main className="auth-page">
      <section className="auth-card select-event-card">
        <div className="auth-brand">
          <BrandMark />
          <span><strong>IMSDA</strong><small>Events</small></span>
        </div>
        <div className="auth-heading">
          <p className="eyebrow">Staff workspace</p>
          <h1>Choose an event</h1>
          {unavailable
            ? <p>You can&rsquo;t open that event with this account. Ask your event administrator if you need access, or choose one of your events below.</p>
            : <p>{session.user.email} has access to more than one event. Pick one to continue.</p>}
        </div>
        <SelectEventList
          events={events.map((event) => ({
            id: event.id,
            name: event.name,
            dates: formatEventDates(event.startsAt, event.endsAt, event.timezone),
          }))}
        />
        {archivedEvents.length > 0 && (
          <Link className="secondary-button full-button" href="/archived-events">Archived events ({archivedEvents.length})</Link>
        )}
        <SignOutButton className="secondary-button full-button" />
      </section>
    </main>
  );
}
