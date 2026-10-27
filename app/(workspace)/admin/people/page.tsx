import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActAsButton } from "@/components/act-as-button";
import { AdminPageHeader } from "@/components/admin-page-header";
import { PeopleDirectory } from "@/components/people-directory";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { searchPeople } from "@/modules/system-admin/people-directory";
import { parsePeoplePage, parsePeopleQuery } from "@/modules/system-admin/people-directory-model";

export const metadata: Metadata = { title: "People & access" };
export const dynamic = "force-dynamic";

export default async function PeopleAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const viewer = await resolvePeopleViewer();
  if (!viewer.user) redirect(await staffLoginRedirectPath());
  if (!viewer.scope) redirect("/no-access");
  // Search and page live in the URL, so a reload or shared link keeps them.
  const params = await searchParams;
  const query = parsePeopleQuery(params.q);
  const result = await searchPeople(query, parsePeoplePage(params.page), viewer.scope);
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
      <PeopleDirectory scope={viewer.scope} page={result.page} pageCount={result.pageCount} query={query} rows={result.rows} total={result.total} />
    </>
  );
}
