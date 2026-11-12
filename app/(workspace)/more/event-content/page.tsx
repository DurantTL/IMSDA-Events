import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { EventContentWorkspace } from "@/components/event-content-workspace";
import { listEventAssets } from "@/modules/events/asset-repository";
import { sanitizedHtmlBySection } from "@/modules/events/content-html";
import { listEventContentSections } from "@/modules/events/content-repository";
import { resolveEventContext } from "@/modules/events/selection";
import { staffPageTitles } from "@/components/staff-navigation";
import { AdminPageHeader } from "@/components/admin-page-header";
import { PageHeader } from "@/components/page-header";
import { EventContentStarterButton } from "@/components/event-content-starter-button";
import { publicEventPath } from "@/modules/events/share-links";
import styles from "@/components/event-content-workspace.module.css";

export const metadata: Metadata = { title: staffPageTitles.eventContent };

export default async function EventContentPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const { event: requested } = await searchParams;
  const { event, permissions, user } = await resolveEventContext(requested);
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return (
      <>
        <AccessRestricted
          title="The event page is restricted"
          detail="Only event administrators can change what the public event page says."
          whoToAsk="your event administrator"
        />
      </>
    );
  }
  const sections = await listEventContentSections(event.id);
  return (
    <>
      <AdminPageHeader path="/more/event-content" eventId={event.id} />
      <PageHeader
        title={staffPageTitles.eventContent}
        description="What the public event page says: speaker bios, schedules, lodging and downloads."
        secondary={<EventContentStarterButton />}
        actions={
          <li>
            <a href={publicEventPath({ slug: event.slug })} target="_blank" rel="noreferrer">View public page</a>
          </li>
        }
        below={
          <nav aria-label="On this page">
            <ul className={styles.anchors}>
              <li><a href="#event-content-uploads">Uploads</a></li>
              <li><a href="#event-content-sections">Sections</a></li>
            </ul>
          </nav>
        }
      />
      <EventContentWorkspace
        key={event.id}
        eventId={event.id}
        eventName={event.name}
        eventSlug={event.slug}
        eventTiming={{
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt.toISOString(),
          timezone: event.timezone,
        }}
        isSystemAdmin={user.globalRole === "SYSTEM_ADMIN"}
        initialSections={sections}
        initialSanitizedHtml={sanitizedHtmlBySection(sections)}
        initialAssets={await listEventAssets(event.id)}
      />
    </>
  );
}
