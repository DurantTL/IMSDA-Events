import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { HonorsViewsStrip } from "@/components/honors-views-strip";
import { HonorsScheduleBoard } from "@/components/honors-schedule-board";
import { staffPageTitles } from "@/components/staff-navigation";
import { resolveEventContext } from "@/modules/events/selection";
import { getScheduleBoard } from "@/modules/honors/schedule-repository";

export const metadata: Metadata = {
  title: staffPageTitles.honorsSchedule,
  robots: { index: false, follow: false, nocache: true },
};

export default async function HonorsSchedulePage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  const strip = <HonorsViewsStrip current="schedule" eventId={event.id} permissions={permissions} />;
  // The same permission as the class setup: moving a class changes the event's configuration.
  if (!permissions.includes("CONFIGURE_EVENT")) {
    return (
      <>
        {strip}
        <AccessRestricted title="The schedule board is restricted" detail="Event administrators arrange the Honors Weekend classes into rooms and sessions." whoToAsk="your event administrator" />
      </>
    );
  }
  return (
    <>
      {strip}
      <HonorsScheduleBoard eventId={event.id} initialBoard={await getScheduleBoard(event.id)} />
    </>
  );
}
