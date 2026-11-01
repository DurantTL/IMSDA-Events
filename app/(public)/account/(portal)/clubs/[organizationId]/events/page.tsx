import type { Metadata } from "next";
import { ClubEventList } from "@/components/club-event-list";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { listClubEvents } from "@/modules/club-registrations/repository";
import { clubAccessClosed } from "@/components/club-access-closed";

export const metadata: Metadata = { title: "Club events" };
export const dynamic = "force-dynamic";

export default async function ClubEventsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  const events = await listClubEvents(organizationId);
  return (
    <>
      <ClubEventList events={events} organizationId={organizationId} />
    </>
  );
}
