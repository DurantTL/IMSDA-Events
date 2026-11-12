import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountPageBanner } from "@/components/account-page-banner";
import { LeaderDirectory } from "@/components/leader-directory";
import { paginate } from "@/lib/pagination";
import { requireAttendeeSecondStep } from "@/modules/attendee-accounts/portal-second-step";
import { currentLeaderDirectoryViewer } from "@/modules/leader-directory/access";
import { parseLeaderFilters } from "@/modules/leader-directory/domain";
import { readLeaderDirectory, recordLeaderDirectoryView } from "@/modules/leader-directory/repository";

export const metadata: Metadata = { title: "Leader directory", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

/**
 * Club leaders across the conference (#1707), for club directors, deputies and Area Coordinators, and only while the
 * conference switch is on. Everyone else, including staff acting as a role, gets "not found". Layouts do not re-run on
 * navigation, so the page checks for itself, on the server.
 */
export default async function LeaderDirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // A leader who still owes the second step is sent to it, as on the other club pages (#1410).
  await requireAttendeeSecondStep();
  const viewer = await currentLeaderDirectoryViewer();
  if (!viewer) notFound();
  const query = await searchParams;
  const filters = parseLeaderFilters(query);
  const requestedPage = Number(Array.isArray(query.page) ? query.page[0] : query.page);
  const directory = await readLeaderDirectory(filters);
  const slice = paginate(directory.entries, requestedPage, PAGE_SIZE);
  await recordLeaderDirectoryView(
    { filters, shown: slice.items.length, matching: directory.entries.length, total: directory.total, page: slice.page },
    viewer,
  );
  return (
    <>
      <AccountPageBanner title="Leader directory">
        <p>Club leaders you can contact to coordinate.</p>
      </AccountPageBanner>
      <div className="account-page-body">
        <section className="public-manage-card">
          <LeaderDirectory filters={filters} slice={slice} total={directory.total} />
        </section>
      </div>
    </>
  );
}
