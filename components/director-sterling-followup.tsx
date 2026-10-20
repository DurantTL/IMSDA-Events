import { backgroundFlagLabels } from "@/modules/background-checks/display";
import type { DirectorSterlingPerson } from "@/modules/background-checks/director-follow-up";

/**
 * A director's own club's Sterling Volunteers follow-up at a youth or
 * children's event (#874): who still needs a current check before they can be
 * checked in. Status only: no dates, contact details or staff-only notes.
 */
export function DirectorSterlingFollowUp({ people }: { people: DirectorSterlingPerson[] }) {
  return (
    <section className="public-manage-card" id="sterling-follow-up">
      <h3>Sterling Volunteers follow-up</h3>
      <p>
        Registration is never held for this, but adults and staff must be current with Sterling Volunteers to be
        checked in at this event.
      </p>
      {people.length === 0 ? (
        <p className="public-manage-empty">Everyone registered from your club is current.</p>
      ) : (
        <div className="report-table-wrap">
          <table className="report-table roster-table">
            <caption className="sr-only">Registered adults and staff who are not current with Sterling Volunteers</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.attendeeId}>
                  <th scope="row" translate="no">
                    {person.lastName}, {person.firstName}
                    <small className="quiet-copy"> · {person.attendeeType}</small>
                  </th>
                  <td>{backgroundFlagLabels[person.state]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
