import { ExportLink } from "@/components/export-link";
import type { Metadata } from "next";
import Link from "next/link";
import { Download, PackageOpen, ShieldCheck, Tent } from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { PrintReportButton } from "@/components/print-report-button";
import { LocationFilter } from "@/components/location-filter";
import { resolveLocationFilter } from "@/modules/event-locations/filter";
import { getTeamSettings } from "@/modules/club-teams/settings-repository";
import { getClubEventReports } from "@/modules/reporting/club-event-reports-repository";
import { resolveClubReportsAccess } from "@/modules/reporting/club-reports-access";
import { staffPageTitles } from "@/components/staff-navigation";
import { cardCell } from "@/components/table-card-labels";
import { ColumnHeader } from "@/components/column-header";
import { SortOrderNote } from "@/components/list-sort";
import { serverSort, sortRows } from "@/lib/list-sort";
import { CLUB_CAMPING_SORT_COLUMNS, CLUB_DUTIES_SORT_COLUMNS, CLUB_MILESTONES_SORT_COLUMNS, CLUB_ROLES_SORT_COLUMNS, UNSORTED, sortLine } from "@/lib/staff-sort-columns";

export const metadata: Metadata = { title: staffPageTitles.clubReports };
export const dynamic = "force-dynamic";

function reportDownloadHref(eventId: string, kind: string, locationId: string | null) {
  return `/api/events/${encodeURIComponent(eventId)}/club-reports?report=${kind}${locationId ? `&location=${encodeURIComponent(locationId)}` : ""}`;
}

