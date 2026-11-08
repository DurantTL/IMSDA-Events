import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { RosterHealthCountList } from "@/components/club-roster-health";
import type { RosterHealthCounts } from "@/modules/club-features/domain";

/**
 * The optional roster health counts on the club Home (#1709). Rendered only when the club has switched the feature on
 * and the viewer is its director or deputy; a club that has not never gets this section. Counts only, no names.
 */
export function ClubHomeRosterHealth({ counts, href }: { counts: RosterHealthCounts; href: string }) {
  return (
    <section aria-labelledby="club-home-roster-health-heading" className="public-manage-card">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Optional</p>
        <h2 id="club-home-roster-health-heading">Roster health</h2>
      </div>
      <RosterHealthCountList counts={counts} />
      <p>
        <Link className="secondary-button club-event-action" href={href}>
          Open roster health <ArrowRight aria-hidden="true" size={14} />
        </Link>
      </p>
    </section>
  );
}
