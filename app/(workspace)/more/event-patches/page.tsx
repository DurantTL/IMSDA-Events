import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
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
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return (
      <>
        <AccessRestricted title="Event patches are restricted" detail="Event administrators link the patch or pin a club event gives its attendees." whoToAsk="your event administrator" />
      </>
    );
  }
  // Only club events have club attendees to suggest a patch to.
  const { clubEvent } = await resolveClubOversight(event.id);
  if (!clubEvent) {
    return (
      <>
        <NotAvailableForEvent reason="This event doesn't take club registrations. Choose a club event to link its patch or pin." />
      </>
    );
  }
  return (
    <>
      <EventPatchesWorkspace eventId={event.id} eventName={event.name} initial={await listEventAwardItems(event.id)} />
    </>
  );
}
