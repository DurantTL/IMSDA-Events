import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { PendingTeamsReview } from "@/components/pending-teams-review";
import { resolveEventContext } from "@/modules/events/selection";
import { listAttachableClubs, listPendingTeams, resolvedTeamCounts } from "@/modules/general-link-registrations/repository";

export const metadata: Metadata = { title: "Teams waiting for a club" };

export default async function PendingTeamsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_REGISTRATION")) {
    return (
      <AccessRestricted
        title="Teams waiting for a club are restricted"
        detail="Only event administrators and registration managers can confirm which club a team belongs to."
      />
    );
  }
  const [teams, clubs, counts] = await Promise.all([listPendingTeams(event.id), listAttachableClubs(), resolvedTeamCounts(event.id)]);

  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Registration integrity</p>
          <h2>Teams waiting for a club</h2>
          <p>
            These teams registered through the general link for {event.name}, but the director&rsquo;s email did not match the club
            they picked. Check the members and contact, then confirm the club, choose another, or reject the team.
          </p>
          <p className="field-help">
            Until then a team is in no registration, invoice or check-in list. Handle these names as you would a club roster; a
            team nobody resolves has its names removed 30 days after the event ends.
          </p>
          <p className="field-help">{counts.attached} attached through the link · {counts.rejected} rejected</p>
        </div>
      </div>
      {teams.length === 0 ? (
        <section className="panel empty-state">
          <ShieldCheck aria-hidden="true" size={24} />
          <h3>Nothing waiting</h3>
          <p>Every team registered through the link is attached to a club.</p>
        </section>
      ) : (
        <PendingTeamsReview clubs={clubs} eventId={event.id} teams={teams} timeZone={event.timezone} />
      )}
    </section>
  );
}
