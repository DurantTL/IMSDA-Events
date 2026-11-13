import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { ClubCalendar } from "@/components/club-calendar";
import { parseMonthQuery } from "@/modules/club-calendar/schemas";
import { loadClubCalendar } from "@/modules/club-calendar/repository";
import { getClubRoleAccessForPage } from "@/modules/club-rosters/access";

export const metadata: Metadata = { title: "Club calendar" };
export const dynamic = "force-dynamic";

/**
 * The optional club calendar (#1700): the club's meetings, outings and deadlines for a month, listed with the conference's
 * published events. Everyone with an active role in the club (director, deputy, registrar, reporter) can see it, because
 * it holds no personal data and no roster; only the director and deputy add, change and delete, and set the reminder
 * emails. Only while the club has switched it on in Club settings; anyone else, and a club that has not, gets "not found".
 */
export default async function ClubCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const [{ organizationId }, { month }] = await Promise.all([params, searchParams]);
  const access = await getClubRoleAccessForPage(organizationId);
  if (access.state !== "OK") return clubAccessClosed(access);
  const view = await loadClubCalendar(organizationId, access.capabilities, parseMonthQuery(month));
  if (!view) notFound();
  const base = `/account/clubs/${organizationId}`;
  return (
    <>
      <BackLink href={base}>Back to club home</BackLink>
      <section aria-labelledby="club-calendar-heading" className="public-manage-card">
        <div className="public-manage-card-heading">
          <p className="public-registration-eyebrow">{access.club.name}</p>
          <h2 id="club-calendar-heading">Club calendar</h2>
        </div>
        <p className="quiet-copy">
          Your club&apos;s meetings, outings and deadlines, with the conference&apos;s published events for the same month. Times are Central time.
          {view.canManage ? " You can add, change and delete items, and choose reminder emails below." : " Your club director or deputy adds and changes items."}
          {" "}You can turn this off in <a href={`${base}/club-info#club-optional-features`}>Club settings</a>; nothing is deleted.
        </p>
        <ClubCalendar organizationId={organizationId} view={view} />
      </section>
    </>
  );
}
