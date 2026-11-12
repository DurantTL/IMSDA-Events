import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoordinatorDestinationHeading } from "@/components/coordinator-destinations";
import { RecordsExportBuilder } from "@/components/records-export-builder";
import { resolveAreaClubYear } from "@/modules/club-reports/area-club-year";
import { clubYearMonths, reportMonthLabel } from "@/modules/club-reports/domain";
import { currentAreaCoordinatorClubKinds, listClubsForArea } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Export Monthly Records", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Export Monthly Records for an Area Coordinator (#1761): choose clubs, a month range, a layout and columns, preview
 * the first rows, download a CSV. Club-level figures only. Same gate as the other Clubs pages.
 */
export default async function AreaRecordsExportPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  // Layouts do not re-run on navigation, so every page checks for itself (#657).
  const kinds = await currentAreaCoordinatorClubKinds();
  if (!kinds) notFound();
  const params = await searchParams;
  const clubYear = resolveAreaClubYear(params.year);
  const clubs = (await listClubsForArea(kinds)).map((club) => ({ id: club.organizationId, name: club.name }));
  const months = clubYearMonths(clubYear).map((value) => ({ value, label: reportMonthLabel(value) }));
  return (
    <>
      <CoordinatorDestinationHeading clubYear={clubYear} title="Export Monthly Records" />
      <p className="quiet-copy">Every download is logged. The file holds club-level points and statuses and, only if you choose it, the club&apos;s director names. It never holds members, signers, attendance or Sterling data.</p>
      <RecordsExportBuilder clubYear={clubYear} clubs={clubs} months={months} />
    </>
  );
}
