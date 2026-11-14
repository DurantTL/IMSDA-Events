import { ExportLink } from "@/components/export-link";
import { NavigationLink as Link } from "@/components/navigation-link";
import { areaHealthHref } from "@/modules/coordinator-health/domain";
import { ColumnHeader } from "@/components/column-header";
import { RecordCellLink } from "@/components/month-heading-link";
import monthGridStyles from "@/components/month-heading-link.module.css";
import { reportMonthLabel } from "@/modules/club-reports/domain";
import { yearLabel } from "@/modules/club-rosters/home-view";
import { CoordinatorSectionHeading } from "@/components/coordinator-section-heading";
import { CoordinatorSetupHelp } from "@/components/role-setup-help";
import { ChevronDown, Download } from "lucide-react";
import { SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { sortOrderText, sortRows, type ServerSort, type SortValue } from "@/lib/list-sort";
import { eventClubAccessors, type EventClubSortColumn } from "@/modules/club-reports/area-table-sort";
import { filterClubsByName, eventHeadcount, eventStatusLabels, type AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import type { AreaClubEvent } from "@/modules/club-reports/area-summary-repository";
import { COORDINATOR_SCOPE_TEXT, fullYearExportLabel } from "@/modules/club-reports/coordinator-overview-domain";
import {
  CLUB_EVENTS_ACTIONS_TEXT,
  MONTHLY_RECORDS_HELP,
  coordinatorRecordsHref,
  monthlyRecordCells,
  monthlyRecordCounts,
} from "@/modules/club-reports/coordinator-destinations-domain";
import styles from "./coordinator-destinations.module.css";

/**
 * The coordinator destination pages' shared pieces (#1187). Presentation only:
 * every number comes from the rows the owning queries returned, and nothing here
 * grants, hides or decides anything. Submitted records open read only; there is
 * no approve control, no payment action and no director tool on these pages.
 */

/** How many events start open on Club events; the rest start closed (#1554). */
export const COORDINATOR_EVENTS_OPEN_BY_DEFAULT = 3;

const formatNumber = (value: number) => value.toLocaleString("en-US");
const EXPORT_PATH = "/api/attendee/area-clubs/export";

/** "1 club registered", "3 clubs registered". */
export function registeredClubsLabel(count: number): string {
  return `${count} ${count === 1 ? "club" : "clubs"} registered`;
}

/** Task heading in the club portal's eyebrow-and-heading pattern (#1555): the club year actually queried as the eyebrow, and the honest scope (no ministry or area filter is claimed). */
export function CoordinatorDestinationHeading({ title, clubYear }: { title: string; clubYear?: string }) {
  return (
    <CoordinatorSectionHeading eyebrow={clubYear ? `Club year ${yearLabel(clubYear)}` : "Club coordination"} title={title}>
      <p>{COORDINATOR_SCOPE_TEXT}</p>
    </CoordinatorSectionHeading>
  );
}

/** The full-year CSV, labelled with what it covers. It never changes with the search beside it. */
export function CoordinatorExportLink({ clubYear, kind }: { clubYear: string; kind: "summary" | "points" }) {
  return (
    <div className="coordinator-export">
      <div className="intro-actions">
        <ExportLink className="secondary-button" href={`${EXPORT_PATH}?report=${kind}&year=${encodeURIComponent(clubYear)}`}>
          <Download aria-hidden="true" size={15} /> {fullYearExportLabel(clubYear, kind)}
        </ExportLink>
        <Link className="text-button" href={`/account/area-clubs/reports/export?year=${encodeURIComponent(clubYear)}`}>More export options</Link>
      </div>
      <p className="field-help">The CSV covers the full club year for every available club. It does not change with the search below.</p>
    </div>
  );
}

/** A search with no match: the words, and the way back. */
export function CoordinatorNoMatch({ query, clearHref }: { query: string; clearHref: string }) {
  return (
    <p className="report-empty">
      No club name matches “{query}”.{" "}
      <Link className="text-button coordinator-inline-link" href={clearHref}>Clear filters</Link>
    </p>
  );
}

/** A wide grid in its own labelled region. It never scrolls sideways: a grid that does not fit its box is cards (table-cards, #1457). */
export function CoordinatorScrollRegion({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div aria-label={label} className={`report-table-wrap coordinator-scroll ${className}`.trim()} role="region">
      {children}
    </div>
  );
}

export type RecordsGridColumn = "club" | "submitted" | "notSubmitted" | `month-${string}`;
const stateRank = { NOT_SUBMITTED: 0, NOT_DUE: 1, SUBMITTED: 2 } as const;

/**
 * Monthly Records: a club-by-month grid. Submitted opens that record read only,
 * Not submitted and Not due yet are plain text. No approve control.
 */
export function CoordinatorMonthlyRecords({
  clubs,
  allClubsCount,
  clubYear,
  query,
  clearHref,
  now = new Date(),
  sorting,
}: {
  clubs: AreaClubSummary[];
  allClubsCount: number;
  clubYear: string;
  query: string;
  clearHref: string;
  now?: Date;
  /** `club`, `submitted`, `notSubmitted` and one `month-YYYY-MM` per month (sorted by that month's record state). */
  sorting?: ServerSort<RecordsGridColumn>;
}) {
  if (allClubsCount === 0) return <><p className="report-empty">No active clubs are available to this role yet.</p><CoordinatorSetupHelp context="the club list" id="no-clubs" /></>;
  if (clubs.length === 0) return <CoordinatorNoMatch clearHref={clearHref} query={query} />;
  const months = monthlyRecordCells(clubs[0]!, now).map(({ month, short }) => ({ month, short }));
  const key = sorting?.order.key ?? null;
  const accessor = (column: RecordsGridColumn) => (club: AreaClubSummary): SortValue => {
    if (column === "club") return club.name;
    if (column === "submitted") return monthlyRecordCounts(club, now).submitted;
    if (column === "notSubmitted") return monthlyRecordCounts(club, now).notSubmitted;
    const cell = monthlyRecordCells(club, now).find((entry) => `month-${entry.month}` === column);
    return cell ? stateRank[cell.status.state] : null;
  };
  const rows = key ? sortRows(clubs, key, sorting!.order.dir, { [key]: accessor(key) } as Record<RecordsGridColumn, (club: AreaClubSummary) => SortValue>) : clubs;
  const sortedLabel = key === null ? null : key.startsWith("month-") ? `${months.find((entry) => `month-${entry.month}` === key)?.short ?? "month"} record` : { club: "club name", submitted: "submitted", notSubmitted: "not submitted" }[key as "club"];
  return (
    <CoordinatorScrollRegion className="club-reports-grid" label={`Monthly Records by club and month, ${clubYear}`}>
      {sortedLabel && <SortOrderNote>{sortOrderText(sortedLabel, sorting!.order.dir, key === "club" ? "text" : key?.startsWith("month-") ? "state" : "number")}</SortOrderNote>}
      <table className={`report-table table-cards table-cards-xwide ${monthGridStyles.monthGrid}`} role="table">
        <caption className="sr-only">Monthly Record status by club for {clubYear}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <ColumnHeader column="club" label="Club / church" sorting={sorting} />
            {months.map(({ month, short }) => <ColumnHeader column={`month-${month}`} key={month} label={short} hiddenLabel="record" monthLink={{ href: coordinatorRecordsHref({ clubYear, month, query }), label: reportMonthLabel(month) }} sorting={sorting} />)}
            <ColumnHeader column="submitted" label="Submitted" sorting={sorting} />
            <ColumnHeader column="notSubmitted" label="Not submitted" sorting={sorting} />
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((club) => {
            const counts = monthlyRecordCounts(club, now);
            return (
              <tr key={club.id} role="row">
                <th className="coordinator-club-cell" role="rowheader" scope="row">
                  <span translate="no">{club.name}</span>
                  {club.church && <small translate="no">{club.church}</small>}
                </th>
                {monthlyRecordCells(club, now).map((cell) => (
                  <td key={cell.month} {...cardCell(cell.short)} className={cell.status.state === "NOT_DUE" ? "club-reports-future" : undefined}>
                    {cell.status.state === "SUBMITTED" ? (
                      <Link className="coordinator-record-link" href={`/account/area/${encodeURIComponent(club.id)}/reports/${cell.month}`}>
                        Submitted{cell.status.detail && <small> ({cell.status.detail})</small>}
                        <span className="sr-only">: {club.name}, {cell.label}. Opens the record, view only.</span>
                      </Link>
                    ) : cell.status.state === "NOT_SUBMITTED" ? (
                      // Opens the record page, which says "No submitted report ... yet" (#1842).
                      <RecordCellLink href={`/account/area/${encodeURIComponent(club.id)}/reports/${cell.month}`} name={`${club.name}, ${cell.label}: ${cell.status.label.toLowerCase()}`}>
                        {cell.status.label}{cell.status.detail && <small> ({cell.status.detail})</small>}
                      </RecordCellLink>
                    ) : (
                      <span>{cell.status.label}{cell.status.detail && <small> ({cell.status.detail})</small>}</span>
                    )}
                  </td>
                ))}
                <td {...cardCell("Submitted")}>{counts.submitted}</td>
                <td {...cardCell("Not submitted")}>{counts.notSubmitted}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </CoordinatorScrollRegion>
  );
}

export function CoordinatorMonthlyRecordsHelp() {
  return <p className="field-help">{MONTHLY_RECORDS_HELP}</p>;
}

/**
 * Club events: each club event of the club year with every club's status and
 * headcount, and the only actions a coordinator has here: open a club or read
 * the event's kitchen report. There is no payment action, whoever is billed.
 */
export function CoordinatorClubEvents({
  events,
  healthEventIds,
  query,
  clearHref,
  sorting,
}: {
  events: AreaClubEvent[];
  /** Events that get a Health information link: already checked server side against the health page's own rules (#1618). */
  healthEventIds?: readonly string[];
  query: string;
  clearHref: string;
  sorting?: ServerSort<EventClubSortColumn>;
}) {
  // A search narrows each event's club rows and hides events with no match; an event's own totals stay whole.
  const shownEvents = query ? events.filter((event) => filterClubsByName(event.clubs, query).length > 0) : events;
  if (events.length === 0) return <><p className="report-empty">No club events are published for this club year.</p><CoordinatorSetupHelp context="club events" id="events-none" /></>;
  if (shownEvents.length === 0) return <CoordinatorNoMatch clearHref={clearHref} query={query} />;
  return (
    <>
      {sorting?.order.key && <SortOrderNote>{sortOrderText({ club: "club name", status: "status", headcount: "headcount" }[sorting.order.key], sorting.order.dir, sorting.order.key === "headcount" ? "number" : "text")}</SortOrderNote>}
      {shownEvents.map((event, index) => (
        // Native details: the first few events start open, the rest closed so the page is not one long list (#1554).
        // A search opens every match, since the coordinator asked to see those clubs.
        <details className={styles.event} key={event.id} open={Boolean(query) || index < COORDINATOR_EVENTS_OPEN_BY_DEFAULT}>
          <summary className={styles.summary}>
            <div className={styles.summaryText}>
              <h3 translate="no">{event.name}</h3>
              <span className={styles.summaryMeta}>
                {new Date(event.startsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: event.timezone })}
                {" · "}{registeredClubsLabel(event.clubs.filter((club) => club.status === "REGISTERED").length)} · {formatNumber(eventHeadcount(event.clubs))} people
              </span>
            </div>
            <ChevronDown aria-hidden="true" className={styles.chevron} size={20} />
          </summary>
          <div className={styles.body}>
            <div className="coordinator-event-head">
              <Link className="secondary-button" href={`/account/area-clubs/kitchen/${encodeURIComponent(event.id)}`}>
                Kitchen report<span className="sr-only">: {event.name}</span>
              </Link>
              <Link className="secondary-button" href={`/account/area-clubs/events/${encodeURIComponent(event.id)}`}>
                Club teachers<span className="sr-only">: {event.name}</span>
              </Link>
              <Link className="secondary-button" href={`/account/area-clubs/events/${encodeURIComponent(event.id)}/scoring`}>
                Camporee scoring<span className="sr-only">: {event.name}</span>
              </Link>
              <Link className="secondary-button" href={`/account/area-clubs/events/${encodeURIComponent(event.id)}/inspections`}>
                Inspections<span className="sr-only">: {event.name}</span>
              </Link>
              <Link className="secondary-button" href={`/account/area-clubs/events/${encodeURIComponent(event.id)}/attendance-points`}>
                Attendance points<span className="sr-only">: {event.name}</span>
              </Link>
              <Link className="secondary-button" href={`/account/area-clubs/events/${encodeURIComponent(event.id)}/debrief`}>
                Event debrief<span className="sr-only">: {event.name}</span>
              </Link>
              <Link className="secondary-button" href={`/account/area-clubs/events/${encodeURIComponent(event.id)}/budget`}>
                Budget sheet<span className="sr-only">: {event.name}</span>
              </Link>
              <Link className="secondary-button" href={`/account/area-clubs/events/${encodeURIComponent(event.id)}/staffing`}>
                Event staffing<span className="sr-only">: {event.name}</span>
              </Link>
              <Link className="secondary-button" href={`/account/area-clubs/events/${encodeURIComponent(event.id)}/baptism-follow-up`}>
                Baptism follow-up<span className="sr-only">: {event.name}</span>
              </Link>
              <Link className="secondary-button" href={`/account/area-clubs/events/${encodeURIComponent(event.id)}/report`}>
                Attendee report<span className="sr-only">: {event.name}</span>
              </Link>
              {healthEventIds?.includes(event.id) && (
                <Link className="secondary-button" href={areaHealthHref(event.id)}>
                  Health information<span className="sr-only">: {event.name}</span>
                </Link>
              )}
            </div>
            <CoordinatorScrollRegion label={`Club registrations for ${event.name}`}>
              <table className="report-table table-cards" role="table">
                <caption className="sr-only">Club registrations for {event.name}</caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <ColumnHeader column="club" hiddenLabel={event.name} label="Club" sorting={sorting} />
                    <ColumnHeader column="status" hiddenLabel={event.name} label="Status" sorting={sorting} />
                    <ColumnHeader column="headcount" hiddenLabel={event.name} label="Headcount" sorting={sorting} />
                    <th role="columnheader" scope="col">Open club</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {(sorting?.order.key ? sortRows(filterClubsByName(event.clubs, query), sorting.order.key, sorting.order.dir, eventClubAccessors) : filterClubsByName(event.clubs, query)).map((club) => (
                    <tr key={club.organizationId} role="row">
                      <th role="rowheader" scope="row" translate="no">{club.name}</th>
                      <td {...cardCell("Status")}>{eventStatusLabels[club.status]}</td>
                      <td {...cardCell("Headcount")}>{club.headcount ?? "—"}</td>
                      <td {...cardCell("Open club")}>
                        <Link className={`secondary-button ${styles.openClub}`} href={`/account/area/${encodeURIComponent(club.organizationId)}`}>
                          Open club<span className="sr-only">: {club.name}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CoordinatorScrollRegion>
          </div>
        </details>
      ))}
    </>
  );
}

export function CoordinatorClubEventsHelp() {
  return (
    <p className="field-help">
      Each club&apos;s registration status and headcount. Only registered clubs count toward an event&apos;s total. {CLUB_EVENTS_ACTIONS_TEXT}
    </p>
  );
}
