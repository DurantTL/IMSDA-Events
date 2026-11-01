import { ExportLink } from "@/components/export-link";
import { NavigationLink as Link } from "@/components/navigation-link";
import { ListPager } from "@/components/list-pager";
import { ColumnHeader } from "@/components/column-header";
import { ExactValue } from "@/components/exact-value";
import { NavigationLink as Link } from "@/components/navigation-link";
import { CoordinatorSetupHelp } from "@/components/role-setup-help";
import { Download } from "lucide-react";
import { AreaClubSearch } from "@/components/area-clubs-views";
import { CoordinatorWhosMissing } from "@/components/coordinator-whos-missing";
import { SetupChecklistPanel } from "@/components/setup-checklist-panel";
import { whosMissingWhat } from "@/modules/club-reports/whos-missing-what";
import { buildCoordinatorChecklist, COORDINATOR_CHECKLIST_GUIDE_HREF } from "@/modules/setup-help/coordinator-checklist";
import { CoordinatorRetryButton } from "@/components/coordinator-retry-button";
import { SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import { sortOrderText, sortRows, type ServerSort, type SortValue } from "@/lib/list-sort";
import type { CoordinatorGlanceSortColumn } from "@/modules/club-reports/area-table-sort";
import type { AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import {
  COORDINATOR_SCOPE_TEXT,
  clubRecordStatus,
  fullYearExportLabel,
  overviewTableClubs,
  type CoordinatorOverview,
} from "@/modules/club-reports/coordinator-overview-domain";

/**
 * The coordinator Overview's body (#1186). Presentation only: every number comes
 * from a `CoordinatorOverview` built over `getAreaClubsSummary`'s rows, and a
 * failed read renders the "unavailable" state instead of any count. Counts only
 * for screening; no birth dates, medical details, notes or contact records.
 */

const formatNumber = (value: number) => value.toLocaleString("en-US");
const EXPORT_PATH = "/api/attendee/area-clubs/export";

export type CoordinatorOverviewData =
  | { status: "ready"; clubs: AreaClubSummary[]; overview: CoordinatorOverview }
  | { status: "unavailable" };

/** Task heading, the club year actually queried, and the honest scope. It claims no ministry or area filter. */
export function CoordinatorOverviewHeading({ clubYear }: { clubYear: string }) {
  return (
    <header className="coordinator-overview-heading">
      <h2>Club overview</h2>
      <p className="coordinator-overview-scope">
        <span>Club year <strong>{clubYear}</strong></span>
        <span aria-hidden="true"> · </span>
        <span>{COORDINATOR_SCOPE_TEXT}</span>
      </p>
    </header>
  );
}

/** A failed read: said plainly, with a retry, and never a zero or "Submitted". */
export function CoordinatorUnavailable({ what = "The club overview" }: { what?: string }) {
  return (
    <section aria-labelledby="coordinator-unavailable-title" className="coordinator-unavailable" role="alert">
      <h3 id="coordinator-unavailable-title">{what} is unavailable</h3>
      <p>This information could not be read just now, so no counts, statuses or empty lists are shown. Nothing here means a club has no records or that nothing needs attention.</p>
      <CoordinatorRetryButton />
      {/* Plain text on purpose: a failed read shows no numbers or icons, only the retry and who to ask (#1435). */}
      <p className="field-help">If it stays unavailable, ask the conference office.</p>
    </section>
  );
}

export function CoordinatorSummary({ overview }: { overview: CoordinatorOverview }) {
  return (
    <section aria-labelledby="coordinator-summary-title" className="coordinator-summary">
      <h3 className="sr-only" id="coordinator-summary-title">Summary for {overview.clubYear}</h3>
      <dl>
        <div>
          <dt>Active clubs</dt>
          <dd>{formatNumber(overview.activeClubs)}</dd>
        </div>
        <div>
          <dt>Submitted records, {overview.monthLabel} (due {overview.dueText})</dt>
          <dd>{overview.recordsText}</dd>
        </div>
        <div>
          <dt>Roster members, {overview.clubYear}</dt>
          <dd>{formatNumber(overview.rosterMembers)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function CoordinatorFollowUp({ overview, clubYear, query = "" }: { overview: CoordinatorOverview; clubYear: string; query?: string }) {
  // The count always speaks about every club; the names follow the search, like the table beside it.
  const listed = overviewTableClubs(overview.followUp, query);
  const recordsHref = `/account/area-clubs/reports?year=${encodeURIComponent(clubYear)}`;
  return (
    <section aria-labelledby="coordinator-follow-up-title" className="coordinator-panel coordinator-follow-up">
      <h3 id="coordinator-follow-up-title">Follow-up: {overview.monthLabel} records (due {overview.dueText})</h3>
      {overview.activeClubs === 0 ? (
        <p>There are no clubs to follow up on.</p>
      ) : overview.monthNotDue ? (
        <p>{overview.monthLabel} records are not due yet (due {overview.dueText}), so none are listed.</p>
      ) : overview.followUp.length === 0 ? (
        <p>Every club has submitted its {overview.monthLabel} record.</p>
      ) : (
        <>
          <p>{overview.followUp.length} of {overview.recordDenominator} clubs have no submitted {overview.monthLabel} record.</p>
          {query && <p className="field-help">{listed.length} of {overview.followUp.length} listed below match “{query}”.</p>}
          {listed.length > 0 && (
            <ul>
              {listed.map((club) => (
                <li key={club.id}><span translate="no">{club.name}</span></li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="field-help">For information only. This page sets no deadline and sends no messages.</p>
      <Link className="text-button" href={recordsHref}>Open Monthly Records</Link>
    </section>
  );
}

export function CoordinatorHelp() {
  return (
    <aside aria-labelledby="coordinator-help-title" className="coordinator-panel coordinator-help">
      <h3 id="coordinator-help-title">About this view</h3>
      <p>Your role is read-only. The club director maintains the roster and the club&apos;s settings, so ask the director for any change.</p>
      <p>Screening shows counts only. Open a club to see what your role may view there.</p>
    </aside>
  );
}

/**
 * Club-name search, "N of M clubs shown" and the table. The search narrows this
 * table only; the CSV above it is the full year for every available club.
 */
export function CoordinatorClubsAtAGlance({
  clubs,
  overview,
  query,
  now = new Date(),
  sorting,
}: {
  clubs: AreaClubSummary[];
  overview: CoordinatorOverview;
  query: string;
  now?: Date;
  sorting?: ServerSort<CoordinatorGlanceSortColumn>;
}) {
  // Sorting only reorders the clubs the search already narrowed to (#1458).
  const accessors: Record<CoordinatorGlanceSortColumn, (club: AreaClubSummary) => SortValue> = {
    club: (club) => club.name,
    roster: (club) => club.rosterSize,
    adults: (club) => club.adultCount,
    record: (club) => clubRecordStatus(club, overview.month, now).label,
    sterling: (club) => club.backgroundChecks.notInCompliance,
  };
  const found = overviewTableClubs(clubs, query);
  const shown = sorting?.order.key ? sortRows(found, sorting.order.key, sorting.order.dir, accessors) : found;
  const sortWords: Record<CoordinatorGlanceSortColumn, string> = { club: "club name", roster: "roster", adults: "adults and staff", record: `${overview.monthLabel} record`, sterling: "Sterling Volunteers not in compliance" };
  const clearHref = `/account/area-clubs/overview?year=${encodeURIComponent(overview.clubYear)}`;
  return (
    <section aria-labelledby="coordinator-clubs-title" className="coordinator-clubs">
      <h3 id="coordinator-clubs-title">Clubs at a glance</h3>
      <div className="coordinator-export">
        <div className="intro-actions">
          <ExportLink className="secondary-button" href={`${EXPORT_PATH}?report=summary&year=${encodeURIComponent(overview.clubYear)}`}>
            <Download aria-hidden="true" size={15} /> {fullYearExportLabel(overview.clubYear)}
          </ExportLink>
          <ExportLink className="secondary-button" href={`${EXPORT_PATH}?report=points&year=${encodeURIComponent(overview.clubYear)}`}>
            <Download aria-hidden="true" size={15} /> {fullYearExportLabel(overview.clubYear, "points")}
          </ExportLink>
        </div>
        <p className="field-help">The CSV files cover the full club year for every available club. They do not change with the search below.</p>
      </div>
      {clubs.length === 0 ? (
        <>
          <p className="report-empty">No active clubs are available to this role yet.</p>
          <CoordinatorSetupHelp context="the club list" id="no-clubs" />
        </>
      ) : (
        <>
          <AreaClubSearch basePath="/account/area-clubs/overview" clubYear={overview.clubYear} label="Search clubs by name" query={query} shown={shown.length} total={clubs.length} />
          <ListPager label="Clubs shown" noun="clubs" nounOne="club" slice={{ from: shown.length === 0 ? 0 : 1, to: shown.length, total: shown.length, page: 1, pageCount: 1 }} />
          {shown.length === 0 ? (
            <p className="report-empty">
              No club name matches “{query}”.{" "}
              <Link className="text-button" href={clearHref}>Clear filters</Link>
            </p>
          ) : (
            <div className="report-table-wrap card-box">
              {sorting?.order.key && <SortOrderNote>{sortOrderText(sortWords[sorting.order.key], sorting.order.dir, ["roster", "adults", "sterling"].includes(sorting.order.key) ? "number" : "text")}</SortOrderNote>}
              <table className="report-table table-cards table-cards-tablet" role="table">
                <caption className="sr-only">Clubs for {overview.clubYear}, with the {overview.monthLabel} record status</caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <ColumnHeader column="club" label="Club / church" sorting={sorting} />
                    <ColumnHeader column="roster" label="Roster" sorting={sorting} />
                    <ColumnHeader column="adults" label="Adults & staff" sorting={sorting} />
                    <ColumnHeader column="record" label={`${overview.monthLabel} record`} sorting={sorting} />
                    <ColumnHeader column="sterling" label="Sterling Volunteers" sorting={sorting} />
                    <th role="columnheader" scope="col">Open club</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {shown.map((club) => {
                    const record = clubRecordStatus(club, overview.month, now);
                    return (
                      <tr key={club.id} role="row">
                        <th className="coordinator-club-cell" role="rowheader" scope="row">
                          <span translate="no">{club.name}</span>
                          {club.church && <small translate="no">{club.church}</small>}
                          <small>Director: {club.directors.length > 0 ? <ExactValue>{club.directors.join(", ")}</ExactValue> : "none listed"}</small>
                        </th>
                        <td {...cardCell("Roster")}>{formatNumber(club.rosterSize)}</td>
                        <td {...cardCell("Adults & staff")}>{formatNumber(club.adultCount)}</td>
                        <td {...cardCell(`${overview.monthLabel} record`)}>
                          {record.label}{record.detail && <small> ({record.detail})</small>}
                        </td>
                        <td {...cardCell("Sterling Volunteers")}>
                          {/* Counts only: who and why stay with the club (#479). */}
                          {club.backgroundChecks.notInCompliance} not in compliance · {club.backgroundChecks.expiringSoon} expiring soon · {club.backgroundChecks.missing} missing
                        </td>
                        <td {...cardCell("Open club")}>
                          <Link className="secondary-button" href={`/account/area/${club.id}`}>
                            Open club<span className="sr-only">: {club.name}</span>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The whole Overview body for either outcome of the read. */
export function CoordinatorOverviewBody({ data, query, now = new Date(), sorting }: { data: CoordinatorOverviewData; query: string; now?: Date; sorting?: ServerSort<CoordinatorGlanceSortColumn> }) {
  if (data.status === "unavailable") return <CoordinatorUnavailable />;
  const { clubs, overview } = data;
  // Both come from the club rows above, so neither can show a club the table does not (#1435).
  const missing = whosMissingWhat(clubs, overview.month, now);
  // Like Follow-up beside it, the names follow the search while every count speaks about all clubs.
  const shownIds = new Set(overviewTableClubs(clubs, query).map((club) => club.id));
  const shownMissing = missing.filter((row) => shownIds.has(row.clubId));
  const checklist = buildCoordinatorChecklist({
    clubYear: overview.clubYear,
    clubCount: clubs.length,
    clubsWithoutDirector: clubs.filter((club) => club.directors.length === 0).length,
    recordsMissing: overview.followUp.length,
    monthNotDue: overview.monthNotDue,
    monthLabel: overview.monthLabel,
    clubsBehind: missing.length,
  });
  return (
    <>
      <SetupChecklistPanel
        checklist={checklist}
        eyebrow="Getting started"
        guide={{ href: COORDINATOR_CHECKLIST_GUIDE_HREF, label: "Read the Getting started guide" }}
        headingId="coordinator-getting-started"
        storageKey="imsda-events:getting-started-collapsed:coordinator"
        title="Getting started as an area coordinator"
      />
      {checklist.hidden && <p className="field-help role-guide-link"><Link className="text-button" href={COORDINATOR_CHECKLIST_GUIDE_HREF}>Getting started guide</Link></p>}
      <CoordinatorSummary overview={overview} />
      <CoordinatorWhosMissing clubCount={clubs.length} monthLabel={overview.monthLabel} query={query} rows={shownMissing} totalMissing={missing.length} />
      <div className="coordinator-overview-layout">
        <CoordinatorClubsAtAGlance clubs={clubs} now={now} overview={overview} query={query} sorting={sorting} />
        <div className="coordinator-overview-side">
          <CoordinatorFollowUp clubYear={overview.clubYear} overview={overview} query={query} />
          <CoordinatorHelp />
        </div>
      </div>
    </>
  );
}
