import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActAsButton } from "@/components/act-as-button";
import { AdminPageHeader } from "@/components/admin-page-header";
import { InvitePerson } from "@/components/invite-person";
import { PeopleDirectory } from "@/components/people-directory";
import { PendingInvites } from "@/components/pending-invites";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { listClubOptions, listEventOptions, searchPeople } from "@/modules/system-admin/people-directory";
import { PENDING_INVITES_CAP, listPendingInvites } from "@/modules/system-admin/pending-invites";
import { keepKnownFilterIds, peopleFilterCount, parsePeopleFilters, parsePeoplePage, parsePeopleQuery } from "@/modules/system-admin/people-directory-model";

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
    keepRole?: string | string[];
    keepEvent?: string | string[];
    keepClub?: string | string[];
  }>;
}) {
  const viewer = await resolvePeopleViewer();
  if (!viewer.user) redirect(await staffLoginRedirectPath());
  if (!viewer.scope) redirect("/no-access");
  // Search and page live in the URL, so a reload or shared link keeps them.
  const params = await searchParams;
  const query = parsePeopleQuery(params.q);
  const parsed = parsePeopleFilters(params, viewer.scope);
  const full = viewer.scope === "full";
  // Options are loaded first so an event or club the viewer cannot choose is dropped from the filter (#1321).
  const [eventOptions, clubOptions] = await Promise.all([full ? listEventOptions() : [], listClubOptions()]);
  const filters = keepKnownFilterIds(parsed, eventOptions, clubOptions);
  // Pending invites (#1276) show above the list when no role filter is on, and are the list when it is the only role (#1277).
  const pendingOnly = filters.roles.length === 1 && filters.roles[0].kind === "pending";
  const showPending = peopleFilterCount(filters) === 0 || pendingOnly;
  const [result, pending] = await Promise.all([
    pendingOnly
      ? { rows: [], page: 1, pageCount: 1, total: 0 }
      : searchPeople(query, parsePeoplePage(params.page), viewer.scope, filters),
    showPending ? listPendingInvites({ query, scope: viewer.scope }) : { invites: [], emailConfigured: false },
  ]);
  return (
    <>
      <AdminPageHeader path="/admin/people" />
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
        filters={filters}
        eventOptions={eventOptions}
        clubOptions={clubOptions}
        pending={<PendingInvites emailConfigured={pending.emailConfigured} invites={pending.invites} />}
        pendingCount={pending.invites.length}
        pendingCapped={pending.invites.length >= PENDING_INVITES_CAP}
        page={result.page} pageCount={result.pageCount} query={query} rows={result.rows} total={result.total}
      />
    </>
  );
}
