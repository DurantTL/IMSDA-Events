import { ExportLink } from "@/components/export-link";
import { ExactValue } from "@/components/exact-value";
import { formatPersonName } from "@/lib/person-name";
import type { Metadata } from "next";
import Link from "next/link";
import { Award, Download, ShieldCheck, UsersRound } from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { BackgroundCheckBadge } from "@/components/background-check-flags";
import { LocationFilter } from "@/components/location-filter";
import { HonorPickRemoveButton, HonorSeatPlacementForm } from "@/components/honor-seat-override";
import { ColumnHeader } from "@/components/column-header";
import { SortOrderNote } from "@/components/list-sort";
import { PrintReportButton } from "@/components/print-report-button";
import { resolveLocationFilter } from "@/modules/event-locations/filter";
import { resolveEventContext } from "@/modules/events/selection";
import {
  buildClassRosters,
  buildClubSchedule,
  buildSiteRoster,
  allSitesLabel,
  rosterGroupLabels,
  rosterGroupOf,
} from "@/modules/honors/roster-domain";
import { getHonorRosterData } from "@/modules/honors/roster-repository";
import { backgroundFlaggedAttendeeIds } from "@/modules/background-checks/repository";
import { serverSort, sortRows } from "@/lib/list-sort";
import { HONOR_CLASS_SORT_COLUMNS, HONOR_SCHEDULE_SORT_COLUMNS, HONOR_SITE_SORT_COLUMNS, HONOR_TOTALS_SORT_COLUMNS, UNSORTED, sortLine } from "@/lib/staff-sort-columns";
import { staffPageTitles } from "@/components/staff-navigation";
import { NotAvailableForEvent } from "@/components/not-available-for-event";

export const metadata: Metadata = {
  title: staffPageTitles.honorsRosters,
  robots: { index: false, follow: false, nocache: true },
};

type View = "classes" | "site" | "clubs";

function ageText(age: number | null) {
  return age === null ? "—" : String(age);
}

