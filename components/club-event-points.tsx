import { Trophy } from "lucide-react";
import type { ClubEventPoints } from "@/modules/event-points/domain";

/**
 * A club's attendance points from events (#1677) on its own points views, with the event as the reason. Nothing is drawn
 * until the club has some, so a club without event points sees exactly what it always saw. Counts only, never a person.
 */
export function ClubEventPointsList({ eventPoints, clubYear }: { eventPoints: ClubEventPoints; clubYear: string }) {
  if (eventPoints.awards.length === 0) return null;
  return (
    <section aria-labelledby="club-event-points-heading" className="public-manage-card" data-testid="club-event-points">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Points for attending events</p>
        <h2 id="club-event-points-heading"><Trophy aria-hidden="true" size={20} /> Event points, {clubYear}</h2>
      </div>
      <ul className="public-manage-club-list">
        {eventPoints.awards.map((award) => (
          <li key={award.eventName}>
            <span translate="no">{award.eventName}</span>: <strong>{award.points.toLocaleString("en-US")} points</strong>
          </li>
        ))}
      </ul>
      <p className="field-help">{eventPoints.total.toLocaleString("en-US")} points in all. They are already in your total points this club year.</p>
    </section>
  );
}
