import { notFound } from "next/navigation";
import { Eye } from "lucide-react";
import { YearBox } from "@/components/club-banner-year";
import { ClubPortalNav } from "@/components/club-portal-nav";
import { AreaClubSwitcher } from "@/components/area-club-switcher";
import styles from "@/components/area-club-switcher.module.css";
import { BackLink } from "@/components/back-link";
import { ClubBannerTools } from "@/components/club-portal-search";
import searchStyles from "@/components/club-portal-search.module.css";
import { CoordinatorBannerSearch } from "@/components/coordinator-banner-search";
import { CoordinatorShellHeader } from "@/components/coordinator-shell-header";
import { currentOwnDirectedClubIds } from "@/modules/organizations/own-directed-club-ids";
import { getPrisma } from "@/lib/prisma";
import { areaViewedClubNavItems } from "@/modules/club-rosters/portal-nav";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { currentAreaCoordinatorViewerActive, requireSecondStepForAreaCoordinator } from "@/modules/organizations/area-coordinators";

/**
 * An Area Coordinator's view of one club (#722, #1555): the club home's navy band and
 * one tab row, in a view-only form. Like the director's layout it is only chrome;
 * every page below checks access itself (a layout is not a security boundary).
 */
export default async function AreaClubLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  if (!(await currentAreaCoordinatorViewerActive())) {
    // A coordinator without a real second step in this session is sent to the club gate, not shown a 404 (#1410).
    await requireSecondStepForAreaCoordinator();
    notFound();
  }
  const { organizationId } = await params;
  const club = await getPrisma().organization.findUnique({
    where: { id: organizationId },
    select: { type: true, name: true, isActive: true, parentOrganization: { select: { name: true } } },
  });
  if (!club || club.type !== "CLUB" || !club.isActive) notFound();
  // The switcher's list: the same scope the coordinator already sees (every active club), name and parent church only (#1759).
  const ownClubIds = await currentOwnDirectedClubIds();
  const switchable = (await getPrisma().organization.findMany({
    where: { type: "CLUB", isActive: true },
    select: { id: true, name: true, parentOrganization: { select: { name: true } } },
    orderBy: { name: "asc" },
  })).map((entry) => ({ id: entry.id, name: entry.name, church: entry.parentOrganization?.name ?? null }));

  return (
    <>
      <CoordinatorShellHeader nav={<ClubPortalNav items={areaViewedClubNavItems({ organizationId })} label="Club" menuLabel="Club menu" />}>
        {/* The club home's navy band (club-banner in globals.css): the club's name and parent organization, the coordinator's view-only role and the club year. */}
        <section aria-label={`${club.name}, view only`} className="club-banner">
          <div className={`club-banner-inner ${searchStyles.bannerInner}`}>
            <div className="club-banner-identity">
              <h1 title={club.name} translate="no">{club.name}</h1>
              <p className={searchStyles.viewedSubtitle}>
                {club.parentOrganization && <span className={searchStyles.viewedChurch} title={club.parentOrganization.name}><span translate="no">{club.parentOrganization.name}</span>&nbsp;·&nbsp;</span>}
                <span className={searchStyles.viewedRole}>Area Coordinator · view only</span>
              </p>
            </div>
            <ClubBannerTools>
              <YearBox label="Current club year" value={clubYearFor(new Date()).replace("-", "\u2013")} />
              <CoordinatorBannerSearch />
            </ClubBannerTools>
          </div>
        </section>
      </CoordinatorShellHeader>
      <div className="club-roster-layout area-club-layout">
        <div className={`area-club-top ${styles.row}`}>
          <BackLink href="/account/area-clubs/clubs">All clubs</BackLink>
          <AreaClubSwitcher clubs={switchable} currentId={organizationId} ownClubIds={ownClubIds} />
        </div>
        <p className="inline-notice" role="status">
          <Eye aria-hidden="true" size={14} /> View only. You see what the club&apos;s director sees, with ages instead of
          birth dates, plus each adult&apos;s Sterling Volunteers status and note. The club&apos;s director maintains the
          roster and the club&apos;s settings, so ask the director for any change.
        </p>
        {children}
      </div>
    </>
  );
}
