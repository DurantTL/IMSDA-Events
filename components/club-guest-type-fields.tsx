"use client";

import {
  GUEST_CHILD_MAX_AGE,
  GUEST_NOT_PATHFINDER_MAX_AGE,
  GUEST_NOT_PATHFINDER_MIN_AGE,
} from "@/modules/club-registrations/domain";

/**
 * "Who is this?" for someone added for the event only (#1666, #1728). Child is offered under 10; from 10 to 17 the guest is a
 * Pathfinder, with an optional "Not a Pathfinder" box; 18 and over is an Adult. Event rules for teams never render this.
 */
export function ClubGuestTypeFields({ age, offersChild, error }: { age: string; offersChild: boolean; error?: string }) {
  const parsed = age.trim() === "" ? null : Number(age);
  const wholeAge = parsed !== null && Number.isInteger(parsed) ? parsed : null;
  const childOffered = offersChild && wholeAge !== null && wholeAge <= GUEST_CHILD_MAX_AGE;
  const markOffered = offersChild && wholeAge !== null && wholeAge >= GUEST_NOT_PATHFINDER_MIN_AGE && wholeAge <= GUEST_NOT_PATHFINDER_MAX_AGE;
  return (
    <>
      <label>
        Who is this?
        <select aria-describedby={error ? "club-guest-type-error" : undefined} aria-invalid={error ? true : undefined} defaultValue="" key={childOffered ? "with-child" : "no-child"} name="guestType" required>
          <option disabled value="">Choose one</option>
          <option value="YOUTH">Pathfinder</option>
          <option value="ADULT">Adult</option>
          {childOffered && <option value="UNDERAGE">Child (not a Pathfinder)</option>}
        </select>
        {childOffered && <small className="field-help">A child isn&apos;t counted as a Pathfinder and doesn&apos;t take a class seat.</small>}
        {error && <small className="field-error" id="club-guest-type-error" role="alert">{error}</small>}
      </label>
      {markOffered && (
        <label className="checkbox-row">
          <input name="notPathfinder" type="checkbox" />
          <span>Not a Pathfinder (for example, a sibling who isn&apos;t in the club)</span>
        </label>
      )}
    </>
  );
}
