import { NavigationLink as Link } from "@/components/navigation-link";
import { CoordinatorSetupHelp } from "@/components/role-setup-help";
import { Download } from "lucide-react";
import { cardCell } from "@/components/table-card-labels";
import { filterClubsByName, eventHeadcount, eventStatusLabels, type AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import type { AreaClubEvent } from "@/modules/club-reports/area-summary-repository";
import { COORDINATOR_SCOPE_TEXT, fullYearExportLabel } from "@/modules/club-reports/coordinator-overview-domain";
import {
  CLUB_EVENTS_ACTIONS_TEXT,
  MONTHLY_RECORDS_HELP,
  monthlyRecordCells,
  monthlyRecordCounts,
} from "@/modules/club-reports/coordinator-destinations-domain";

/**
 * The coordinator destination pages' shared pieces (#1187). Presentation only:
 * every number comes from the rows the owning queries returned, and nothing here
 * grants, hides or decides anything. Submitted records open read only; there is
 * no approve control, no payment action and no director tool on these pages.
 */

const formatNumber = (value: number) => value.toLocaleString("en-US");
const EXPORT_PATH = "/api/attendee/area-clubs/export";

/** "1 club registered", "3 clubs registered". */
export function registeredClubsLabel(count: number): string {
  return `${count} ${count === 1 ? "club" : "clubs"} registered`;
}

/** Task heading, the club year actually queried, and the honest scope (no ministry or area filter is claimed). */
export function CoordinatorDestinationHeading({ title, clubYear }: { title: string; clubYear?: string }) {
  return (
    <header className="coordinator-overview-heading">
      <h2>{title}</h2>
      <p className="coordinator-overview-scope">
        {clubYear && <><span>Club year <strong>{clubYear}</strong></span><span aria-hidden="true"> · </span></>}
        <span>{COORDINATOR_SCOPE_TEXT}</span>
      </p>
    </header>
  );
}

/** The full-year CSV, labelled with what it covers. It never changes with the search beside it. */
export function CoordinatorExportLink({ clubYear, kind }: { clubYear: string; kind: "summary" | "points" }) {
  return (
    <div className="coordinator-export">
      <div className="intro-actions">
        <a className="secondary-button" href={`${EXPORT_PATH}?report=${kind}&year=${encodeURIComponent(clubYear)}`}>
          <Download aria-hidden="true" size={15} /> {fullYearExportLabel(clubYear, kind)}
        </a>
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
      <Link className="text-button coordinator-inline-link" href={clearHref}>Clear search</Link>
    </p>
  );
}

/** A wide grid in its own labelled, keyboard-reachable scroll region, so the page itself never scrolls sideways. */
export function CoordinatorScrollRegion({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div aria-label={label} className={`report-table-wrap scroll-cue coordinator-scroll ${className}`.trim()} data-scroll-cue role="region" tabIndex={0}>
      {children}
    </div>
  );
}

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
}: {
  clubs: AreaClubSummary[];
  allClubsCount: number;
  clubYear: string;
  query: string;
  clearHref: string;
  now?: Date;
}) {
  if (allClubsCount === 0) return <><p className="report-empty">No active clubs are available to this role yet.</p><CoordinatorSetupHelp context="the club list" id="no-clubs" /></>;
  if (clubs.length === 0) return <CoordinatorNoMatch clearHref={clearHref} query={query} />;
  const months = monthlyRecordCells(clubs[0]!, now).map(({ month, short }) => ({ month, short }));
  return (
    <CoordinatorScrollRegion className="club-reports-grid" label={`Monthly Records by club and month, ${clubYear}. Scroll sideways to see every month.`}>
      <table className="report-table table-cards" role="table">
        <caption className="sr-only">Monthly Record status by club for {clubYear}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Club / church</th>
            {months.map(({ month, short }) => <th key={month} role="columnheader" scope="col">{short}</th>)}
            <th role="columnheader" scope="col">Submitted</th>
            <th role="columnheader" scope="col">Not submitted</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {clubs.map((club) => {
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
  query,
  clearHref,
}: {
  events: AreaClubEvent[];
  query: string;
  clearHref: string;
}) {
  // A search narrows each event's club rows and hides events with no match; an event's own totals stay whole.
  const shownEvents = query ? events.filter((event) => filterClubsByName(event.clubs, query).length > 0) : events;
  if (events.length === 0) return <><p className="report-empty">No club events are published for this club year.</p><CoordinatorSetupHelp context="club events" id="events-none" /></>;
  if (shownEvents.length === 0) return <CoordinatorNoMatch clearHref={clearHref} query={query} />;
  return (
    <>
      {shownEvents.map((event) => (
        <section aria-labelledby={`coordinator-event-${event.id}`} className="coordinator-event" key={event.id}>
          <div className="coordinator-event-head">
            <div>
              <h3 id={`coordinator-event-${event.id}`} translate="no">{event.name}</h3>
              <p className="field-help">
                {new Date(event.startsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: event.timezone })}
                {" · "}{registeredClubsLabel(event.clubs.filter((club) => club.status === "REGISTERED").length)} · {formatNumber(eventHeadcount(event.clubs))} people
              </p>
            </div>
            <Link className="secondary-button" href={`/account/area-clubs/kitchen/${encodeURIComponent(event.id)}`}>
              Kitchen report<span className="sr-only">: {event.name}</span>
            </Link>
          </div>
          <CoordinatorScrollRegion label={`Club registrations for ${event.name}`}>
            <table className="report-table table-cards" role="table">
              <caption className="sr-only">Club registrations for {event.name}</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Club</th>
                  <th role="columnheader" scope="col">Status</th>
                  <th role="columnheader" scope="col">Headcount</th>
                  <th role="columnheader" scope="col">Open club</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {filterClubsByName(event.clubs, query).map((club) => (
                  <tr key={club.organizationId} role="row">
                    <th role="rowheader" scope="row" translate="no">{club.name}</th>
                    <td {...cardCell("Status")}>{eventStatusLabels[club.status]}</td>
                    <td {...cardCell("Headcount")}>{club.headcount ?? "—"}</td>
                    <td {...cardCell("Open club")}>
                      <Link className="secondary-button" href={`/account/area/${encodeURIComponent(club.organizationId)}`}>
                        Open club<span className="sr-only">: {club.name}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CoordinatorScrollRegion>
        </section>
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
