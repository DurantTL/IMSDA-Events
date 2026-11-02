import { UsersRound } from "lucide-react";
import { GuardiansTable } from "@/components/club-screen-tables";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { GuardianAccessError, listGuardianContactsForClub, type ClubGuardianContact } from "@/modules/club-rosters/guardians-repository";
import type { GuardianViewer } from "@/modules/club-rosters/guardians-domain";

/**
 * A club's emergency contacts, read only (#510), for the pages Area
 * Coordinators and conference staff use to look at a club. The caller passes
 * the viewer it resolved from the session (`guardians-access.ts`); the
 * repository checks it again and audits a coordinator's or staff member's
 * opening of the list. A viewer who may not read this club sees nothing.
 */
export async function ClubGuardiansPanel({
  organizationId,
  viewer,
  headingLevel = 2,
  emptyHelp,
}: {
  /** Setup help under the empty state: who can add the contacts (#1435). Given where the viewer is not the club's own leader. */
  emptyHelp?: React.ReactNode;
  organizationId: string;
  viewer: GuardianViewer;
  headingLevel?: 2 | 3;
}) {
  let contacts: ClubGuardianContact[];
  try {
    contacts = await listGuardianContactsForClub(viewer, organizationId, clubYearFor(new Date()));
  } catch (error) {
    if (error instanceof GuardianAccessError) return null;
    throw error;
  }
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="public-manage-card" aria-labelledby="open-club-guardians" id="open-club-guardians">
      <div className="public-manage-card-heading">
        <p className="public-registration-eyebrow">Confidential · for event care</p>
        <Heading id="open-club-guardians">Emergency contacts</Heading>
      </div>
      {contacts.length === 0 ? (
        <>
          <p className="public-manage-empty"><UsersRound size={17} aria-hidden="true" /> No emergency contacts are on file for this club yet.</p>
          {emptyHelp}
        </>
      ) : (
        <GuardiansTable contacts={contacts} />
      )}
    </section>
  );
}

