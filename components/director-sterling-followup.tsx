import { SterlingFollowUpTable } from "@/components/club-screen-tables";
import { ClubSetupHelp } from "@/components/role-setup-help";
import type { DirectorSterlingPerson } from "@/modules/background-checks/director-follow-up";

/**
 * A director's own club's Sterling Volunteers follow-up at a youth or
 * children's event (#874): who still needs a current check before they can be
 * checked in. Status only: no dates, contact details or staff-only notes.
 */
export function DirectorSterlingFollowUp({ people, base }: { people: DirectorSterlingPerson[]; /** The club's portal path: shows how to clear the follow-up (#1435). */ base?: string }) {
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
        <SterlingFollowUpTable people={people} />
      )}
      {people.length > 0 && base && <ClubSetupHelp base={base} context="the Sterling Volunteers follow-up" id="sterling-follow-up" />}
    </section>
  );
}
