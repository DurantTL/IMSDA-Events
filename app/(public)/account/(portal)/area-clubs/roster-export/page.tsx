import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoordinatorDestinationHeading } from "@/components/coordinator-destinations";
import { RosterExportBuilder } from "@/components/roster-export-builder";
import { resolveAreaClubYear } from "@/modules/club-reports/area-club-year";
import { currentAreaCoordinatorViewerActive, listClubsForArea } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Export rosters", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Roster export for an Area Coordinator (#1760): the director's column builder over the coordinator's own column list,
 * for all clubs or chosen ones. Same gate as the other Clubs pages. `?club=<id>` preselects one club.
 */
export default async function AreaRosterExportPage({ searchParams }: { searchParams: Promise<{ club?: string; year?: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const params = await searchParams;
  const clubs = (await listClubsForArea()).map((club) => ({ id: club.organizationId, name: club.name }));
  const clubYear = resolveAreaClubYear(params.year);
  const requested = params.club;
  const found = Boolean(requested) && clubs.some((club) => club.id === requested);
  const initialClubIds = found && requested ? [requested] : [];
  const missing = Boolean(requested) && !found;
  return (
    <>
      <CoordinatorDestinationHeading clubYear={clubYear} title="Export rosters" />
      <p className="quiet-copy">Every download is logged. Birth dates and contact details are never included.</p>
      <RosterExportBuilder coordinator={{ clubs, initialClubIds, clubYear, ...(missing ? { startPicking: true, notice: "That club isn't available. Choose clubs below." } : {}) }} />
    </>
  );
}
