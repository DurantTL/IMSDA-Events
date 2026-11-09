import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoordinatorClubsList } from "@/components/coordinator-clubs-list";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { logError } from "@/lib/logger";
import { parseClubQuery } from "@/modules/club-reports/area-summary-domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-export";
import { getAreaClubsSummary } from "@/modules/club-reports/area-summary-repository";
import { yearLabel } from "@/modules/club-rosters/home-view";
import { currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";
import { currentOwnDirectedClubIds } from "@/modules/organizations/own-directed-club-ids";

export const metadata: Metadata = { title: "Clubs", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * The coordinator's Clubs page (#1759): a search box first, then every club the coordinator can already see
 * (the same rows as Clubs at a glance, no new fields). Each club opens its view-only page; a club the coordinator
 * also directs opens normally (#1551). Layouts do not re-run on navigation, so the page checks for itself (#657).
 */
export default async function AreaClubsPage({ searchParams }: { searchParams: Promise<{ year?: string; q?: string }> }) {
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const params = await searchParams;
  const clubYear = resolveAreaClubYear(params.year);
  const query = parseClubQuery(params.q);
  const [clubs, ownClubIds] = await Promise.all([
    getAreaClubsSummary(clubYear).catch((error: unknown) => {
      logError("Coordinator clubs list read failed", error, { clubYear });
      return null;
    }),
    currentOwnDirectedClubIds(),
  ]);
  return (
    <section className="public-manage-card page-stack coordinator-clubs-page">
      <CoordinatorSectionHeading eyebrow={`Club year ${yearLabel(clubYear)}`} title="Clubs" />
      {clubs ? <CoordinatorClubsList clubYear={clubYear} clubs={clubs} ownClubIds={ownClubIds} query={query} /> : <CoordinatorUnavailable what="The club list" />}
    </section>
  );
}
