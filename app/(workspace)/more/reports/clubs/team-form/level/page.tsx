import type { Metadata } from "next";
import Link from "next/link";
import { AccessRestricted } from "@/components/access-restricted";
import { PrintReportButton } from "@/components/print-report-button";
import { TeamFormSheet } from "@/components/team-form-sheet";
import { staffPageTitles } from "@/components/staff-navigation";
import { TEAM_LEVELS, teamLevelLabels } from "@/modules/club-teams/domain";
import { listTeamResults } from "@/modules/club-teams/results-repository";
import { levelFromParam, levelInfoFor, levelWhenWhere, teamsAtLevel } from "@/modules/club-teams/results-domain";
import { getTeamSettings } from "@/modules/club-teams/settings-repository";
import { loadFilledTeamForm } from "@/modules/club-teams/team-form-repository";
import { resolveClubReportsAccess } from "@/modules/reporting/club-reports-access";

export const metadata: Metadata = { title: staffPageTitles.teamForm };
export const dynamic = "force-dynamic";

/**
 * Every team form for one level, one letter page each (#945): the Area level prints every registered team, Conference
 * only the teams that advanced from Area, Union only those that advanced from Conference. A team that did not advance
 * is never printed at the next level.
 */
export default async function StaffLevelTeamFormsPage({ searchParams }: { searchParams: Promise<{ event?: string; level?: string | string[] }> }) {
  const { event: requested, level: requestedLevel } = await searchParams;
  const { event, allowed } = await resolveClubReportsAccess(requested);
  if (!allowed) {
    return <AccessRestricted title="Team forms are restricted" detail="Ask an event administrator for report access to this club event." />;
  }
  const level = levelFromParam(typeof requestedLevel === "string" ? requestedLevel : undefined);
  const [rows, settings] = await Promise.all([listTeamResults(event.id), getTeamSettings(event.id)]);
  const teams = teamsAtLevel(rows, level);
  const forms = (await Promise.all(teams.map((team) => loadFilledTeamForm({ eventId: event.id, clubEventRegistrationId: team.clubEventRegistrationId }))))
    .flatMap((form, index) => (form ? [{ id: teams[index]!.clubEventRegistrationId, form }] : []));
  const whenWhere = level === "AREA" ? "" : levelWhenWhere(levelInfoFor(settings?.levelInfo ?? [], level));
  const query = `event=${encodeURIComponent(event.id)}`;
  return (
    <section className="page-stack event-packet-workspace">
      <div className="page-intro event-packet-intro">
        <div>
          <p className="eyebrow">{teamLevelLabels[level]} level</p>
          <h2>{teamLevelLabels[level]} team forms</h2>
          <p>
            {forms.length} {forms.length === 1 ? "team" : "teams"}, one letter page each.
            {whenWhere ? ` ${teamLevelLabels[level]}: ${whenWhere}.` : ""}
          </p>
        </div>
        <div className="intro-actions">
          <Link className="secondary-button" href={`/more/team-results?${query}&level=${level}`}>Team results</Link>
          <PrintReportButton label="Print these forms" />
        </div>
      </div>
      <nav className="tab-chips team-level-tabs" aria-label="Level">
        {TEAM_LEVELS.map((each) => (
          <Link aria-current={each === level ? "page" : undefined} href={`/more/reports/clubs/team-form/level?${query}&level=${each}`} key={each}>{teamLevelLabels[each]}</Link>
        ))}
      </nav>
      {forms.length === 0 && <p className="quiet-copy">{level === "AREA" ? "No team is registered yet." : `No team has advanced to ${teamLevelLabels[level]} yet.`}</p>}
      {forms.map(({ id, form }) => (
        <div className="team-form-level-sheet" key={id}>
          <TeamFormSheet model={form.model} />
        </div>
      ))}
    </section>
  );
}
