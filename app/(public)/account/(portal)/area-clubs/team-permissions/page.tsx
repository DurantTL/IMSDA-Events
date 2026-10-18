import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TeamPermissionPanel } from "@/components/team-permission-panel";
import { ageLimitText, teamPermissionsIntro, type TeamAgeRule } from "@/modules/club-teams/permission-domain";
import { getTeamSettings } from "@/modules/club-teams/settings-repository";
import { listCoordinatorTeamPermissions } from "@/modules/club-teams/permission-repository";
import { currentAreaCoordinator, currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Team approvals", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Team members of 18 or older on teams at the Area Coordinator's own locations (#809): they grant or decline permission
 * here. A system administrator acting as a coordinator can look but not decide (their own staff access decides for them).
 */
export default async function TeamPermissionsPage() {
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const account = await currentAreaCoordinator();
  const rows = account ? await listCoordinatorTeamPermissions(account.id) : [];
  // The age limit is each event's own team setting, never a fixed number: one rule per event that has a row here.
  const eventNames = new Map(rows.map((row) => [row.eventId, row.eventName]));
  const ageRules: TeamAgeRule[] = await Promise.all(
    [...eventNames].map(async ([eventId, eventName]) => {
      const settings = await getTeamSettings(eventId);
      return { eventName, maxMemberAge: settings?.maxMemberAge ?? null, ageAsOf: settings?.ageAsOf ?? null };
    }),
  );
  return (
    <section className="page-stack">
      <div className="public-manage-card">
        <h2>Team approvals</h2>
        <p>{teamPermissionsIntro.summary}</p>
        <h3>{teamPermissionsIntro.rulesHeading}</h3>
        <p className="field-help">{teamPermissionsIntro.rulesLead}</p>
        <ul className="team-approval-rules" aria-label={teamPermissionsIntro.rulesHeading}>
          {teamPermissionsIntro.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
          <li>
            {teamPermissionsIntro.ageRuleLead}
            {ageRules.length === 1 ? <>: <strong>{ageLimitText(ageRules[0]!)}</strong>.</> : "."}
            {ageRules.length > 1 && (
              <ul aria-label="Age limit for each event">
                {ageRules.map((rule) => (
                  <li key={rule.eventName}>
                    <span translate="no">{rule.eventName}</span>: <strong>{ageLimitText(rule)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </li>
        </ul>
        <p>{teamPermissionsIntro.coaches}</p>
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
