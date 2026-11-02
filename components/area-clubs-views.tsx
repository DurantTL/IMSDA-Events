import Link from "next/link";
import { ColumnHeader } from "@/components/column-header";
import { EventSetupHelp } from "@/components/event-setup-help";
import { Download } from "lucide-react";
import { AreaClubSearchForm } from "@/components/area-club-search-form";
import {
  eventHeadcount,
  filterClubsByName,
  eventStatusLabels,
  monthStatusLabels,
  pointsChartDescription,
  sortLeaderboard,
  type AreaClubSummary,
  type LeaderboardSort,
} from "@/modules/club-reports/area-summary-domain";
import type { AreaClubEvent } from "@/modules/club-reports/area-summary-repository";
import { supportingRecordMonths } from "@/modules/club-reports/coordinator-destinations-domain";
import { reportMonthLabel } from "@/modules/club-reports/domain";
import { cardCell } from "@/components/table-card-labels";
import { SortOrderNote } from "@/components/list-sort";
import { sortOrderText, sortRows, type ServerSort } from "@/lib/list-sort";
import {
  eventClubAccessors,
  gridAccessors,
  overviewAccessors,
  type EventClubSortColumn,
  type GridSortColumn,
  type OverviewSortColumn,
} from "@/modules/club-reports/area-table-sort";

/**
 * Read-only cross-club report views shared by the Area Coordinator's Clubs
 * section and the conference office. `clubHref` / `reportHref` let each
 * workspace link to its own view-only club and report pages. Counts and
 * points only: Sterling Volunteers shows counts, never names or notes.
 */

const shortMonth = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
const formatNumber = (value: number) => value.toLocaleString("en-US");

export type AreaLinks = {
  clubHref: (organizationId: string) => string;
  reportHref: (organizationId: string, month: string) => string;
};

/** What an empty club list says: nothing matched the search, or there are no clubs at all. */
const noClubsText = (query?: string) => (query ? `No club name matches “${query}”.` : "No active clubs yet.");

/** The empty club list, with what to do about it when there are no clubs at all (#1435). A no-match search has its own way back. */
function NoClubs({ query }: { query?: string }) {
  return (
    <>
      <p className="report-empty">{noClubsText(query)}</p>
      {query ? null : <EventSetupHelp context="the club list" id="staff-no-clubs" />}
    </>
  );
}

/**
 * A club-name search for the area-coordinator tabs (#791). A plain GET form, so
 * it works without scripts and the address keeps the search; the year and sort
 * are carried along. The page filters on the server with `filterClubsByName`.
 * The form itself is a small client component (#1013) so typing filters live.
 */
export function AreaClubSearch({ label = "Search clubs by name", ...props }: { basePath: string; clubYear?: string; query: string; sort?: LeaderboardSort; shown: number; total: number; label?: string }) {
  return <AreaClubSearchForm {...props} label={label} />;
}

const overviewLabels: Record<OverviewSortColumn, string> = { club: "club", director: "director", church: "church", roster: "roster", reports: "reports submitted", points: "total points", lastReport: "last report", sterling: "Sterling Volunteers" };

