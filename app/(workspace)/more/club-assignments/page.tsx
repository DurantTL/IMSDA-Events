import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { ClubAssignmentsWorkspace } from "@/components/club-assignments-workspace";
import {
  canManageClubAssignments,
  canSendClubAssignmentMessages,
} from "@/modules/club-registrations/assignments-access";
import { listClubAssignments } from "@/modules/club-registrations/assignments-repository";
import { resolveClubOversight } from "@/modules/club-rosters/event-oversight";
import { EventClubsViewsStrip } from "@/components/event-clubs-views-strip";
import { staffPageTitles } from "@/components/staff-navigation";
import { NotAvailableForEvent } from "@/components/not-available-for-event";

export const metadata: Metadata = { title: staffPageTitles.clubAssignments };
export const dynamic = "force-dynamic";

/** Staff screen for campsite/duty/activity assignments per club (#410). */
export default async function ClubAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const requested = (await searchParams).event;
  // The same event context as before, plus the oversight check the strip needs (#1582); nothing else is read.
  const { event, permissions, allowed, clubEvent } = await resolveClubOversight(requested);
  const strip = <EventClubsViewsStrip access={{ oversight: allowed, assignments: clubEvent && canManageClubAssignments(permissions) }} current="assignments" eventId={event.id} />;
  if (!canManageClubAssignments(permissions)) {
    return (
      <>
        {strip}
        <AccessRestricted
          title="Club assignments are restricted"
          detail="Assigning campsites, duties, or activities needs registration-management access."
          whoToAsk="your event administrator"
        />
      </>
    );
  }
  // Only club (church-billed) events have club registrations to assign.
  if (!clubEvent) {
    return (
      <>
        {strip}
        <NotAvailableForEvent reason="This event doesn't take club registrations. Choose a club event to assign campsites, duties, and activities." />
      </>
    );
  }
  const assignments = await listClubAssignments(event.id);
  return (
    <>
      {strip}
      <ClubAssignmentsWorkspace
        eventId={event.id}
        eventName={event.name}
        initialAssignments={assignments}
        canSend={canSendClubAssignmentMessages(permissions)}
      />
    </>
  );
}
