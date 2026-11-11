import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLink } from "@/components/brand-link";
import { EventDirectory } from "@/components/event-directory";
import { buildDirectoryRows } from "@/components/event-directory-model";
import { ListPage } from "@/components/page-templates/list-page";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentSession } from "@/modules/access/current-session";
import { listArchivedEventsForUser } from "@/modules/events/archive-repository";

export const metadata: Metadata = {
  title: "Archived events",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The Archived events list (#635): every archived event this account may open,
 * and the way back to one. Opening it is an ordinary `?event=` link, which
 * `resolveEventContext` honours for an archived event, so its records, reports
 * and exports stay readable. Unarchiving is in the event's Danger zone. These
 * links do not record the event as the last-used one, so an archived event is
 * never chosen automatically. The list is the shared event directory (#1570).
 */
export default async function ArchivedEventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const session = await getCurrentSession();
  if (!session.user) redirect(await staffLoginRedirectPath());
  const isSystemAdmin = session.user.globalRole === "SYSTEM_ADMIN";
  const events = await listArchivedEventsForUser(session.user.id, isSystemAdmin);
  const backHref = isSystemAdmin ? "/admin" : "/select-event";

  return (
    <main className="auth-page">
      <section className="auth-card select-event-card">
        <BrandLink className="auth-brand" wordmark />
        <ListPage
          header={{
            title: "Archived events",
            description: "Archived events are hidden from pickers and the public site, and registration is closed. Their records, reports and exports are still here.",
            secondary: <Link className="secondary-button" href={backHref}>Back to events</Link>,
          }}
          footer={<SignOutButton className="secondary-button full-button" />}
        >
          <EventDirectory
            pathname="/archived-events"
            searchParams={params}
            rows={buildDirectoryRows(events)}
            hrefFor={(id) => `/overview?event=${encodeURIComponent(id)}`}
            defaultSort={{ key: "dates", dir: "desc" }}
            showStatus={false}
            noEvents={{ title: "No archived events", text: "There are no archived events." }}
          />
        </ListPage>
      </section>
    </main>
  );
}
