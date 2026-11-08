import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { ClubRosterHealthTable, RosterHealthCountList } from "@/components/club-roster-health";
import { loadRosterHealth } from "@/modules/club-features/roster-health";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { yearLabel } from "@/modules/club-rosters/home-view";

export const metadata: Metadata = { title: "Roster health" };
export const dynamic = "force-dynamic";

/**
 * The optional roster health list (#1709): who on this year's roster has an old record or is missing an emergency
 * contact, a health record, a photo release or a Sterling Volunteers check. Only the club's director and deputy, and only
 * while the club has switched it on in Club settings; anyone else, and a club that has not, gets "not found". It says only
 * that something is missing or old, never what a record holds.
 */
export default async function ClubRosterHealthPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  const list = await loadRosterHealth(organizationId, access.capabilities);
  if (!list) notFound();
  const base = `/account/clubs/${organizationId}`;
  return (
    <>
      <BackLink href={`${base}/roster`}>Back to the roster</BackLink>
      <section aria-labelledby="roster-health-heading" className="public-manage-card">
        <div className="public-manage-card-heading">
          <p className="public-registration-eyebrow">{`Club year ${yearLabel(list.clubYear)}`}</p>
          <h2 id="roster-health-heading">Roster health</h2>
        </div>
        <p className="quiet-copy">
          Active people on the roster with something missing or out of date. A record counts as out of date when nobody has
          edited the person or their emergency contacts for over a year. This only says that something is missing; open the
          roster to add it. You can turn this off in <a href={`${base}/club-info#club-optional-features`}>Club settings</a>.
        </p>
        <RosterHealthCountList counts={list.counts} />
        {list.notChecked.map((item) => <p className="inline-notice" key={item.flag}>{item.reason}</p>)}
      </section>
      <ClubRosterHealthTable rows={list.rows} />
    </>
  );
}
