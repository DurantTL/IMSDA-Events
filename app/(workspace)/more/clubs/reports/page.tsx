import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { EventClubsViewsStrip } from "@/components/event-clubs-views-strip";
import { ClubReportsConference } from "@/components/club-reports-conference";
import { calendarDateIn } from "@/modules/calendar/domain";
import { resolveClubOversight } from "@/modules/club-rosters/event-oversight";
import { listClubReportsForYear } from "@/modules/club-reports/repository";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { canManageClubAssignments } from "@/modules/club-registrations/assignments-access";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.clubMonthlyReports };
export const dynamic = "force-dynamic";

/** Every club's monthly reports, view only, for a Pathfinder event's managers (#387). */
export default async function EventClubReportsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, allowed, clubEvent, permissions } = await resolveClubOversight(requested);
  const strip = <EventClubsViewsStrip access={{ oversight: allowed, assignments: clubEvent && canManageClubAssignments(permissions) }} current="records" eventId={event.id} />;
  if (!allowed) return <>{strip}<AccessRestricted title="Club oversight is restricted" detail="Event administrators of this Pathfinder event can view club reports." whoToAsk="your event administrator" /></>;
  const now = new Date();
  const clubYear = clubYearFor(now);
  return (
    <>
      {strip}
      <ClubReportsConference
        clubYear={clubYear}
        initialClubs={await listClubReportsForYear(clubYear)}
        now={calendarDateIn(now)}
        viewOnlyReportHref={{ base: "/more/clubs/reports", query: `?event=${event.id}` }}
      />
    </>
  );
}
