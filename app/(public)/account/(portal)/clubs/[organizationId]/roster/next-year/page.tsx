import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { ClubRosterCarryForward } from "@/components/club-roster-carry-forward";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { getCarryForwardOffer } from "@/modules/club-rosters/carry-forward";

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
  if (access.state !== "OPEN") return null;
  const rosterHref = `/account/clubs/${organizationId}/roster`;
  if (!access.capabilities.manageTeam) {
    return (
      <>
        <BackLink href={rosterHref}>Back to roster</BackLink>
        <p className="inline-notice" role="status">Your club role doesn&apos;t include starting a new year. Ask your club director.</p>
      </>
    );
  }
  const offer = await getCarryForwardOffer(organizationId);
  return (
    <>
      <BackLink href={rosterHref}>Back to roster</BackLink>
      <section className="public-manage-card page-stack">
        <h2>Start the {offer.toClubYear} roster</h2>
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
