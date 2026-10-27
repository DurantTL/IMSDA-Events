import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActAsButton } from "@/components/act-as-button";
import { AdminPageHeader } from "@/components/admin-page-header";
import { PeopleDirectory } from "@/components/people-directory";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { listClubOptions, listEventOptions, searchPeople } from "@/modules/system-admin/people-directory";
import { pagePeople, parsePeopleFilters, parsePeoplePage, parsePeopleQuery } from "@/modules/system-admin/people-directory-model";
import { listPendingPeople } from "@/modules/system-admin/pending-people";

export const metadata: Metadata = { title: "People & access" };
export const dynamic = "force-dynamic";

export default async function PeopleAccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
    role?: string | string[];
    event?: string | string[];
    club?: string | string[];
  }>;
}) {
  const viewer = await resolvePeopleViewer();
  if (!viewer.user) redirect(await staffLoginRedirectPath());
  if (!viewer.scope) redirect("/no-access");
  // Search and page live in the URL, so a reload or shared link keeps them.
  const params = await searchParams;
  const query = parsePeopleQuery(params.q);
  const filters = parsePeopleFilters(params, viewer.scope);
  const pageNumber = parsePeoplePage(params.page);
  const pendingList = filters.role?.kind === "pending" ? await listPendingPeople(viewer.scope, query) : null;
  const pendingPage = pendingList ? pagePeople(pendingList, pageNumber) : null;
  const [result, eventOptions, clubOptions] = await Promise.all([
    pendingPage
      ? Promise.resolve({ items: [], rows: [], page: pendingPage.page, pageCount: pendingPage.pageCount, total: pendingPage.total, pageSize: pendingPage.pageSize })
      : searchPeople(query, pageNumber, viewer.scope, filters),
    viewer.scope === "full" ? listEventOptions() : Promise.resolve([]),
    listClubOptions(),
  ]);
  return (
    <>
      <AdminPageHeader path="/admin/people" />
      <StaffPageHeader
        description="Everyone with a staff login or a website account, and what each person can reach."
        primary={viewer.scope === "full" ? (
          <ActAsButton
            access="View only"
            endpoint="/api/admin/act-as/area-coordinator"
            label="Act as Area Coordinator (2 hours)"
            resultAction="Open the coordinator view"
            role="Area Coordinator"
          />
        ) : undefined}
      />
      <PeopleDirectory
        scope={viewer.scope}
        filters={filters}
        eventOptions={eventOptions}
        clubOptions={clubOptions}
        pending={pendingPage?.items ?? []}
        page={result.page} pageCount={result.pageCount} query={query} rows={result.rows} total={result.total}
      />
    </>
  );
}
