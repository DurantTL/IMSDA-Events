import { CoordinatorBannerYear } from "@/components/coordinator-banner-year";
import { clubYearFor } from "@/modules/club-rosters/domain";

/** The club director's navy banner (club-banner in globals.css) for the coordinator pages, so both portals' headers look the same (#1554, #1555). */
export function CoordinatorBanner() {
  return (
    <section aria-label="Area Coordinator" className="club-banner">
      <div className="club-banner-inner">
        <div className="club-banner-identity">
          <h1>Club coordination</h1>
          <p>Area Coordinator · view only</p>
        </div>
        <CoordinatorBannerYear currentYear={clubYearFor(new Date())} />
      </div>
    </section>
  );
}
