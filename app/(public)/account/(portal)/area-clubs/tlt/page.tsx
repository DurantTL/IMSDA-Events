import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { TltDirectory } from "@/components/tlt-directory";
import { paginate } from "@/lib/pagination";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { yearLabel } from "@/modules/club-rosters/home-view";
import { currentTltDirector, currentTltFormsViewer } from "@/modules/tlt-directory/access";
import { countTltFormsByPerson } from "@/modules/tlt-directory/forms";
import { parseTltFilters } from "@/modules/tlt-directory/domain";
import { listTltLists, readTltDirectory, recordTltDirectoryView } from "@/modules/tlt-directory/repository";

export const metadata: Metadata = { title: "TLT directory", robots: { index: false, follow: false, nocache: true } };
const TLT_PAGE_SIZE = 25;
export const dynamic = "force-dynamic";

/**
 * Every TLT on a club roster this club year (#1686), for the TLT director only: an Area Coordinator with the TLT
 * director setting on and a passed second step. Anyone else, including a system administrator acting as a coordinator,
 * gets "not found". Layouts do not re-run on navigation, so the page checks for itself.
 */
export default async function TltDirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await currentTltDirector();
  if (!actor) notFound();
  const query = await searchParams;
  const filters = parseTltFilters(query);
  const requestedPage = Number(Array.isArray(query.page) ? query.page[0] : query.page);
  const now = new Date();
  const [directory, lists] = await Promise.all([readTltDirectory(filters, now), listTltLists()]);
  const slice = paginate(directory.rows, requestedPage, TLT_PAGE_SIZE);
  // The counts of TLT forms tied to each row by id (#1686): counts only, for this page's rows.
  const viewer = await currentTltFormsViewer(now);
  const formLinks = viewer ? await countTltFormsByPerson(viewer, slice.items.map((row) => row.personId)) : new Map();
  await recordTltDirectoryView({ filters, shown: slice.items.length, matching: directory.rows.length, total: directory.total, page: slice.page }, actor, now);
  return (
    <section className="public-manage-card page-stack">
      <CoordinatorSectionHeading eyebrow={`Club year ${yearLabel(clubYearFor(now))}`} title="TLT directory">
        <p>Every TLT on a club roster, across all clubs. You can change a TLT&apos;s year, position type, status and help-area tags. Roster details belong to the club director. TLT forms, answers included, are in the TLT forms inbox.</p>
      </CoordinatorSectionHeading>
      <TltDirectory clubs={directory.clubs} filters={filters} formLinks={formLinks} positions={lists.positions} slice={slice} tags={lists.tags} total={directory.total} />
    </section>
  );
}