export default async function ClubEventReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; location?: string; campingSort?: string; campingDir?: string; dutiesSort?: string; dutiesDir?: string; milestonesSort?: string; milestonesDir?: string; rolesSort?: string; rolesDir?: string }>;
}) {
  const query = await searchParams;
  const { event: requested, location: requestedLocation } = query;
  const { event, allowed, readOnly } = await resolveClubReportsAccess(requested);
  if (!allowed) {
    return (
      <AccessRestricted
        title="Club event reports are restricted"
        detail="This needs report access or Pathfinder event-manager oversight of this club event."
        whoToAsk="your event administrator"
      />
    );
  }
  const eventQuery = `event=${encodeURIComponent(event.id)}`;
  // Each location on its own, or all of them combined with the location named (#413).
  const { locations, locationId } = await resolveLocationFilter(event.id, requestedLocation);
  const reports = await getClubEventReports(event.id, { locationId });
  const usesTeams = (await getTeamSettings(event.id)) !== null;
  const showLocation = locations.length > 0;
  // Each table sorts from its own column headers (its own address pair), from a fixed list of columns; the default is today's order (#1458).
  const path = "/more/reports/clubs";
  const campingSorting = serverSort(path, query, CLUB_CAMPING_SORT_COLUMNS, UNSORTED, { prefix: "camping", hash: "#club-camping" });
  const dutiesSorting = serverSort(path, query, CLUB_DUTIES_SORT_COLUMNS, UNSORTED, { prefix: "duties", hash: "#club-duties" });
  const milestonesSorting = serverSort(path, query, CLUB_MILESTONES_SORT_COLUMNS, UNSORTED, { prefix: "milestones", hash: "#club-milestones" });
  const rolesSorting = serverSort(path, query, CLUB_ROLES_SORT_COLUMNS, UNSORTED, { prefix: "roles", hash: "#club-special-roles" });
  const campingRows = sortRows(reports.camping, campingSorting.order.key, campingSorting.order.dir, {
    club: (row) => row.organizationName,
    location: (row) => row.locationName,
    tents: (row) => row.camping.tents,
    trailers: (row) => row.camping.trailers,
    canopy: (row) => row.camping.kitchenCanopy,
    sqft: (row) => row.camping.totalSqft,
    campNextTo: (row) => row.camping.campNextTo,
    pf: (row) => row.headcounts.pathfinder,
    tlt: (row) => row.headcounts.tlt,
    staff: (row) => row.headcounts.staff,
    child: (row) => row.headcounts.child,
    total: (row) => row.headcounts.total,
  });
  const dutiesRows = sortRows(reports.dutiesActivities, dutiesSorting.order.key, dutiesSorting.order.dir, {
    club: (row) => row.organizationName,
    location: (row) => row.locationName,
    dutyAreas: (row) => row.dutyAreas.join(", "),
    activities: (row) => row.specialActivities.join(", "),
    campsite: (row) => row.assignment?.campsiteLocation,
    duty: (row) => (row.assignment ? [row.assignment.dutyLabel, row.assignment.dutyDay, row.assignment.dutyTime].filter(Boolean).join(" · ") : ""),
    activity: (row) => row.assignment?.activityLabel,
  });
  const milestoneRows = sortRows(reports.milestones, milestonesSorting.order.key, milestonesSorting.order.dir, {
    club: (row) => row.organizationName,
    location: (row) => row.locationName,
    baptism: (row) => row.baptismNames,
    bible: (row) => row.bibleNames,
  });
  const roleRows = sortRows(reports.specialRoles, rolesSorting.order.key, rolesSorting.order.dir, {
    role: (row) => row.role,
    name: (row) => row.name,
    club: (row) => row.organizationName,
    location: (row) => row.locationName,
  });

  return (
    <section className="page-stack reports-workspace">
      <div className="page-intro report-page-intro">
        <div>
          <p className="eyebrow">Event-day planning</p>
          <h2 className="duplicate-page-title">{staffPageTitles.clubReports}</h2>
          <p>Camping coordinator, duties and activities, spiritual milestones, and special roles for {event.name}, built from each club&apos;s registration.{readOnly ? " View only." : ""}</p>
        </div>
        <div className="intro-actions report-actions">
          <Link className="secondary-button" href={`/more/reports?${eventQuery}`}>Back to reports</Link>
          <Link className="secondary-button" href={`/more/reports/clubs/check-in-book?${eventQuery}`}>Check-in book</Link>
          {usesTeams && <Link className="secondary-button" href={`/more/team-results?${eventQuery}`}>Team results</Link>}
          <PrintReportButton />
        </div>
      </div>

      <LocationFilter basePath="/more/reports/clubs" locations={locations} params={{ event: event.id }} selectedId={locationId} />

      <div className="report-safety-note">
        <ShieldCheck aria-hidden="true" size={19} />
        <p><strong>No birth dates or protected free text.</strong> Only submitted and confirmed club registrations count. Waitlisted and cancelled clubs are excluded.</p>
      </div>

      <section className="panel report-panel" id="club-camping">
        <div className="section-heading report-section-heading">
          <div className="report-title">
            <span className="report-icon navy"><Tent aria-hidden="true" size={19} /></span>
            <div><p className="eyebrow">Camping coordinator</p><h2>Camping summary</h2><p>Campsite footprint and headcounts by role, one row per club.</p></div>
          </div>
          <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "camping", locationId)}><Download aria-hidden="true" size={15} /> Download CSV</ExportLink>
        </div>
        {reports.camping.length === 0 ? <p className="report-empty">No active club registrations yet.</p> : (
          <div className="report-table-wrap">
            {campingSorting.order.key && <SortOrderNote>{sortLine(campingSorting.order)}</SortOrderNote>}
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Club camping summary</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <ColumnHeader column="club" label="Club" sorting={campingSorting} />{showLocation && <ColumnHeader column="location" label="Location" sorting={campingSorting} />}<ColumnHeader column="tents" label="Tents" sorting={campingSorting} /><ColumnHeader column="trailers" label="Trailers" sorting={campingSorting} />
                  <ColumnHeader column="canopy" label="Kitchen canopy" sorting={campingSorting} /><ColumnHeader column="sqft" label="Total sq ft" sorting={campingSorting} /><ColumnHeader column="campNextTo" label="Camp next to" sorting={campingSorting} />
                  <ColumnHeader column="pf" label="PF" sorting={campingSorting} /><ColumnHeader column="tlt" label="TLT" sorting={campingSorting} /><ColumnHeader column="staff" label="Staff" sorting={campingSorting} /><ColumnHeader column="child" label="Child" sorting={campingSorting} /><ColumnHeader column="total" label="Total" sorting={campingSorting} />
                  <th role="columnheader" scope="col"><span className="sr-only">Print packet</span></th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {campingRows.map((row) => (
                  <tr role="row" key={row.confirmationCode}>
                    <th role="rowheader" scope="row" translate="no">{row.organizationName}{row.sponsoringChurch && <small> · {row.sponsoringChurch}</small>}</th>
                    {showLocation && <td {...cardCell("Location")} translate="no">{row.locationName ?? "—"}</td>}
                    <td {...cardCell("Tents")}>{row.camping.tents}</td>
                    <td {...cardCell("Trailers")}>{row.camping.trailers}</td>
                    <td {...cardCell("Kitchen canopy")}>{row.camping.kitchenCanopy}</td>
                    <td {...cardCell("Total sq ft")}>{row.camping.totalSqft}</td>
                    <td {...cardCell("Camp next to")}>{row.camping.campNextTo || "—"}</td>
                    <td {...cardCell("PF")}>{row.headcounts.pathfinder}</td>
                    <td {...cardCell("TLT")}>{row.headcounts.tlt}</td>
                    <td {...cardCell("Staff")}>{row.headcounts.staff}</td>
                    <td {...cardCell("Child")}>{row.headcounts.child}</td>
                    <td {...cardCell("Total")}><strong>{row.headcounts.total}</strong></td>
                    <td {...cardCell(null)}><Link className="report-record-link" href={`/more/reports/clubs/packet/${encodeURIComponent(row.organizationId)}?${eventQuery}${row.teamKey ? `&team=${encodeURIComponent(row.teamKey)}` : ""}`}><PackageOpen aria-hidden="true" size={13} /> Packet</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel report-panel" id="club-duties">
        <div className="section-heading report-section-heading">
          <div className="report-title">
            <div><p className="eyebrow">Program planning</p><h2>Duties and activities</h2><p>Each club&apos;s preferences, and staff&apos;s assignment (#410) once it exists.</p></div>
          </div>
          <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "duties-activities", locationId)}><Download aria-hidden="true" size={15} /> Download CSV</ExportLink>
        </div>
        {reports.dutiesActivities.length === 0 ? <p className="report-empty">No active club registrations yet.</p> : (
          <div className="report-table-wrap">
            {dutiesSorting.order.key && <SortOrderNote>{sortLine(dutiesSorting.order)}</SortOrderNote>}
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Club duties and activities</caption>
              <thead role="rowgroup">
                <tr role="row"><ColumnHeader column="club" label="Club" sorting={dutiesSorting} />{showLocation && <ColumnHeader column="location" label="Location" sorting={dutiesSorting} />}<ColumnHeader column="dutyAreas" label="Duty areas" sorting={dutiesSorting} /><ColumnHeader column="activities" label="Activities" sorting={dutiesSorting} /><ColumnHeader column="campsite" label="Assigned campsite" sorting={dutiesSorting} /><ColumnHeader column="duty" label="Assigned duty" sorting={dutiesSorting} /><ColumnHeader column="activity" label="Assigned activity" sorting={dutiesSorting} /></tr>
              </thead>
              <tbody role="rowgroup">
                {dutiesRows.map((row) => (
                  <tr role="row" key={row.confirmationCode}>
                    <th role="rowheader" scope="row" translate="no">{row.organizationName}</th>
                    {showLocation && <td {...cardCell("Location")} translate="no">{row.locationName ?? "—"}</td>}
                    <td {...cardCell("Duty areas")}>{row.dutyAreas.join(", ") || "—"}</td>
                    <td {...cardCell("Activities")}>{row.specialActivities.join(", ") || "—"}</td>
                    <td {...cardCell("Assigned campsite")}>{row.assignment?.campsiteLocation || "Not assigned"}</td>
                    <td {...cardCell("Assigned duty")}>{row.assignment ? [row.assignment.dutyLabel, row.assignment.dutyDay, row.assignment.dutyTime].filter(Boolean).join(" · ") || "Not assigned" : "Not assigned"}</td>
                    <td {...cardCell("Assigned activity")}>{row.assignment?.activityLabel || "Not assigned"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel report-panel" id="club-milestones">
        <div className="section-heading report-section-heading">
          <div className="report-title">
            <div><p className="eyebrow">Pastoral follow-up</p><h2>Spiritual milestones</h2><p>Baptism interest and Bible read-through names, per club.</p></div>
          </div>
          <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "milestones", locationId)}><Download aria-hidden="true" size={15} /> Download CSV</ExportLink>
        </div>
        {reports.milestones.length === 0 ? <p className="report-empty">No club has submitted a baptism or Bible read-through name yet.</p> : (
          <div className="report-table-wrap">
            {milestonesSorting.order.key && <SortOrderNote>{sortLine(milestonesSorting.order)}</SortOrderNote>}
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Club spiritual milestones</caption>
              <thead role="rowgroup"><tr role="row"><ColumnHeader column="club" label="Club" sorting={milestonesSorting} />{showLocation && <ColumnHeader column="location" label="Location" sorting={milestonesSorting} />}<ColumnHeader column="baptism" label="Baptism interest" sorting={milestonesSorting} /><ColumnHeader column="bible" label="Bible read-through" sorting={milestonesSorting} /></tr></thead>
              <tbody role="rowgroup">
                {milestoneRows.map((row) => (
                  <tr role="row" key={row.confirmationCode}>
                    <th role="rowheader" scope="row" translate="no">{row.organizationName}</th>
                    {showLocation && <td {...cardCell("Location")} translate="no">{row.locationName ?? "—"}</td>}
                    <td {...cardCell("Baptism interest")}>{row.baptismNames || "—"}</td>
                    <td {...cardCell("Bible read-through")}>{row.bibleNames || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel report-panel" id="club-special-roles">
        <div className="section-heading report-section-heading">
          <div className="report-title">
            <div><p className="eyebrow">Staffing</p><h2>Special roles</h2><p>Medical personnel and Master Guide investiture candidates, across every club.</p></div>
          </div>
          <ExportLink className="secondary-button report-download" href={reportDownloadHref(event.id, "special-roles", locationId)}><Download aria-hidden="true" size={15} /> Download CSV</ExportLink>
        </div>
        {reports.specialRoles.length === 0 ? <p className="report-empty">No club has flagged medical personnel or a Master Guide candidate yet.</p> : (
          <div className="report-table-wrap">
            {rolesSorting.order.key && <SortOrderNote>{sortLine(rolesSorting.order)}</SortOrderNote>}
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Special roles</caption>
              <thead role="rowgroup"><tr role="row"><ColumnHeader column="role" label="Role" sorting={rolesSorting} /><ColumnHeader column="name" label="Name" sorting={rolesSorting} /><ColumnHeader column="club" label="Club" sorting={rolesSorting} />{showLocation && <ColumnHeader column="location" label="Location" sorting={rolesSorting} />}</tr></thead>
              <tbody role="rowgroup">
                {roleRows.map((row) => (
                  <tr role="row" key={`${row.role}-${row.attendeeId}`}>
                    <td {...cardCell("Role")}>{row.role}</td>
                    <th role="rowheader" scope="row" translate="no">{row.name}</th>
                    <td {...cardCell("Club")} translate="no">{row.organizationName}</td>
                    {showLocation && <td {...cardCell("Location")} translate="no">{row.locationName ?? "—"}</td>}
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

