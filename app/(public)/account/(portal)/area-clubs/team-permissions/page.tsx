import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoordinatorUnavailable } from "@/components/coordinator-overview";
import { TeamPermissionPanel } from "@/components/team-permission-panel";
import { logError } from "@/lib/logger";
import { TEAM_APPROVALS_STAFF_TEXT } from "@/modules/club-reports/coordinator-destinations-domain";
import { ageLimitText, teamPermissionsIntro, type TeamAgeRule } from "@/modules/club-teams/permission-domain";
import { formatCalendarDate } from "@/modules/club-registrations/domain";
import { getTeamSettings } from "@/modules/club-teams/settings-repository";
import { listCoordinatorTeamPermissions } from "@/modules/club-teams/permission-repository";
import { currentAreaCoordinator, currentAreaCoordinatorViewerActive } from "@/modules/organizations/area-coordinators";

export const metadata: Metadata = { title: "Team approvals", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

/**
 * Team members of 18 or older on teams at the Area Coordinator's own locations (#809): they approve or decline
 * here. A system administrator acting as a coordinator can look but not decide (their own staff access decides for them).
 */
export default async function TeamPermissionsPage() {
  if (!(await currentAreaCoordinatorViewerActive())) notFound();
  const account = await currentAreaCoordinator();
  // A failed read is "unavailable" with a retry, never an empty list that reads as "nothing to decide" (#1187).
  const loaded = account
    ? await listCoordinatorTeamPermissions(account.id).catch((error: unknown) => {
        logError("Coordinator team approvals read failed", error);
        return null;
      })
    : [];
  if (loaded === null) {
    return (
      <section className="page-stack">
        <CoordinatorUnavailable what="Team approvals" />
      </section>
    );
  }
  const rows = loaded;
  // The age limit is each event's own team setting, never a fixed number: one rule per event that has a row here.
  const eventNames = new Map(rows.map((row) => [row.eventId, row.eventName]));
  const ageRules: TeamAgeRule[] = await Promise.all(
    [...eventNames].map(async ([eventId, eventName]) => {
      const settings = await getTeamSettings(eventId);
      return { eventId, eventName, maxMemberAge: settings?.maxMemberAge ?? null, ageAsOf: settings?.ageAsOf ?? null };
    }),
  );
  // Two events can share a name; the age date tells them apart.
  const nameCount = new Map<string, number>();
  for (const rule of ageRules) nameCount.set(rule.eventName, (nameCount.get(rule.eventName) ?? 0) + 1);
  const eventLabel = (rule: TeamAgeRule) =>
    (nameCount.get(rule.eventName) ?? 0) > 1 ? `${rule.eventName} (age date ${rule.ageAsOf ? formatCalendarDate(rule.ageAsOf) : `event ${rule.eventId}`})` : rule.eventName;
  return (
    <section className="page-stack">
      <div className="public-manage-card">
        <h2>Team approvals</h2>
        <p>{teamPermissionsIntro.summary}</p>
        <h3 id="team-approval-rules-heading">{teamPermissionsIntro.rulesHeading}</h3>
        <p className="field-help">{teamPermissionsIntro.rulesLead}</p>
        <ul className="team-approval-rules" aria-labelledby="team-approval-rules-heading">
          {teamPermissionsIntro.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
          {ageRules.length === 1 && ageRules[0]!.maxMemberAge === null ? (
            <li>
              No age limit for <span translate="no">{ageRules[0]!.eventName}</span>.
            </li>
          ) : (
            <li>
              {teamPermissionsIntro.ageRuleLead}
              {ageRules.length === 1 ? <>: <strong>{ageLimitText(ageRules[0]!)}</strong>.</> : "."}
              {ageRules.length > 1 && (
                <ul aria-label="Age limit for each event">
                  {ageRules.map((rule) => (
                    <li key={rule.eventId}>
                      {rule.maxMemberAge === null ? (
                        <>No age limit for <span translate="no">{eventLabel(rule)}</span></>
                      ) : (
                        <><span translate="no">{eventLabel(rule)}</span>: <strong>{ageLimitText(rule)}</strong></>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )}
        </ul>
        <p>{teamPermissionsIntro.coaches}</p>
        <dl className="team-permission-levels" aria-label="What each decision means">
          {teamPermissionsIntro.levels.map((level) => (
            <div key={level.label}>
              <dt>{level.label}</dt>
              <dd>{level.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="field-help">{teamPermissionsIntro.footer}</p>
      </div>
      <TeamPermissionPanel
        canDecide={account !== null}
        emptyText="No team members of 18 or older at your event locations need a decision right now."
        endpointBase="/api/attendee/area-clubs/team-permissions"
        rows={rows}
        showEvent
        viewOnlyNote={TEAM_APPROVALS_STAFF_TEXT}
      />
    </section>
  );
}
