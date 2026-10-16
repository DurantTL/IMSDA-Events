import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { HonorsSetupWorkspace } from "@/components/honors-setup-workspace";
import { HonorWaitlistSettings } from "@/components/honor-waitlist-settings";
import { resolveEventContext } from "@/modules/events/selection";
import { getEventHonorSetup, listHonors } from "@/modules/honors/repository";
import { getHonorWaitlistOfferHours } from "@/modules/honors/waitlist-repository";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.honors };

export default async function HonorsSetupPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, events, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return (
      <>
        <AccessRestricted title="Honors setup is restricted" detail="Event administrators set up the sessions and honor classes each Honors Weekend site offers." />
      </>
    );
  }
  const [setup, honors, offerHours] = await Promise.all([getEventHonorSetup(event.id), listHonors(), getHonorWaitlistOfferHours(event.id)]);
  return (
    <>
      <HonorsSetupWorkspace
        catalog={honors.filter((honor) => honor.isActive).map(({ id, code, name }) => ({ id, code, name }))}
        eventId={event.id}
        eventName={event.name}
        initialSetup={setup}
        otherEvents={events.filter((candidate) => candidate.id !== event.id).map(({ id, name }) => ({ id, name }))}
      />
      <HonorWaitlistSettings eventId={event.id} initialHours={offerHours} />
    </>
  );
}
