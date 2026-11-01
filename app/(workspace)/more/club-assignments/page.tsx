import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { ClubAssignmentsWorkspace } from "@/components/club-assignments-workspace";
import {
  canManageClubAssignments,
  canSendClubAssignmentMessages,
} from "@/modules/club-registrations/assignments-access";
import { listClubAssignments } from "@/modules/club-registrations/assignments-repository";
import { resolveClubOversight } from "@/modules/club-rosters/event-oversight";
import { resolveEventContext } from "@/modules/events/selection";
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
  const { event, permissions } = await resolveEventContext(requested);
  if (!canManageClubAssignments(permissions)) {
    return (
      <>
        <AccessRestricted
          title="Club assignments are restricted"
          detail="Assigning campsites, duties, or activities needs registration-management access."
          whoToAsk="your event administrator"
        />
      </>
    );
  }
  // Only club (church-billed) events have club registrations to assign.
  const { clubEvent } = await resolveClubOversight(event.id);
  if (!clubEvent) {
    return (
      <>
        <NotAvailableForEvent reason="This event doesn't take club registrations. Choose a club event to assign campsites, duties, and activities." />
      </>
    );
  }
  const assignments = await listClubAssignments(event.id);
  return (
    <>
      <ClubAssignmentsWorkspace
        eventId={event.id}
        eventName={event.name}
        initialAssignments={assignments}
        canSend={canSendClubAssignmentMessages(permissions)}
      />
    </>
  );
}
