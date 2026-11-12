import { CoordinatorBannerYear } from "@/components/coordinator-banner-year";
import { currentTltDirector } from "@/modules/tlt-directory/access";
import { clubYearFor } from "@/modules/club-rosters/domain";

/** The club director's navy banner (club-banner in globals.css) for the coordinator pages, so both portals' headers look the same (#1554, #1555). */
export async function CoordinatorBanner() {
  // The TLT director (#1686) can edit in the TLT directory, so "view only" would not be true for her. Everyone else keeps the old line.
  const tltDirector = Boolean(await currentTltDirector());
  return (
    <section aria-label="Area Coordinator" className="club-banner">
      <div className="club-banner-inner">
        <div className="club-banner-identity">
          <h1>Club coordination</h1>
          <p>{tltDirector ? "Area Coordinator · view only, except the TLT directory" : "Area Coordinator · view only"}</p>
        </div>
        <CoordinatorBannerYear currentYear={clubYearFor(new Date())} />
      </div>
    </section>
  );
}
