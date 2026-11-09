import { Trophy } from "lucide-react";
import { EventScoringClubResults } from "@/components/event-scoring-results-view";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import type { DirectorEventScoringResults } from "@/modules/event-scoring/service";

/**
 * "Camporee results" (#1676) on a club event, once staff have published them and while the tool is on. Only this club's
 * own rows: the server passes in nothing about any other club.
 */
export function EventScoringDirectorCard({ results }: { results: DirectorEventScoringResults }) {
  return (
    <section aria-labelledby="scoring-results-heading" className="public-manage-card" data-testid="scoring-director-card">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Camporee</p>
        <h2 id="scoring-results-heading"><Trophy aria-hidden="true" size={20} /> Your club&apos;s camporee results</h2>
      </div>
      <p className="field-help">Published {formatInConferenceTime(results.publishedAt, { dateStyle: "medium", timeStyle: "short" })}. These are your club&apos;s scores and ribbons only.</p>
      <EventScoringClubResults awards={results.awards} events={results.events} />
    </section>
  );
}
