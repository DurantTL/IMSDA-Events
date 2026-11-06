import type { Metadata } from "next";
import { ClubSetupHelp } from "@/components/role-setup-help";
import { redirect } from "next/navigation";
import { UsersRound } from "lucide-react";
import { PortalClubDirectory } from "@/components/portal-club-directory";
import { coordinatorClubsPath, portalClubDirectory } from "@/modules/club-rosters/portal-directory";
import { parseClubQuery } from "@/modules/club-reports/area-summary-domain";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { attendeeSignInRedirectPath, twoStepRedirectPath } from "@/modules/attendee-accounts/return-redirect";
import { attendeeSecondStepPending } from "@/modules/attendee-accounts/portal-second-step";
import { isAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";
import { AccountPageBanner } from "@/components/account-page-banner";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My clubs",
  robots: { index: false, follow: false, nocache: true },
};

export default async function MyClubsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; page?: string | string[] }> }) {
  const { account } = await getCurrentAttendee();
  const acting = await currentStaffActingContext();
  if (!account && !acting) redirect(await attendeeSignInRedirectPath());

  // A staff "act as" director (#442) has nowhere else to go but their one
  // club: no attendee account, so no clubs list to show.
  if (acting?.role === "CLUB_DIRECTOR" && acting.organizationId) {
    redirect(`/account/clubs/${acting.organizationId}`);
  }

  // Acting as an Area Coordinator resolves from the staff session alone: an
  // attendee account on this browser that hasn't passed its second step is
  // left out rather than sending the page to /account/two-step. Without an
  // act-as, the attendee's own clubs need that step as always.
  const secondStepPending = account ? await attendeeSecondStepPending() : false;
  if (secondStepPending && !acting) redirect(await twoStepRedirectPath());
  const ownAccount = secondStepPending ? null : account;
  const [clubs, areaCoordinator] = ownAccount
    ? await Promise.all([listDirectedClubs(ownAccount.id), isAreaCoordinator(ownAccount.id)])
    : [[], false];
  const params = await searchParams;
  const query = parseClubQuery(params.q);
  // The coordinator's club list is Club coordination > Overview > Clubs at a glance (#1551). Old links to this page carry
  // a search over; a coordinator who directs clubs gets the same My club pages as any director.
  if (acting?.role === "AREA_COORDINATOR" || (areaCoordinator && clubs.length === 0)) {
    redirect(coordinatorClubsPath(query));
  }
  const page = Number(Array.isArray(params.page) ? params.page[0] : params.page ?? 1);
  const own = new Map(clubs.map((club) => [club.organizationId, club.role]));
  // Most directors run one club: take them straight to it.
  if (clubs.length === 1) redirect(`/account/clubs/${clubs[0].organizationId}`);

  return (
    <>
      <AccountPageBanner title="My clubs" context="Club ministries" />
      <div className="account-page-body">
        <section className="public-manage-card">
          {clubs.length === 0 ? (
            <>
            <p className="public-manage-empty">
              <UsersRound size={17} aria-hidden="true" /> You aren&apos;t a director of a club right now. The conference
              office adds club directors.
            </p>
            <ClubSetupHelp base="/account/clubs" context="your clubs" id="no-clubs" />
            </>
          ) : (
            <PortalClubDirectory slice={portalClubDirectory(clubs, own, query, page)} query={query} total={clubs.length} searchLabel="Search by club or church" />
          )}
        </section>
      </div>
    </>
  );
}
