import { ordinal, type ClubAwards, type EventScoringResults, type EventResult } from "@/modules/event-scoring/domain";
import styles from "@/components/event-scoring-results-view.module.css";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One scored event's ranking: place, name, score, and the ribbon the entry earns (only where its club asked for ribbons). */
function EventRanking({ event, showClub }: { event: EventResult; showClub: boolean }) {
  return (
    <section aria-labelledby={`scoring-result-${event.id}`}>
      <h4 className={styles.subheading} id={`scoring-result-${event.id}`}><span translate="no">{event.name}</span></h4>
      <p className={styles.muted}>{event.ribbonRule}. {event.higherWins ? "Highest score wins." : "Lowest score wins."}</p>
      {event.rows.length === 0 ? (
        <p className={styles.muted}>No scores entered yet.</p>
      ) : (
        <ol className={styles.list}>
          {event.rows.map((row) => (
            <li className={styles.entry} key={row.subjectId}>
              <span className={styles.place}>{ordinal(row.rank)}{row.tied ? " (tie)" : ""}</span>
              <span className={styles.who}>
                <span translate="no">{row.name}</span>
                {showClub && event.kind === "PATHFINDER" && <span className={styles.club} translate="no">{row.clubName}</span>}
              </span>
              <span className={styles.score}>{row.scoreText}</span>
              {row.award && row.ribbonWanted && <span className={styles.award}>Ribbon: {row.award}</span>}
              {row.award && !row.ribbonWanted && <span className={styles.scoreOnly}>Earns {row.award}. This club did not ask for ribbons, so this is a score only.</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RibbonList({ club }: { club: ClubAwards }) {
  return (
    <div className={styles.block}>
      <strong translate="no">{club.clubName}</strong>
      {!club.wantsRibbons ? (
        <p className={styles.muted}>Did not ask for ribbons on registration. Scores only.</p>
      ) : club.ribbons.length === 0 ? (
        <p className={styles.muted}>Asked for ribbons. None earned yet.</p>
      ) : (
        <ul className={styles.ribbons}>
          {club.ribbons.map((line, index) => (
            <li key={`${line.eventName}-${line.recipient}-${index}`}>
              <span translate="no">{line.eventName}</span>: {line.award}
              {line.recipient !== club.clubName ? <> · <span translate="no">{line.recipient}</span></> : null}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.muted}>1st places: {club.firsts} · 2nd: {club.seconds} · 3rd: {club.thirds}{club.bandRibbons > 0 ? ` · Score-band ribbons: ${club.bandRibbons}` : ""}</p>
    </div>
  );
}

/**
 * Rankings, the ribbon list per club and the trophy and award counts, for staff and Area Coordinators. Lists, not tables,
 * so it reads on a phone. Every ribbon appears only for a club that said yes to ribbons on registration.
 */
export function EventScoringResultsView({ results }: { results: EventScoringResults }) {
  return (
    <div className={styles.results} data-testid="scoring-results">
      <p className={styles.counts}>
        <span><strong>{results.trophies}</strong> {results.trophies === 1 ? "trophy" : "trophies"} (1st places)</span>
        <span><strong>{results.ribbonsTotal}</strong> {results.ribbonsTotal === 1 ? "ribbon" : "ribbons"} for clubs that asked</span>
        {results.ribbonCounts.map((count) => <span key={count.award}>{plural(count.count, count.award)}</span>)}
      </p>
      <section aria-labelledby="scoring-rankings">
        <h3 className={styles.heading} id="scoring-rankings">Rankings</h3>
        {results.events.length === 0 ? (
          <p className={styles.muted}>No scored events yet. Add one above, then enter scores.</p>
        ) : (
          <div className={styles.results}>{results.events.map((event) => <EventRanking event={event} key={event.id} showClub />)}</div>
        )}
      </section>
      <section aria-labelledby="scoring-ribbons">
        <h3 className={styles.heading} id="scoring-ribbons">Ribbons by club</h3>
        {results.clubs.length === 0 ? (
          <p className={styles.muted}>No club has registered yet. Clubs appear here once their registration is submitted.</p>
        ) : (
          <div className={styles.list}>{results.clubs.map((club) => <RibbonList club={club} key={club.organizationId} />)}</div>
        )}
      </section>
    </div>
  );
}

/** One club's own published results. Only this club's rows are ever passed in. */
export function EventScoringClubResults({ awards, events }: { awards: ClubAwards | null; events: EventResult[] }) {
  return (
    <div className={styles.results} data-testid="scoring-club-results">
      {events.length === 0 ? (
        <p className={styles.muted}>Your club has no scores in these results.</p>
      ) : (
        events.map((event) => <EventRanking event={event} key={event.id} showClub={false} />)
      )}
      {awards && <RibbonList club={awards} />}
    </div>
  );
}
