import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { ClubRosterCharts } from "@/components/club-roster-charts";
import { loadRosterCharts } from "@/modules/club-roster-charts/repository";
import { conferenceMonthOf, parseBirthdayMonth } from "@/modules/club-roster-charts/domain";
import { actorAttribution, getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { yearLabel } from "@/modules/club-rosters/home-view";

export const metadata: Metadata = { title: "Roster charts" };
export const dynamic = "force-dynamic";

/**
 * The optional roster charts and birthdays page (#1704): counts of the active roster by class, school grade and member
 * type, and meeting attendance over the club year. The club's director and deputy also see age groups and the month's
 * birthdays (month and day only); a registrar sees the counts and nothing about ages. A reporter has no roster access.
 * Only while the club has switched it on in Club settings; anyone else, and a club that has not, gets "not found".
 */
export default async function ClubRosterChartsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const [{ organizationId }, { month: monthParam }] = await Promise.all([params, searchParams]);
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  const view = await loadRosterCharts(organizationId, access.capabilities, { month: parseBirthdayMonth(monthParam, conferenceMonthOf(new Date())), actor: actorAttribution(access.actor) });
  if (!view) notFound();
  const base = `/account/clubs/${organizationId}`;
  return (
    <>
      <BackLink href={`${base}/roster`}>Back to the roster</BackLink>
      <section aria-labelledby="roster-charts-heading" className="public-manage-card">
        <div className="public-manage-card-heading">
          <p className="public-registration-eyebrow">{`Club year ${yearLabel(view.clubYear)}`}</p>
          <h2 id="roster-charts-heading">Roster charts</h2>
        </div>
        <p className="quiet-copy">
          Counts of the active people on your roster this club year. Each chart has a table you can open under it. Nothing is
          stored or sent.
          {access.capabilities.editProfile && <> You can turn this off in <a href={`${base}/club-info#club-optional-features`}>Club settings</a>.</>}
        </p>
        <ClubRosterCharts action={`${base}/charts`} view={view} />
      </section>
    </>
  );
}
