import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AreaClubSearch } from "@/components/area-clubs-views";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { CoordinatorClubEvents, CoordinatorClubEventsHelp, CoordinatorDestinationHeading } from "@/components/coordinator-destinations";
import { logError } from "@/lib/logger";
import { filterClubsByName, parseClubQuery } from "@/modules/club-reports/area-summary-domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-export";
import { listAreaClubEvents } from "@/modules/club-reports/area-summary-repository";
import { currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Club events", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Club events (#1187): the club year's published club events, each club's status
 * and headcount, and the actions a coordinator has (open a club, the kitchen
 * report). No payment action exists here, whoever is billed. A failed read says
 * "unavailable", never "no events".
 */
export default async function AreaEventsPage({ searchParams }: { searchParams: Promise<{ year?: string; q?: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const params = await searchParams;
  const clubYear = resolveAreaClubYear(params.year);
  const query = parseClubQuery(params.q);
  const allEvents = await listAreaClubEvents(clubYear).catch((error: unknown) => {
    logError("Coordinator club events read failed", error, { clubYear });
    return null;
  });
  // The component narrows the rows; the counts here only feed the search status line.
  const events = allEvents ?? [];
  const total = new Set(events.flatMap((event) => event.clubs.map((club) => club.organizationId))).size;
  const shown = new Set(events.flatMap((event) => filterClubsByName(event.clubs, query)).map((club) => club.organizationId)).size;
  return (
    <section className="public-manage-card page-stack coordinator-destination">
      <CoordinatorDestinationHeading clubYear={clubYear} title="Club events" />
      {allEvents === null ? (
        <CoordinatorUnavailable what="Club events" />
      ) : (
        <>
          <CoordinatorClubEventsHelp />
          <AreaClubSearch basePath="/account/area-clubs/events" clubYear={clubYear} query={query} shown={shown} total={total} />
          <CoordinatorClubEvents clearHref={`/account/area-clubs/events?year=${encodeURIComponent(clubYear)}`} events={allEvents} query={query} />
        </>
      )}
    </section>
  );
}
