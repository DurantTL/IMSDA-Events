import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLink } from "@/components/brand-link";
import { ListPage } from "@/components/page-templates/list-page";
import { EventDirectory } from "@/components/event-directory";
import { buildDirectoryRows } from "@/components/event-directory-model";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentSession } from "@/modules/access/current-session";
import { listArchivedEventsForUser } from "@/modules/events/archive-repository";
import { listEventsForUser } from "@/modules/events/repository";

export const metadata: Metadata = {
  title: "Choose an event",
  robots: { index: false, follow: false, nocache: true },
};

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
 *
 * The list is the shared event directory (#1570) over the events this account is assigned to; a System Administrator
 * never reaches it (they go to /admin, and see every event on All events).
 */
export default async function SelectEventPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const unavailable = params.unavailable === "1";

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
        <BrandLink className="auth-brand" wordmark />
        <ListPage
          header={{
            title: "Choose an event",
            description: unavailable
              ? "You can\u2019t open that event with this account. Ask your event administrator if you need access, or choose one of your events below."
              : `These are the events ${session.user.email} is assigned to. Pick one to continue.`,
            secondary: archivedEvents.length > 0
              ? <Link className="secondary-button" href="/archived-events">Archived events ({archivedEvents.length})</Link>
              : undefined,
          }}
          footer={<SignOutButton className="secondary-button full-button" />}
        >
          <EventDirectory
            pathname="/select-event"
            searchParams={params}
            rows={buildDirectoryRows(events)}
            hrefFor={(id) => `/overview?event=${encodeURIComponent(id)}`}
            rememberOnOpen
            defaultSort={{ key: "dates", dir: "asc" }}
            keepParams={unavailable ? { unavailable: "1" } : undefined}
            noEvents={{ title: "No events", text: "No events are assigned to this account." }}
          />
        </ListPage>
      </section>
    </main>
  );
}