export default async function HonorRostersPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; view?: string; club?: string; location?: string; sort?: string; dir?: string; totalsSort?: string; totalsDir?: string }>;
}) {
  const query = await searchParams;
  const { event, permissions, user } = await resolveEventContext(query.event);
  // Placing a youth in a full class by hand, and removing a pick, are for system administrators only (#962); the server checks too.
  const canOverrideSeats = user.globalRole === "SYSTEM_ADMIN";
  if (!permissions.includes("VIEW_REPORTS")) {
    return <AccessRestricted title="Honors rosters are restricted" detail="This page needs report access." whoToAsk="your event administrator" />;
  }
  const includeDietary = permissions.includes("VIEW_SENSITIVE_DATA");
  // "All sites" plus each location, from the filter the other staff views share (#413).
  const { locations, locationId, selected: site } = await resolveLocationFilter(event.id, query.location);
  const [data, flagged] = await Promise.all([
    // Why a youth was placed by hand is for system administrators only (#962).
    getHonorRosterData(event.id, { includeDietary, includeAdminPlacementReasons: canOverrideSeats, ...(locationId ? { locationId } : {}) }),
    backgroundFlaggedAttendeeIds(event.id),
  ]);
  if (!data) return <NotAvailableForEvent reason="The selected event could not be loaded." />;

  const view: View = query.view === "site" || query.view === "clubs" ? query.view : "classes";
  const eventQuery = `event=${encodeURIComponent(event.id)}${site ? `&location=${encodeURIComponent(site.id)}` : ""}`;
  const csv = (kind: string, club?: string) =>
    `/api/events/${encodeURIComponent(event.id)}/honors/rosters?view=${kind}${club ? `&club=${encodeURIComponent(club)}` : ""}${site ? `&location=${encodeURIComponent(site.id)}` : ""}`;
  const classRosters = buildClassRosters(data.sessions, data.offerings, data.enrollments, data.attendees, data.locations);
  const siteRoster = buildSiteRoster(data.attendees);
  // Seats each club holds in each class, placements included, so the placement form can warn before a club passes its limit (#962).
  const clubOfAttendee = new Map(data.attendees.map((person) => [person.id, person.clubId]));
  const clubSeatsByClass = new Map<string, Record<string, number>>();
  for (const row of data.enrollments) {
    const clubId = clubOfAttendee.get(row.attendeeId);
    if (!row.consumesSeat || !clubId) continue;
    const seats = clubSeatsByClass.get(row.offeringId) ?? {};
    seats[clubId] = (seats[clubId] ?? 0) + 1;
    clubSeatsByClass.set(row.offeringId, seats);
  }
  // Each table sorts from its column headers, from a fixed list of columns; no column chosen keeps the page's order (#1458).
  // Only one view shows at a time, so the class sheets, the site roster and the club schedules share `sort` and `dir`.
  const honorsPath = "/more/honors/rosters";
  const classSorting = serverSort(honorsPath, query, HONOR_CLASS_SORT_COLUMNS, UNSORTED);
  const totalsSorting = serverSort(honorsPath, query, HONOR_TOTALS_SORT_COLUMNS, UNSORTED, { prefix: "totals" });
  const siteSorting = serverSort(honorsPath, query, HONOR_SITE_SORT_COLUMNS, UNSORTED);
  const scheduleSorting = serverSort(honorsPath, query, HONOR_SCHEDULE_SORT_COLUMNS, UNSORTED);
  const nameOf = (person: { lastName: string; firstName: string }) => formatPersonName(person, "sorted");
  const sortedTotals = sortRows(siteRoster.clubs, totalsSorting.order.key, totalsSorting.order.dir, {
    club: (club) => club.clubName,
    youth: (club) => club.YOUTH,
    staff: (club) => club.STAFF,
    adults: (club) => club.ADULT,
  });
  const sortedSitePeople = sortRows(siteRoster.people, siteSorting.order.key, siteSorting.order.dir, {
    checkedIn: (person) => person.checkedIn,
    name: nameOf,
    club: (person) => person.clubName,
    site: (person) => person.locationName,
    age: (person) => person.ageOnEventDate,
    type: (person) => rosterGroupLabels[rosterGroupOf(person.attendeeType)],
    dietary: (person) => person.dietary,
  });
  const selectedClubs = query.club ? data.clubs.filter((club) => club.id === query.club) : data.clubs;

  return (
    <section className="page-stack reports-workspace honor-rosters">
      <div className="page-intro report-page-intro">
        <div>
          <p className="eyebrow">Honors Weekend</p>
          <h2>Rosters for {data.event.name}</h2>
          <p>
            Class sheets, the site check-in roster, and each club&apos;s schedule, from submitted club registrations.
            Ages are on the first day of the event.
          </p>
        </div>
        <div className="intro-actions report-actions">
          <Link className="secondary-button" href={`/more/honors?${eventQuery}`}>Back to classes</Link>
          <PrintReportButton label="Print" />
        </div>
      </div>

      <div className="report-safety-note">
        <ShieldCheck aria-hidden="true" size={19} />
        <p>
          <strong>Ages only, never birth dates.</strong>{" "}
          {includeDietary
            ? "Dietary notes appear on the site roster because you can view sensitive answers. Keep printed copies with the kitchen and check-in team."
            : "Dietary notes are left off because your role can't view sensitive answers."}
        </p>
      </div>

      <nav className="tab-chips honor-roster-tabs" aria-label="Roster view">
        <Link aria-current={view === "classes" ? "page" : undefined} href={`/more/honors/rosters?${eventQuery}`}>Classes ({classRosters.length})</Link>
        <Link aria-current={view === "site" ? "page" : undefined} href={`/more/honors/rosters?${eventQuery}&view=site`}>Site roster ({siteRoster.totals.total})</Link>
        <Link aria-current={view === "clubs" ? "page" : undefined} href={`/more/honors/rosters?${eventQuery}&view=clubs`}>Club schedules ({data.clubs.length})</Link>
      </nav>

      <LocationFilter
        basePath="/more/honors/rosters"
        locations={locations}
        params={{ event: event.id, view: view === "classes" ? undefined : view, club: query.club }}
        selectedId={locationId}
      />

      {view === "classes" && (
        <>
          <div className="report-actions honor-roster-downloads">
            <ExportLink className="secondary-button report-download" href={csv("classes")}><Download aria-hidden="true" size={15} /> Download class rosters CSV</ExportLink>
          </div>
          {canOverrideSeats && classRosters.length > 0 && (
            <HonorSeatPlacementForm
              eventId={event.id}
              classes={classRosters.map((roster) => ({
                id: roster.offering.id,
                label: `${roster.offering.honorName} (${roster.session}${data.hasLocations && roster.siteName ? `, ${roster.siteName}` : ""})`,
                // Seats counted toward the limit and seats held for live offers, across every site: what a normal pick sees.
                seatsLeft: roster.offering.capacity - (roster.offering.capacityHeldAllSites ?? roster.youthSeats - roster.overCapacityPlacements),
                perClubLimit: roster.offering.perClubLimit ?? null,
                clubSeats: clubSeatsByClass.get(roster.offering.id) ?? {},
              }))}
              candidates={data.attendees
                .filter((person) => rosterGroupOf(person.attendeeType) === "YOUTH")
                .map((person) => ({ id: person.id, label: `${person.lastName}, ${person.firstName} (${person.clubName})`, clubId: person.clubId, clubName: person.clubName, changesClosed: person.changesClosed === true }))}
            />
          )}
          {classRosters.length === 0 && <p className="report-empty">No classes are set up for {site ? <span translate="no">{site.name}</span> : "this site"} yet.</p>}
          {classRosters.map((roster) => (
            <section className="panel report-panel honor-class-sheet" key={roster.offering.id}>
              <div className="section-heading report-section-heading">
                <div className="report-title">
                  <span className="report-icon purple"><Award aria-hidden="true" size={19} /></span>
                  <div>
                    <p className="eyebrow">
                      {data.hasLocations && <><span translate="no">{roster.siteName ?? allSitesLabel}</span>{" · "}</>}
                      {roster.session}{roster.offering.isActive ? "" : " · no longer offered"}
                    </p>
                    <h2>{roster.offering.honorName} <small>{roster.offering.honorCode}</small></h2>
                    <p>
                      {[roster.offering.location && `Room: ${roster.offering.location}`, roster.offering.teacherName && `Teacher: ${roster.offering.teacherName}`]
                        .filter(Boolean).join(" · ") || "Room and teacher not set"}
                    </p>
                  </div>
                </div>
                <span className="count-badge">
                  {/* A class no site owns is shared: with a site filter on, the count is only this site's clubs. */}
                  {site && !roster.siteName
                    ? `${roster.youthSeats} at this site / ${roster.offering.capacity} youth seats (all sites)`
                    : `${roster.youthSeats} / ${roster.offering.capacity} youth seats`}
                  {roster.overCapacity && ` · over capacity by ${roster.seatsAllSites - roster.offering.capacity}`}
                </span>
              </div>
              {roster.people.length === 0 ? (
                <p className="report-empty">No one has chosen this class yet.</p>
              ) : (
                <div className="report-table-wrap">
                  {classSorting.order.key && <SortOrderNote>{sortLine(classSorting.order)}</SortOrderNote>}
                  <table className="report-table">
                    <caption className="sr-only">People in {roster.offering.honorName}</caption>
                    <thead><tr><ColumnHeader column="name" label="Name" sorting={classSorting} /><ColumnHeader column="club" label="Club" sorting={classSorting} /><ColumnHeader column="age" label="Age" sorting={classSorting} /><ColumnHeader column="type" label="Type" sorting={classSorting} /><th scope="col">Present</th>{canOverrideSeats && <th scope="col" className="honor-seat-override">Pick</th>}</tr></thead>
                    <tbody>
                      {sortRows(roster.people, classSorting.order.key, classSorting.order.dir, {
                        name: nameOf,
                        club: (person) => person.clubName,
                        age: (person) => person.ageOnEventDate,
                        type: (person) => rosterGroupLabels[rosterGroupOf(person.attendeeType)],
                      }).map((person) => {
                        const pick = roster.picks.find((candidate) => candidate.attendeeId === person.id);
                        return (
                          <tr key={person.id}>
                            <th scope="row">
                              <ExactValue>{person.lastName}, {person.firstName}</ExactValue>{flagged.has(person.id) && <> <BackgroundCheckBadge /></>}
                              {/* Only system administrators are sent the reason, and it never prints on a class sheet (#962). */}
                              {pick?.adminPlacementReason && <small className="field-help honor-seat-override"> Placed by a system administrator: {pick.adminPlacementReason}</small>}
                            </th>
                            <td translate="no">{person.clubName}</td>
                            <td>{ageText(person.ageOnEventDate)}</td>
                            <td>{rosterGroupLabels[rosterGroupOf(person.attendeeType)]}</td>
                            <td className="honor-roster-box" aria-label="Attendance box" />
                            {canOverrideSeats && (
                              <td className="honor-seat-override">
                                {pick?.enrollmentId && <HonorPickRemoveButton eventId={event.id} enrollmentId={pick.enrollmentId} who={`${person.firstName} ${person.lastName}`} />}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </>
      )}

      {view === "site" && (
        <section className="panel report-panel">
          <div className="section-heading report-section-heading">
            <div className="report-title">
              <span className="report-icon navy"><UsersRound aria-hidden="true" size={19} /></span>
              <div>
                <p className="eyebrow">Check-in fallback</p>
                <h2>Site roster</h2>
                <p>
                  {siteRoster.totals.YOUTH} youth · {siteRoster.totals.STAFF} staff · {siteRoster.totals.ADULT} adults · {siteRoster.totals.total} total.
                  Use QR check-in first; this sheet is the paper backup.
                </p>
              </div>
            </div>
            <ExportLink className="secondary-button report-download" href={csv("site")}><Download aria-hidden="true" size={15} /> Download site roster CSV</ExportLink>
          </div>
          {siteRoster.clubs.length > 0 && (
            <div className="report-table-wrap">
              {totalsSorting.order.key && <SortOrderNote>{sortLine(totalsSorting.order)}</SortOrderNote>}
              <table className="report-table">
                <caption className="sr-only">Totals by club</caption>
                <thead><tr><ColumnHeader column="club" label="Club" sorting={totalsSorting} /><ColumnHeader column="youth" label="Youth" sorting={totalsSorting} /><ColumnHeader column="staff" label="Staff" sorting={totalsSorting} /><ColumnHeader column="adults" label="Adults" sorting={totalsSorting} /></tr></thead>
                <tbody>
                  {sortedTotals.map((club) => (
                    <tr key={club.clubName}><th scope="row" translate="no">{club.clubName}</th><td>{club.YOUTH}</td><td>{club.STAFF}</td><td>{club.ADULT}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {siteRoster.people.length === 0 ? (
            <p className="report-empty">No club has registered for this site yet.</p>
          ) : (
            <div className="report-table-wrap">
              {siteSorting.order.key && <SortOrderNote>{sortLine(siteSorting.order)}</SortOrderNote>}
              <table className="report-table">
                <caption className="sr-only">Everyone registered for this site</caption>
                <thead>
                  <tr>
                    <ColumnHeader column="checkedIn" label="Checked in" sorting={siteSorting} /><ColumnHeader column="name" label="Name" sorting={siteSorting} /><ColumnHeader column="club" label="Club" sorting={siteSorting} />{data.hasLocations && <ColumnHeader column="site" label="Site" sorting={siteSorting} />}<ColumnHeader column="age" label="Age" sorting={siteSorting} /><ColumnHeader column="type" label="Type" sorting={siteSorting} />
                    {includeDietary && <ColumnHeader column="dietary" label="Dietary notes" sorting={siteSorting} />}
                  </tr>
                </thead>
                <tbody>
                  {sortedSitePeople.map((person) => (
                    <tr key={person.id}>
                      <td className="honor-roster-box">{person.checkedIn ? "✓" : ""}</td>
                      <th scope="row"><ExactValue>{person.lastName}, {person.firstName}</ExactValue>{flagged.has(person.id) && <> <BackgroundCheckBadge /></>}</th>
                      <td translate="no">{person.clubName}</td>
                      {data.hasLocations && <td translate="no">{person.locationName ?? "—"}</td>}
                      <td>{ageText(person.ageOnEventDate)}</td>
                      <td>{rosterGroupLabels[rosterGroupOf(person.attendeeType)]}</td>
                      {includeDietary && <td>{person.dietary ?? ""}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view === "clubs" && (
        <>
          {data.clubs.length > 1 && (
            <nav className="tab-chips honor-roster-tabs" aria-label="Choose club">
              <Link aria-current={!query.club ? "page" : undefined} href={`/more/honors/rosters?${eventQuery}&view=clubs`}>All clubs</Link>
              {data.clubs.map((club) => (
                <Link aria-current={query.club === club.id ? "page" : undefined} href={`/more/honors/rosters?${eventQuery}&view=clubs&club=${encodeURIComponent(club.id)}`} key={club.id}>
                  {club.name}
                </Link>
              ))}
            </nav>
          )}
          {data.clubs.length === 0 && <p className="report-empty">No club has registered for this site yet.</p>}
          {selectedClubs.map((club) => {
            const schedule = buildClubSchedule(club.id, data.sessions, data.offerings, data.enrollments, data.attendees, data.locations);
            return (
              <section className="panel report-panel" key={club.id}>
                <div className="section-heading report-section-heading">
                  <div className="report-title">
                    <span className="report-icon green"><UsersRound aria-hidden="true" size={19} /></span>
                    <div><p className="eyebrow">Club schedule</p><h2 translate="no">{club.name}</h2><p>{schedule.people.length} people{schedule.siteName ? <> · Site: <span translate="no">{schedule.siteName}</span></> : null}</p></div>
                  </div>
                  <ExportLink className="secondary-button report-download" href={csv("club", club.id)}><Download aria-hidden="true" size={15} /> Download CSV</ExportLink>
                </div>
                <div className="report-table-wrap">
                  {scheduleSorting.order.key && <SortOrderNote>{sortLine(scheduleSorting.order)}</SortOrderNote>}
                  <table className="report-table">
                    <caption className="sr-only">Classes for {club.name}</caption>
                    <thead>
                      <tr>
                        <ColumnHeader column="name" label="Name" sorting={scheduleSorting} /><ColumnHeader column="age" label="Age" sorting={scheduleSorting} />
                        {schedule.sessions.map((session) => <th key={session.id} scope="col">{session.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {sortRows(schedule.people, scheduleSorting.order.key, scheduleSorting.order.dir, { name: (row) => nameOf(row.person), age: (row) => row.person.ageOnEventDate }).map((row) => (
                        <tr key={row.person.id}>
                          <th scope="row"><ExactValue>{row.person.lastName}, {row.person.firstName}</ExactValue>{flagged.has(row.person.id) && <> <BackgroundCheckBadge /></>}</th>
                          <td>{ageText(row.person.ageOnEventDate)}</td>
                          {schedule.sessions.map((session) => {
                            const offering = row.bySession[session.id];
                            return (
                              <td key={session.id}>
                                {offering ? <>{offering.honorName}{offering.location ? <><br /><small>{offering.location}</small></> : null}</> : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}
