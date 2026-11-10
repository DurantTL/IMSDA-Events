import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Eye } from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { DetailPage } from "@/components/page-templates/detail-page";
import { PageHeader } from "@/components/page-header";
import { BackgroundCheckList } from "@/components/background-check-flags";
import { getCurrentSession } from "@/modules/access/current-session";
import { canSeeIssuesText } from "@/modules/background-checks/notes-access";
import { listEventBackgroundFlags } from "@/modules/background-checks/repository";
import { ClubGuardiansPanel } from "@/components/club-guardians-panel";
import { ClubOverview } from "@/components/club-overview";
import { getPrisma } from "@/lib/prisma";
import { listClubAssignmentsForClub } from "@/modules/club-registrations/assignments-repository";
import { resolveStaffGuardianViewer } from "@/modules/club-rosters/guardians-access";
import { isClubRegisteredForEvent, resolveClubOversight } from "@/modules/club-rosters/event-oversight";
import { canManageClubAssignments } from "@/modules/club-registrations/assignments-access";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.club };
export const dynamic = "force-dynamic";

/** One registered club, view only with ages, for this event's managers (#387). */
export default async function EventClubPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const [{ organizationId }, { event: requested }] = await Promise.all([params, searchParams]);
  const { event, allowed, permissions } = await resolveClubOversight(requested);
  if (!allowed) {
    // The page draws its own title (#1772), so the restricted state keeps the page's one h1 too.
    return (
      <>
        <PageHeader title={staffPageTitles.club} />
        <AccessRestricted title="Club oversight is restricted" detail="Event administrators of this Pathfinder event can view its clubs." whoToAsk="your event administrator" />
      </>
    );
  }
  // Only clubs registered for this event: the role is for this event only.
  if (!(await isClubRegisteredForEvent(event.id, organizationId))) notFound();
  const club = await getPrisma().organization.findUnique({ where: { id: organizationId }, select: { name: true, parentOrganization: { select: { name: true } } } });
  if (!club) notFound();
  const query = `?event=${event.id}`;
  const selfHref = `/more/clubs/${organizationId}${query}`;
  const fromHere = `${query}&from=${encodeURIComponent(selfHref)}`;
  // The issues text is for system administrators only (#427, #544).
  const { user } = await getCurrentSession();
  const backgroundFlags = await listEventBackgroundFlags(event.id, { organizationId, includeNotes: canSeeIssuesText(user), includeContact: true });
  // One per team (#1782): a club registered as a named team keeps its assignment on that team's registration.
  const assignments = await listClubAssignmentsForClub(event.id, organizationId);
  // A team's name is shown only when there is more than one team or the one team is named.
  const showTeamNames = assignments.length > 1 || assignments.some((entry) => entry.teamName);
  // Guardian contacts (#510): only for staff who hold the sensitive-data permission on this event.
  const guardianViewer = await resolveStaffGuardianViewer(event.id);
  return (
    <DetailPage
      header={{
        title: club.name,
        exactName: true,
        description: club.parentOrganization ? <span translate="no">{club.parentOrganization.name}</span> : undefined,
        back: { href: `/more/clubs${query}`, label: "Back to clubs attending" },
      }}
      notices={<p className="inline-notice" role="status"><Eye aria-hidden="true" size={14} /> View only, with ages instead of birth dates. The club makes changes.</p>}
    >
      {backgroundFlags && (
        <section className="panel" id="background-checks">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Youth or children&apos;s event · the club doesn&apos;t see this</p>
              <h2>Sterling Volunteers needed</h2>
              <p>Adults from this club who are not in compliance with Sterling Volunteers through {backgroundFlags.lastDay}. Registration is never blocked; check-in is held for them unless staff override.</p>
            </div>
          </div>
          <BackgroundCheckList people={backgroundFlags.people} registrationHref={{ base: "/people", query: `event=${encodeURIComponent(event.id)}` }} showClub={false} />
        </section>
      )}
      {assignments.length > 0 && (
        <section className="panel">
          <h2>Event assignments</h2>
          <p className="quiet-copy">Set by event staff for {event.name}.</p>
          {assignments.map((assignment) => (
            <div key={assignment.teamKey}>
              {showTeamNames && <p className="quiet-copy"><strong translate="no">{assignment.teamName ?? club.name}</strong></p>}
              <ul className="quiet-copy compact-list">
                {assignment.fields.campsiteLocation && <li>Campsite: {assignment.fields.campsiteLocation}</li>}
                {assignment.fields.dutyLabel && <li>Duty: {assignment.fields.dutyLabel}{assignment.fields.dutyDay ? ` — ${assignment.fields.dutyDay}` : ""}{assignment.fields.dutyTime ? ` ${assignment.fields.dutyTime}` : ""}</li>}
                {assignment.fields.activityLabel && <li>Activity: {assignment.fields.activityLabel}</li>}
              </ul>
            </div>
          ))}
          {canManageClubAssignments(permissions) && <p><Link className="text-button" href={`/more/club-assignments${query}`}>Change on Club assignments</Link></p>}
        </section>
      )}
      <ClubOverview
        organizationId={organizationId}
        reportHref={(month) => `/more/clubs/reports/${organizationId}/${month}${fromHere}`}
        reportsEditable={false}
      />
      {guardianViewer && <ClubGuardiansPanel organizationId={organizationId} viewer={guardianViewer} />}
    </DetailPage>
  );
}
