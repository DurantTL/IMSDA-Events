import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { BackLink } from "@/components/back-link";
import { TeamResultsWorkspace } from "@/components/team-results-workspace";
import { staffPageTitles } from "@/components/staff-navigation";
import { TeamPermissionPanel } from "@/components/team-permission-panel";
import { levelFromParam } from "@/modules/club-teams/results-domain";
import { listLevelTeams } from "@/modules/club-teams/level-repository";
import { listEventTeamPermissions } from "@/modules/club-teams/permission-repository";
import { listTeamResults } from "@/modules/club-teams/results-repository";
import { getTeamSettings } from "@/modules/club-teams/settings-repository";
import { resolveClubReportsAccess } from "@/modules/reporting/club-reports-access";

export const metadata: Metadata = { title: staffPageTitles.teamResults };
export const dynamic = "force-dynamic";

/**
 * Team results (#809, #945): staff with report access (or an event administrator of this club event) read them; staff who
 * manage the event's registrations (MANAGE_REGISTRATION) also enter them, check teams in and send the advancement notices.
 * `?level=` picks Area (every team), Conference (the teams that advanced from Area) or Union.
 */
export default async function TeamResultsPage({ searchParams }: { searchParams: Promise<{ event?: string; level?: string | string[] }> }) {
  const { event: requested, level: requestedLevel } = await searchParams;
  const { event, allowed, permissions } = await resolveClubReportsAccess(requested);
  if (!allowed) {
    return <AccessRestricted title="Team results are restricted" detail="Ask an event administrator for report access to this club event." />;
  }
  const level = levelFromParam(typeof requestedLevel === "string" ? requestedLevel : undefined);
  const [rows, levelTeams, permissionRows, settings] = await Promise.all([
    listTeamResults(event.id),
    listLevelTeams(event.id, level),
    listEventTeamPermissions(event.id),
    getTeamSettings(event.id),
  ]);
  return (
    <>
      <BackLink href={`/more?event=${event.id}`} variant="staff">Back to More</BackLink>
      {/* Pending permissions come first: the Area Coordinator, or staff who manage registrations, decide them (#809). */}
      <TeamPermissionPanel canDecide={permissions.includes("MANAGE_REGISTRATION")} endpointBase={`/api/events/${encodeURIComponent(event.id)}/team-permissions`} rows={permissionRows} />
      <TeamResultsWorkspace
        canEdit={permissions.includes("MANAGE_REGISTRATION")}
        eventId={event.id}
        initialRows={rows}
        key={`${event.id}-${level}`}
        level={level}
        levelInfo={settings?.levelInfo ?? []}
        levelTeams={levelTeams}
      />
    </>
  );
}
