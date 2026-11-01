import type { Metadata } from "next";
import { ClubSetupHelp } from "@/components/role-setup-help";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, UsersRound } from "lucide-react";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { attendeeSecondStepPending } from "@/modules/attendee-accounts/portal-second-step";
import { attendeeSignInRedirectPath, twoStepRedirectPath } from "@/modules/attendee-accounts/return-redirect";
import { clubChooseDestination, isClubChooseKey } from "@/modules/club-forms/public-index-domain";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import { clubDirectorRoleLabels } from "@/modules/organizations/director-grants-domain";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";
import { firstParam } from "@/lib/search-params";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose your club",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Where the public Club forms list sends a director (#1221). `?to=` is a key from a fixed allowlist
 * (`clubChooseTargets`), never a path, so this page cannot redirect anywhere else. Signed out goes to sign-in and
 * back here; one club goes straight to the form; several show a short picker; none says so. The club's own pages
 * check the person's role again.
 */
export default async function ChooseClubPage({ searchParams }: { searchParams: Promise<{ to?: string | string[] }> }) {
  const rawTo = (await searchParams).to;
  const to = firstParam(rawTo);
  if (!isClubChooseKey(to)) notFound();

  const { account } = await getCurrentAttendee();
  const acting = await currentStaffActingContext();
  if (!account && !acting) redirect(await attendeeSignInRedirectPath());

  if (acting?.role === "CLUB_DIRECTOR" && acting.organizationId) {
    redirect(clubChooseDestination(acting.organizationId, to)!);
  }

  const secondStepPending = account ? await attendeeSecondStepPending() : false;
  if (secondStepPending && !acting) redirect(await twoStepRedirectPath());
  const clubs = account && !secondStepPending ? await listDirectedClubs(account.id) : [];
  if (clubs.length === 1) redirect(clubChooseDestination(clubs[0].organizationId, to)!);

  return (
    <>
      <section className="public-registration-hero public-manage-hero account-page-hero">
        <div>
          <p className="public-registration-eyebrow">Club forms</p>
          <h1>Choose your club</h1>
        </div>
      </section>
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
            <ul className="public-manage-club-list">
              {clubs.map((club) => (
                <li key={club.organizationId}>
                  <UsersRound size={17} aria-hidden="true" />
                  <span>
                    <strong translate="no">{club.name}</strong>
                    <small>
                      {clubDirectorRoleLabels[club.role]}
                      {club.sponsoringChurch && <> · <span translate="no">{club.sponsoringChurch}</span></>}
                    </small>
                  </span>
                  <Link className="primary-button club-event-action" href={clubChooseDestination(club.organizationId, to)!}>
                    Open <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
