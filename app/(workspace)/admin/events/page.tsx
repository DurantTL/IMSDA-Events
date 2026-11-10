import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EventDirectory } from "@/components/event-directory";
import { buildDirectoryRows } from "@/components/event-directory-model";
import { ListPage } from "@/components/page-templates/list-page";
import { getCurrentSession } from "@/modules/access/current-session";
import { listEventsForUser } from "@/modules/events/repository";

export const metadata: Metadata = { title: "All events", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * All events (#1570): every current event, for System Administrators, with dates, place and status. This is the
 * system-wide directory; /events-admin stays the list of the events the person is assigned to, and /select-event the
 * picker for assigned events. Opening a row is the ordinary `?event=` link. Archived events are on their own page.
 */
export default async function AllEventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=event-setup");

  const params = await searchParams;
  // The same read the workspace's event switcher uses: current events (archived left out), all of them for a system administrator.
  const events = await listEventsForUser(user.id, true);

  return (
    <ListPage
      header={{
        title: "All events",
        description: "Every current event, with dates and status.",
        primary: <Link className="primary-button" href="/event-setup">Create an event</Link>,
        secondary: <Link className="secondary-button" href="/archived-events">Archived events</Link>,
      }}
    >
      <EventDirectory
        pathname="/admin/events"
        searchParams={params}
        rows={buildDirectoryRows(events.filter((event) => !event.isBillingContainer))}
        hrefFor={(id) => `/overview?event=${encodeURIComponent(id)}`}
        defaultSort={{ key: "dates", dir: "asc" }}
        noEvents={{ title: "No events yet", text: "There are no current events. Create one to get started.", action: { label: "Create an event", href: "/event-setup" } }}
      />
    </ListPage>
  );
}
