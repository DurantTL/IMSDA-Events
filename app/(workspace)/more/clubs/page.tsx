import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileText, UsersRound } from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { NotAvailableForEvent } from "@/components/not-available-for-event";
import { BackgroundCheckBadge } from "@/components/background-check-flags";
import { listEventBackgroundFlags } from "@/modules/background-checks/repository";
import { getTeamSettings } from "@/modules/club-teams/settings-repository";
import { listRegisteredClubs, resolveClubOversight } from "@/modules/club-rosters/event-oversight";
import { staffPageTitles } from "@/components/staff-navigation";
import { cardCell } from "@/components/table-card-labels";
import { ColumnHeader } from "@/components/column-header";
import { SortOrderNote } from "@/components/list-sort";
import { serverSort, sortRows } from "@/lib/list-sort";
import { EVENT_CLUBS_SORT_COLUMNS, UNSORTED, sortLine } from "@/lib/staff-sort-columns";

export const metadata: Metadata = { title: staffPageTitles.clubs };
export const dynamic = "force-dynamic";

/** Every club registered for this Pathfinder event, for its event managers (#387). */
export default async function EventClubsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requested = typeof query.event === "string" ? query.event : undefined;
  const { event, allowed, clubEvent } = await resolveClubOversight(requested);
  if (!allowed && !clubEvent) {
    return <NotAvailableForEvent reason="Clubs register for Pathfinder events only, and this event is not one." />;
  }
  if (!allowed) {
    return (
      <AccessRestricted
        title="Club oversight is restricted"
        detail="Event administrators of this Pathfinder event can view its clubs."
        whoToAsk="your event administrator"
      />
    );
  }
  const [clubs, backgroundFlags, teamSettings] = await Promise.all([listRegisteredClubs(event.id), listEventBackgroundFlags(event.id), getTeamSettings(event.id)]);
  const neededByClub = new Map<string, number>();
  for (const person of backgroundFlags?.people ?? []) {
    if (person.organizationId) neededByClub.set(person.organizationId, (neededByClub.get(person.organizationId) ?? 0) + 1);
  }
  // A team after the first shows "Club-wide, shown above" for Sterling Volunteers, so the row's place in the unsorted list is kept (#809).
  const firstRowOfClub = new Map<string, number>();
  clubs.forEach((club, index) => { if (!firstRowOfClub.has(club.organizationId)) firstRowOfClub.set(club.organizationId, index); });
  const sorting = serverSort("/more/clubs", query, EVENT_CLUBS_SORT_COLUMNS, UNSORTED);
  const rows = sortRows(clubs.map((club, index) => ({ club, first: firstRowOfClub.get(club.organizationId) === index })), sorting.order.key, sorting.order.dir, {
    club: ({ club }) => (club.teamName ? `${club.teamName} (${club.name})` : club.name),
    going: ({ club }) => club.attendeeCount,
    sterling: ({ club, first }) => (first ? (neededByClub.get(club.organizationId) ?? 0) : null),
    registration: ({ club }) => club.confirmationCode,
  });
  return (
    <section className="page-stack">
      <div className="intro-actions club-admin-links">
        <Link className="secondary-button" href={`/more/clubs/reports?event=${event.id}`}>
          <FileText aria-hidden="true" size={14} /> All clubs&apos; Monthly Records
        </Link>
        {teamSettings && <Link className="secondary-button" href={`/more/team-results?event=${event.id}`}>Team results</Link>}
      </div>
      <div className="page-intro">
        <div>
          <p className="eyebrow">Event manager · view only</p>
          <h2>Clubs at {event.name}</h2>
          <p>Every club registered for this event. Open one to see its roster (ages, not birth dates), admins, and reports. Nothing can be changed here.</p>
        </div>
      </div>
      <section className="panel">
        {clubs.length === 0 ? (
          <p className="quiet-copy"><UsersRound aria-hidden="true" size={15} /> No clubs have registered yet.</p>
        ) : (
          <div className="report-table-wrap">
            {sorting.order.key && <SortOrderNote>{sortLine(sorting.order)}</SortOrderNote>}
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Registered clubs</caption>
              <thead role="rowgroup"><tr role="row"><ColumnHeader column="club" label="Club" sorting={sorting} /><ColumnHeader column="going" label="Going" sorting={sorting} />{backgroundFlags && <ColumnHeader column="sterling" label="Sterling Volunteers" sorting={sorting} />}<ColumnHeader column="registration" label="Registration" sorting={sorting} /><th role="columnheader" scope="col"><span className="sr-only">Open</span></th></tr></thead>
              <tbody role="rowgroup">
                {rows.map(({ club, first }) => (
                  <tr role="row" key={`${club.organizationId}:${club.teamKey}`}>
                    <th role="rowheader" scope="row" translate="no">{club.teamName ? `${club.teamName} (${club.name})` : club.name}{club.sponsoringChurch && <small> · {club.sponsoringChurch}</small>}</th>
                    <td {...cardCell("Going")}>{club.attendeeCount}</td>
                    {backgroundFlags && (
                      <td {...cardCell("Sterling Volunteers")}>
                        {/* Sterling Volunteers records are the club's, not a team's (#809): a club's count shows once, on its first team. */}
                        {!first
                          ? <small className="quiet-copy">Club-wide, shown above</small>
                          : neededByClub.get(club.organizationId)
                            ? <><BackgroundCheckBadge /> <small className="quiet-copy">{neededByClub.get(club.organizationId)}{club.teamName ? " (club-wide)" : ""}</small></>
                            : <small className="quiet-copy">All current</small>}
                      </td>
                    )}
                    <td {...cardCell("Registration")}>{club.confirmationCode}</td>
                    <td {...cardCell(null)}><Link className="secondary-button" href={`/more/clubs/${club.organizationId}?event=${event.id}`}>Open <ArrowRight aria-hidden="true" size={13} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
