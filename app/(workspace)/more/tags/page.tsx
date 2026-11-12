import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { PageHeader } from "@/components/page-header";
import { TagConfigurationWorkspace } from "@/components/tag-configuration-workspace";
import { resolveEventContext } from "@/modules/events/selection";
import { listTags } from "@/modules/tags/repository";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.tags };

export default async function TagConfigurationPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return (
      <>
        <PageHeader title={staffPageTitles.tags} />
        <AccessRestricted title="Tag configuration is restricted" detail="Event administrators can configure the tag vocabulary staff apply to registrations and attendees." whoToAsk="your event administrator" />
      </>
    );
  }
  const tags = await listTags(event.id);
  return (
    <div className="settings-stack">
      <PageHeader description="Define the labels staff can apply to registrations and attendees." title={staffPageTitles.tags} />
      <TagConfigurationWorkspace eventId={event.id} initialTags={tags} canCreate={permissions.includes("CONFIGURE_EVENT")} />
    </div>
  );
}