export function AreaClubsOverview({ clubs, clubYear, links, query, sorting }: { clubs: AreaClubSummary[]; clubYear: string; links: AreaLinks; query?: string; sorting?: ServerSort<OverviewSortColumn> }) {
  if (clubs.length === 0) return <NoClubs query={query} />;
  const rows = sorting?.order.key ? sortRows(clubs, sorting.order.key, sorting.order.dir, overviewAccessors) : clubs;
  return (
    <div className="report-table-wrap card-box" id="club-overview">
      {sorting?.order.key && <SortOrderNote>{sortOrderText(overviewLabels[sorting.order.key], sorting.order.dir, ["roster", "reports", "points", "sterling"].includes(sorting.order.key) ? "number" : sorting.order.key === "lastReport" ? "date" : "text")}</SortOrderNote>}
      <table role="table" className="report-table table-cards table-cards-tablet">
        <caption className="sr-only">Club overview for {clubYear}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <ColumnHeader column="club" label="Club" sorting={sorting} />
            <ColumnHeader column="director" label="Director" sorting={sorting} />
            <ColumnHeader column="church" label="Church" sorting={sorting} />
            <ColumnHeader column="roster" label="Roster" sorting={sorting} />
            <ColumnHeader column="reports" label="Reports submitted" sorting={sorting} />
            <ColumnHeader column="points" label="Total points" sorting={sorting} />
            <ColumnHeader column="lastReport" label="Last report" sorting={sorting} />
            <ColumnHeader column="sterling" label="Sterling Volunteers" sorting={sorting} />
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((club) => (
            <tr role="row" key={club.id}>
              <th role="rowheader" scope="row" translate="no"><Link href={links.clubHref(club.id)}>{club.name}</Link></th>
              <td {...cardCell("Director")} translate="no">{club.directors.length > 0 ? club.directors.join(", ") : "—"}</td>
              <td {...cardCell("Church")} translate="no">{club.church || "—"}</td>
              <td {...cardCell("Roster")}>{club.rosterSize}</td>
              <td {...cardCell("Reports submitted")}>{club.submitted}{club.late > 0 && <small> ({club.late} late)</small>}</td>
              <td {...cardCell("Total points")}><strong>{formatNumber(club.totalPoints)}</strong></td>
              <td {...cardCell("Last report")}>{club.lastReportMonth ? reportMonthLabel(club.lastReportMonth) : "None yet"}</td>
              <td {...cardCell("Sterling Volunteers")}>
                {/* Counts only: who and why stay with the club (#479). */}
                {club.backgroundChecks.notInCompliance} not in compliance · {club.backgroundChecks.expiringSoon} expiring soon · {club.backgroundChecks.missing} missing
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AreaMonthlyReportsTable({ clubs, clubYear, links, query, sorting }: { clubs: AreaClubSummary[]; clubYear: string; links: AreaLinks; query?: string; sorting?: ServerSort<GridSortColumn> }) {
  if (clubs.length === 0) return <NoClubs query={query} />;
  const months = clubs[0]!.months.map((cell) => cell.month);
  const key = sorting?.order.key ?? null;
  const rows = key ? sortRows(clubs, key, sorting!.order.dir, gridAccessors(clubYear)) : clubs;
  const sortedLabel = key === null ? null : key.startsWith("month-") ? `${reportMonthLabel(key.slice(6))} points` : { club: "club", submitted: "submitted", drafts: "drafts", missing: "missing", points: "total points" }[key as "club"];
  return (
    <div className="report-table-wrap club-reports-grid scroll-cue" data-scroll-cue id="monthly-grid">
      {sortedLabel && <SortOrderNote>{sortOrderText(sortedLabel, sorting!.order.dir, key === "club" ? "text" : "number")}</SortOrderNote>}
      <table role="table" className="report-table table-cards">
        <caption className="sr-only">Monthly Record status and points by club for {clubYear}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <ColumnHeader column="club" label="Club" sorting={sorting} />
            {months.map((month) => <ColumnHeader column={`month-${month}`} key={month} label={shortMonth(month)} hiddenLabel="points" sorting={sorting} />)}
            <ColumnHeader column="submitted" label="Submitted" sorting={sorting} />
            <ColumnHeader column="drafts" label="Draft" sorting={sorting} />
            <ColumnHeader column="missing" label="Missing" sorting={sorting} />
            <ColumnHeader column="points" label="Total points" sorting={sorting} />
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((club) => (
            <tr role="row" key={club.id}>
              <th role="rowheader" scope="row" translate="no">{club.name}{club.church && <small>{club.church}</small>}</th>
              {club.months.map((cell) => {
                if (cell.status === "SUBMITTED" || cell.status === "LATE") {
                  return (
                    <td key={cell.month} {...cardCell(shortMonth(cell.month))}>
                      <Link href={links.reportHref(club.id, cell.month)}>{cell.points}</Link>
                      {cell.status === "LATE" && <small> late</small>}
                    </td>
                  );
                }
                if (cell.status === "FUTURE") return <td key={cell.month} {...cardCell(shortMonth(cell.month))} className="club-reports-future"><span aria-hidden="true">—</span><span className="sr-only">{monthStatusLabels.FUTURE}</span></td>;
                return (
                  <td key={cell.month} {...cardCell(shortMonth(cell.month))} className={cell.status === "MISSING" ? "club-reports-missing" : "club-reports-due"}>
                    {monthStatusLabels[cell.status]}
                  </td>
                );
              })}
              <td {...cardCell("Submitted")}>{club.submitted}{club.late > 0 && <small> ({club.late} late)</small>}</td>
              <td {...cardCell("Draft")}>{club.drafts}</td>
              <td {...cardCell("Missing")}>{club.missing}</td>
              <td {...cardCell("Total points")}><strong>{formatNumber(club.totalPoints)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Horizontal bar chart in plain SVG (no chart library). The figure has a text
 * description, the bars are hidden from assistive tech, and the data table
 * right below it carries every number. One row per club, so it reads on a phone.
 */
export function AreaPointsChart({ clubs, clubYear, sort, basePath, query, links, sortHref: customSortHref }: { clubs: AreaClubSummary[]; clubYear: string; sort: LeaderboardSort; basePath: string; query?: string; links?: AreaLinks; sortHref?: (sort: LeaderboardSort) => string }) {
  // Rank and the bar scale come from every club; a search only narrows the rows shown (#791).
  const ranked = sortLeaderboard(clubs, sort);
  const max = Math.max(1, ...ranked.map((club) => club.totalPoints));
  const rankOf = new Map(ranked.map((club, index) => [club.id, index + 1]));
  const sorted = filterClubsByName(ranked, query);
  const sortHref = customSortHref ?? ((value: LeaderboardSort) => `${basePath}?year=${encodeURIComponent(clubYear)}&sort=${value}${query ? `&q=${encodeURIComponent(query)}` : ""}`);
  return (
    <>
      <SortOrderNote>{sort === "name" ? "Sorted by club name, A to Z." : "Sorted by total points, highest first."}</SortOrderNote>
      <p className="field-help">
        Sort by{" "}
        {sort === "points" ? <strong>points</strong> : <Link href={sortHref("points")}>points</Link>}
        {" · "}
        {sort === "name" ? <strong>club name</strong> : <Link href={sortHref("name")}>club name</Link>}
      </p>
      {sorted.length === 0 ? <NoClubs query={query} /> : (
        <>
          <figure className="area-points-chart">
            <figcaption>Total points per club, {clubYear}</figcaption>
            <ul aria-label={pointsChartDescription(sorted, clubYear)} role="img">
              {sorted.map((club) => (
                <li key={club.id}>
                  <span className="area-points-chart-label"><span translate="no">{club.name}</span><strong>{formatNumber(club.totalPoints)}</strong></span>
                  <svg aria-hidden="true" focusable="false" preserveAspectRatio="none" viewBox="0 0 100 6">
                    <rect fill="var(--line, #d6dee2)" height="6" rx="1" width="100" x="0" y="0" />
                    <rect fill="currentColor" height="6" rx="1" width={Math.max(0.5, (club.totalPoints / max) * 100)} x="0" y="0" />
                  </svg>
                </li>
              ))}
            </ul>
          </figure>
          {/* With `links` (the coordinator's view, #1187) each row also lists the submitted records the points rest on, and the grid sits in a labelled scroll region. */}
          <div
            {...(links ? { "aria-label": `Points by club for ${clubYear}. Scroll sideways to see every column.`, role: "region", tabIndex: 0, "data-scroll-cue": true } : {})}
            className={links ? "report-table-wrap scroll-cue coordinator-scroll" : "report-table-wrap"}
          >
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Total points per club for {clubYear}, in chart order</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Rank</th>
                  <th role="columnheader" scope="col">Club</th>
                  <th role="columnheader" scope="col">Report points</th>
                  <th role="columnheader" scope="col">Yearly registration</th>
                  <th role="columnheader" scope="col">Total points</th>
                  {links && <th role="columnheader" scope="col">Supporting records</th>}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {sorted.map((club) => (
                  <tr role="row" key={club.id}>
                    <td {...cardCell("Rank")}>{rankOf.get(club.id)}</td>
                    <th role="rowheader" scope="row" translate="no">{club.name}</th>
                    <td {...cardCell("Report points")}>{formatNumber(club.reportPoints)}</td>
                    <td {...cardCell("Yearly registration")}>{formatNumber(club.totalPoints - club.reportPoints)}</td>
                    <td {...cardCell("Total points")}><strong>{formatNumber(club.totalPoints)}</strong></td>
                    {links && (
                      <td {...cardCell("Supporting records")}>
                        <span className="coordinator-record-links">
                          {supportingRecordMonths(club).map((record) => (
                            <Link key={record.month} href={links.reportHref(club.id, record.month)}>
                              {record.short}<span className="sr-only">: {club.name}, {record.label} record, view only</span>
                            </Link>
                          ))}
                          {supportingRecordMonths(club).length === 0 && <span>No submitted records</span>}
                          <Link href={links.clubHref(club.id)}>Open club<span className="sr-only">: {club.name}</span></Link>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export function AreaClubEvents({ events, clubHref, query, sorting }: { events: AreaClubEvent[]; clubHref: (organizationId: string) => string; query?: string; sorting?: ServerSort<EventClubSortColumn> }) {
  // A search narrows each event's club rows and hides events with no match; the event's own totals stay whole (#791).
  const shownEvents = query ? events.filter((event) => filterClubsByName(event.clubs, query).length > 0) : events;
  if (shownEvents.length === 0) return <><p className="report-empty">{query ? noClubsText(query) : "No club events this club year."}</p>{query ? null : <EventSetupHelp context="club events" id="staff-club-events-none" />}</>;
  return (
    <>
      {sorting?.order.key && <SortOrderNote>{sortOrderText({ club: "club", status: "status", headcount: "headcount" }[sorting.order.key], sorting.order.dir, sorting.order.key === "headcount" ? "number" : "text")}</SortOrderNote>}
      {shownEvents.map((event) => (
        <section className="panel report-panel" key={event.id}>
          <div className="section-heading">
            <div>
              <h3 translate="no">{event.name}</h3>
              <p className="field-help">
                {new Date(event.startsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: event.timezone })}
                {" · "}{event.clubs.filter((club) => club.status === "REGISTERED").length} clubs registered · {formatNumber(eventHeadcount(event.clubs))} people
              </p>
            </div>
            <Link className="secondary-button" href={`/account/area-clubs/kitchen/${encodeURIComponent(event.id)}`}>Kitchen report</Link>
          </div>
          <div className="report-table-wrap">
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Club registrations for {event.name}</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <ColumnHeader column="club" label="Club" hiddenLabel={event.name} sorting={sorting} />
                  <ColumnHeader column="status" label="Status" hiddenLabel={event.name} sorting={sorting} />
                  <ColumnHeader column="headcount" label="Headcount" hiddenLabel={event.name} sorting={sorting} />
                </tr>
              </thead>
              <tbody role="rowgroup">
                {(sorting?.order.key ? sortRows(filterClubsByName(event.clubs, query), sorting.order.key, sorting.order.dir, eventClubAccessors) : filterClubsByName(event.clubs, query)).map((club) => (
                  <tr role="row" key={club.organizationId}>
                    <th role="rowheader" scope="row" translate="no"><Link href={clubHref(club.organizationId)}>{club.name}</Link></th>
                    <td {...cardCell("Status")}>{eventStatusLabels[club.status]}</td>
                    <td {...cardCell("Headcount")}>{club.headcount ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

export function AreaExportLinks({ basePath, clubYear, reports }: { basePath: string; clubYear: string; reports: Array<{ key: "summary" | "points"; label: string }> }) {
  return (
    <div className="intro-actions">
      {reports.map((report) => (
        <a className="secondary-button" href={`${basePath}?report=${report.key}&year=${encodeURIComponent(clubYear)}`} key={report.key}>
          <Download aria-hidden="true" size={15} /> {report.label}
        </a>
      ))}
    </div>
  );
}
