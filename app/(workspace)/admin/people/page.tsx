import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActAsButton } from "@/components/act-as-button";
import { InvitePerson } from "@/components/invite-person";
import { PeopleDirectory } from "@/components/people-directory";
import { PendingInvites } from "@/components/pending-invites";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { listClubOptions, listEventOptions, searchPeople } from "@/modules/system-admin/people-directory";
import { listPendingInvites } from "@/modules/system-admin/pending-invites";
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
  const full = viewer.scope === "full";
  const [result, pending, eventOptions, clubOptions] = await Promise.all([
    searchPeople(query, parsePeoplePage(params.page), viewer.scope),
    listPendingInvites({ query, scope: viewer.scope }),
    full ? listEventOptions() : [],
    listClubOptions(),
  ]);
  return (
    <>
      <StaffPageHeader
        description="Everyone with a staff login or a website account, and what each person can reach."
        primary={(
          <>
            <InvitePerson clubOptions={clubOptions} eventOptions={eventOptions} scope={viewer.scope} />
            {viewer.scope === "full" ? (
              <ActAsButton
                access="View only"
                endpoint="/api/admin/act-as/area-coordinator"
                label="Act as Area Coordinator (2 hours)"
                resultAction="Open the coordinator view"
                role="Area Coordinator"
              />
            ) : null}
          </>
        )}
      />
      <PeopleDirectory
        scope={viewer.scope}
        page={result.page}
        pageCount={result.pageCount}
        pending={<PendingInvites emailConfigured={pending.emailConfigured} invites={pending.invites} />}
        query={query}
        rows={result.rows}
        total={result.total}
      />
    </>
  );
}
