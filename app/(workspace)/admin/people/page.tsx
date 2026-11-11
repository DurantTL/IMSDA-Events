import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { ListPage } from "@/components/page-templates/list-page";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AreaCoordinatorImport } from "@/components/area-coordinator-import";
import { ActAsButton } from "@/components/act-as-button";
import { AdminPageHeader } from "@/components/admin-page-header";
import { InvitePerson } from "@/components/invite-person";
import { sliceFromCount } from "@/lib/pagination";
import styles from "@/components/people-directory.module.css";
import { PeopleDirectory } from "@/components/people-directory";
import { PendingInvites } from "@/components/pending-invites";
import { countPendingAreaCoordinatorInvites } from "@/modules/organizations/area-coordinator-invites";
import { resolvePeopleViewer } from "@/modules/system-admin/people-access";
import { listClubOptions, listEventOptions, searchPeople } from "@/modules/system-admin/people-directory";
import { listPendingInvitesPage } from "@/modules/system-admin/pending-invites";
import { keepKnownFilterIds, peopleFilterCount, parsePeopleFilters, parsePeoplePage, parsePeopleQuery } from "@/modules/system-admin/people-directory-model";

export const metadata: Metadata = { title: "People & access" };
export const dynamic = "force-dynamic";

export default async function PeopleAccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
    pendingPage?: string | string[];
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
  const [result, pending, waitingAreaInvites] = await Promise.all([
    pendingOnly
      ? { rows: [], page: 1, pageCount: 1, total: 0 }
      : searchPeople(query, parsePeoplePage(params.page), viewer.scope, filters),
    showPending ? listPendingInvitesPage({ query, scope: viewer.scope }, parsePeoplePage(params.pendingPage)) : { invites: [], emailConfigured: false, total: 0, page: 1, pageSize: 1 },
    full ? countPendingAreaCoordinatorInvites() : 0,
  ]);
  return (
    <>
      <AdminPageHeader path="/admin/people" />
      <ListPage
        header={{
          title: "People & access",
          description: full
            ? "Everyone with a staff login or a website account, and what each person can reach."
            : "Club people: club directors and club staff, Area Coordinators and Clubs Administrators, and the club roles each one holds.",
          primary: <InvitePerson clubOptions={clubOptions} eventOptions={eventOptions} scope={viewer.scope} />,
          // One filled action (Invite a person) and one outlined button. The Area Coordinator import stays a quiet row under the title.
          secondary: (
            /* Both scopes (system administrator "full", Clubs Administrator "clubs") match the start route's `requireClubsAdministration` (Caleb, 2026-11-06). */
            <ActAsButton
              access="View only"
              endpoint="/api/admin/act-as/area-coordinator"
              label="Act as Area Coordinator (2 hours)"
              origin="people"
              resultAction="Open the Area Coordinator portal"
              role="Area Coordinator"
            />
          ),
          below: full ? <div className={styles.headerTools}><AreaCoordinatorImport pendingCount={waitingAreaInvites} /></div> : undefined,
        }}
      >
        <PeopleDirectory
          scope={viewer.scope}
          filters={filters}
          eventOptions={eventOptions}
          clubOptions={clubOptions}
          pending={<PendingInvites emailConfigured={pending.emailConfigured} invites={pending.invites} />}
          pendingCount={pending.total}
          pendingPage={pending.page}
          pendingSlice={pending.total > 0 ? sliceFromCount(pending.invites, pending.page, pending.total, pending.pageSize) : undefined}
          page={result.page} pageCount={result.pageCount} query={query} rows={result.rows} total={result.total}
        />
      </ListPage>
    </>
  );
}
