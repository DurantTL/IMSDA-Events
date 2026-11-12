import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { NavigationLink as Link } from "@/components/navigation-link";
import { TltFormsInbox } from "@/components/tlt-forms-inbox";
import { sliceFromCount } from "@/lib/pagination";
import { currentTltFormsViewer } from "@/modules/tlt-directory/access";
import { readTltFormsInbox, recordTltFormsInboxView } from "@/modules/tlt-directory/forms";
import { parseTltFormsFilters } from "@/modules/tlt-directory/forms-domain";

export const metadata: Metadata = { title: "TLT forms", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Every submitted TLT Application, TLT Program Recommendation and TLT of the Year, from all clubs (#1686), for the TLT
 * director only. Anyone else, including a system administrator acting as a coordinator, gets "not found" before any form
 * is read. Layouts do not re-run on navigation, so the page checks for itself.
 */
export default async function TltFormsInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await currentTltFormsViewer();
  if (!viewer) notFound();
  const query = await searchParams;
  const filters = parseTltFormsFilters(query);
  const requestedPage = Number(Array.isArray(query.page) ? query.page[0] : query.page);
  const inbox = await readTltFormsInbox(viewer, filters, requestedPage);
  const slice = sliceFromCount(inbox.rows, inbox.page, inbox.total, inbox.pageSize);
  await recordTltFormsInboxView(viewer, { filters, shown: inbox.rows.length, matching: inbox.total, page: inbox.page });
  return (
    <section className="public-manage-card page-stack">
      <CoordinatorSectionHeading eyebrow="TLT director" title="TLT forms">
        <p>Every submitted TLT Application, TLT Program Recommendation and TLT of the Year nomination, from all clubs, newest first. Opening one shows every answer, health and conduct included, and each opening is recorded.</p>
      </CoordinatorSectionHeading>
      <p><Link className="secondary-button" href="/account/area-clubs/tlt">Back to the TLT directory</Link></p>
      <TltFormsInbox clubs={inbox.clubs} filters={filters} forms={inbox.forms} slice={slice} />
    </section>
  );
}
