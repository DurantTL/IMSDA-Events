import { ClubBannerTools } from "@/components/club-portal-search";
import searchStyles from "@/components/club-portal-search.module.css";
import { CoordinatorBannerSearch } from "@/components/coordinator-banner-search";
import { CoordinatorBannerYear } from "@/components/coordinator-banner-year";
import { currentTltDirector } from "@/modules/tlt-directory/access";
import { clubYearFor } from "@/modules/club-rosters/domain";

/**
 * The club director's navy banner (club-banner in globals.css) for the coordinator pages, so both portals' headers look the same (#1554, #1555).
 * The search button (#1854) sits beside the club year, as in the club banner.
 */
export async function CoordinatorBanner() {
  // The TLT director (#1686) can edit in the TLT directory, so "view only" would not be true for her. Everyone else keeps the old line.
  const tltDirector = Boolean(await currentTltDirector());
  return (
    <section aria-label="Area Coordinator" className="club-banner">
      <div className={`club-banner-inner ${searchStyles.bannerInner}`}>
        <div className="club-banner-identity">
          <h1>Club coordination</h1>
          <p>{tltDirector ? "Area Coordinator · view only, except the TLT directory" : "Area Coordinator · view only"}</p>
        </div>
        <ClubBannerTools>
          <CoordinatorBannerYear currentYear={clubYearFor(new Date())} />
          <CoordinatorBannerSearch />
        </ClubBannerTools>
      </div>
    </section>
  );
}
