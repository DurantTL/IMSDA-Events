import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { PageHeader } from "@/components/page-header";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { EventPatchesWorkspace } from "@/components/event-patches-workspace";
import { resolveClubOversight } from "@/modules/club-rosters/event-oversight";
import { listEventAwardItems } from "@/modules/earned-awards/event-items";
import { resolveEventContext } from "@/modules/events/selection";
import { staffPageTitles } from "@/components/staff-navigation";
import { NotAvailableForEvent } from "@/components/not-available-for-event";

export const metadata: Metadata = { title: staffPageTitles.eventPatches };

/** Links catalog patches and pins to a club event (#532): event configuration, so CONFIGURE_EVENT. */
export default async function EventPatchesPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions, user } = await resolveEventContext(requested);
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return (
      <>
        <PageHeader title={staffPageTitles.eventPatches} />
        <AccessRestricted title="Event patches are restricted" detail="Event administrators link the patch or pin a club event gives its attendees." whoToAsk="your event administrator" />
      </>
    );
  }
  // Only club events have club attendees to suggest a patch to.
  const { clubEvent } = await resolveClubOversight(event.id);
  if (!clubEvent) {
    return (
      <>
        <PageHeader title={staffPageTitles.eventPatches} />
        <NotAvailableForEvent reason="This event doesn't take club registrations. Choose a club event to link its patch or pin." />
      </>
    );
  }
  return (
    <>
      <PageHeader description="Link the patch or pin this club event gives its attendees." title={staffPageTitles.eventPatches} />
      <EventPatchesWorkspace canOpenCatalog={await hasClubsAdministration(user)} eventId={event.id} initial={await listEventAwardItems(event.id)} />
    </>
  );
}
