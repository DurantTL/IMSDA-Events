import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TeamPermissionPanel } from "@/components/team-permission-panel";
import { teamPermissionsIntro } from "@/modules/club-teams/permission-domain";
import { listCoordinatorTeamPermissions } from "@/modules/club-teams/permission-repository";
import { currentAreaCoordinator, currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Team permissions", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Team members of 18 or older on teams at the Area Coordinator's own locations (#809): they grant or decline permission
 * here. A system administrator acting as a coordinator can look but not decide (their own staff access decides for them).
 */
export default async function TeamPermissionsPage() {
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const account = await currentAreaCoordinator();
  const rows = account ? await listCoordinatorTeamPermissions(account.id) : [];
  return (
    <section className="page-stack">
      <div className="public-manage-card">
        <h2>Team permissions</h2>
        <p>{teamPermissionsIntro.summary}</p>
        <dl className="team-permission-levels" aria-label="What each permission level means">
          {teamPermissionsIntro.levels.map((level) => (
            <div key={level.label}>
              <dt>{level.label}</dt>
              <dd>{level.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="field-help">{teamPermissionsIntro.footer}</p>
      </div>
      <TeamPermissionPanel canDecide={account !== null} endpointBase="/api/attendee/area-clubs/team-permissions" rows={rows} showEvent />
    </section>
  );
}
