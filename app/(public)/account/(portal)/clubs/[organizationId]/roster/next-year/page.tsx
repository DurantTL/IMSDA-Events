import type { Metadata } from "next";
import { ClubSetupHelp } from "@/components/role-setup-help";
import { BackLink } from "@/components/back-link";
import { ClubRosterCarryForward } from "@/components/club-roster-carry-forward";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { getCarryForwardOffer } from "@/modules/club-rosters/carry-forward";
import { clubAccessClosed } from "@/components/club-access-closed";

export const metadata: Metadata = { title: "Start next year's roster" };
export const dynamic = "force-dynamic";

/**
 * Starting a club's next year roster (#414). Director or deputy only. Nothing
 * rolls over by itself: this page only lists last year's active people, and
 * only the director's confirmation carries anyone.
 */
export default async function ClubRosterNextYearPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  const rosterHref = `/account/clubs/${organizationId}/roster`;
  if (!access.capabilities.manageTeam) {
    return (
      <>
        <BackLink href={rosterHref}>Back to roster</BackLink>
        <p className="inline-notice" role="status">Your club role doesn&apos;t include starting a new year. Ask your club director.</p>
        <ClubSetupHelp base={`/account/clubs/${organizationId}`} context="starting a new year" id="next-year-role" />
      </>
    );
  }
  const offer = await getCarryForwardOffer(organizationId);
  return (
    <>
      <BackLink href={rosterHref}>Back to roster</BackLink>
      <section className="public-manage-card page-stack">
        <h2>Start the {offer.toClubYear} roster</h2>
        <p className="field-help">Carries people from the {offer.fromClubYear} roster to the {offer.toClubYear} roster.</p>
        {offer.state === "DONE" && (
          <p className="inline-notice success" role="status">
            This club already started its {offer.toClubYear} roster. <a href={`${rosterHref}?year=${encodeURIComponent(offer.toClubYear)}`}>Open it</a>.
          </p>
        )}
        {offer.state === "NOTHING_TO_CARRY" && (
          <p className="inline-notice" role="status">
            There is no one left on the {offer.fromClubYear} roster to carry forward. Add people to the new roster from the roster page.
          </p>
        )}
        {offer.state === "AVAILABLE" && (
          <ClubRosterCarryForward
            fromClubYear={offer.fromClubYear}
            organizationId={organizationId}
            rows={offer.candidates}
            toClubYear={offer.toClubYear}
          />
        )}
      </section>
    </>
  );
}
