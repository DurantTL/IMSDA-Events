import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  StaffApplicationLinks,
  StaffApplicationList,
  StaffApplicationMissing,
  StaffApplicationRecord,
  applicationBackLink,
  StaffApplicationViews,
  StaffApplicationsIntro,
} from "@/components/staff-club-applications";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import {
  countWaitingNewClubApplications,
  getNewClubApplication,
  listNewClubApplications,
  listNewClubInvites,
  listPublicSponsorOptions,
} from "@/modules/club-applications/repository";
import { parseApplicationId, parseApplicationView, viewOfApplication } from "@/modules/club-applications/queue-model";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { AdminPageHeader } from "@/components/admin-page-header";
import { StaffVisitingIntro, StaffVisitingMissing, StaffVisitingRecord, StaffVisitingView, visitingBackLink } from "@/components/staff-visiting-clubs";
import {
  getVisitingClubRequest,
  listVisitingClubEventOptions,
  listVisitingClubInvites,
  listVisitingClubRequests,
} from "@/modules/visiting-clubs/repository";

export const metadata: Metadata = { title: "New club applications" };
export const dynamic = "force-dynamic";

/**
 * The new club application queue (#817, #1589) for system administrators and Clubs Administrators,
 * who approve and decline. `?status=` picks Waiting (the default), Decided or Private links;
 * `?application=<id>` shows one application in full, where the decision is made. Area Coordinators read
 * the same applications, view only, from their Clubs menu.
 */
export default async function NewClubApplicationsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; application?: string | string[]; visiting?: string | string[] }>;
}) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const viewer = user.globalRole === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN" : "CLUBS_ADMIN";
  const query = await searchParams;
  const applicationId = parseApplicationId(query.application);
  const visitingId = parseApplicationId(query.visiting);
  const showSettingsLink = viewer === "SYSTEM_ADMIN";

  // One visiting club request on its own (#835), where Approve and Decline live.
  if (visitingId) {
    const request = await getVisitingClubRequest(user, visitingId);
    return (
      <>
        <AdminPageHeader back={visitingBackLink} path="/admin/clubs/applications" />
        {request ? <StaffVisitingRecord request={request} /> : <StaffVisitingMissing />}
      </>
    );
  }

  if (applicationId) {
    const [application, churches] = await Promise.all([getNewClubApplication(viewer, applicationId), listPublicSponsorOptions()]);
    const requested = parseApplicationView(query.status);
    return (
      <>
        <AdminPageHeader
          back={applicationBackLink(application ? viewOfApplication(application.status) : requested === "decided" ? "decided" : "waiting")}
          path="/admin/clubs/applications"
        />
        {application
          ? <StaffApplicationRecord application={application} churches={churches} />
          : <StaffApplicationMissing />}
      </>
    );
  }

  const view = parseApplicationView(query.status);
  if (view === "visiting") {
    const [events, invites, requests, waitingCount] = await Promise.all([
      listVisitingClubEventOptions(user),
      listVisitingClubInvites(user),
      listVisitingClubRequests(user),
      countWaitingNewClubApplications(viewer),
    ]);
    return (
      <>
        <AdminPageHeader path="/admin/clubs/applications" />
        <section className="page-stack">
          <StaffVisitingIntro />
          <StaffApplicationViews view={view} waitingCount={waitingCount} />
          <StaffVisitingView canOpenSetup={viewer === "SYSTEM_ADMIN"} emailConfigured={isAccountEmailConfigured()} events={events} invites={invites} requests={requests} />
        </section>
      </>
    );
  }
  const [applications, invites, waitingCount] = await Promise.all([
    view === "links" ? [] : listNewClubApplications(viewer, new Date(), view),
    view === "links" ? listNewClubInvites(viewer) : [],
    countWaitingNewClubApplications(viewer),
  ]);
  return (
    <>
      <AdminPageHeader path="/admin/clubs/applications" />
      <section className="page-stack">
        <StaffApplicationsIntro showSettingsLink={showSettingsLink} />
        <StaffApplicationViews view={view} waitingCount={waitingCount} />
        {view === "links"
          ? <StaffApplicationLinks emailConfigured={isAccountEmailConfigured()} invites={invites} />
          : <StaffApplicationList applications={applications} view={view} />}
      </section>
    </>
  );
}
