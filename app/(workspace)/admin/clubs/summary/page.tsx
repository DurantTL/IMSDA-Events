import type { Metadata } from "next";
import { NavigationLink as Link } from "@/components/navigation-link";
import { redirect } from "next/navigation";
import { LayoutGrid, ClipboardList, ChartNoAxesColumn, CalendarDays } from "lucide-react";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import { AreaClubEvents, AreaClubsOverview, AreaExportLinks, AreaMonthlyReportsTable } from "@/components/area-clubs-views";
import { StaffPoints } from "@/components/staff-points";
import { ListPager } from "@/components/list-pager";
import { StaffMonthlyRecords } from "@/components/staff-monthly-records";
import { ClubDirectoryCards } from "@/components/club-directory";
import { ClubSummaryLegacyAnchor } from "@/components/club-summary-legacy-anchor";
import { ClubNewYearStatus } from "@/components/club-new-year-status";
import { listClubsNewYearStatus } from "@/modules/club-rosters/carry-forward";
import { carryForwardOversightOpen } from "@/modules/club-rosters/carry-forward-domain";
import { clubYearOptions } from "@/modules/club-rosters/domain";
import { hasClubsAdministration } from "@/modules/access/admin-roles";
import { getCurrentSession } from "@/modules/access/current-session";
import { parseClubQuery, parseLeaderboardSort } from "@/modules/club-reports/area-summary-domain";
import { resolveAreaClubYear } from "@/modules/club-reports/area-export";
import { getAreaClubsSummary, listAreaClubEvents } from "@/modules/club-reports/area-summary-repository";
import { buildClubDirectory, clubDirectoryClubHref, clubSummaryAnchors, clubSummaryHref, parseClubSummaryView } from "@/modules/club-reports/club-directory-domain";
import { serverSort } from "@/lib/list-sort";
import {
  EVENT_CLUB_DEFAULT_SORT,
  EVENT_CLUB_SORT_COLUMNS,
  GRID_DEFAULT_SORT,
  OVERVIEW_DEFAULT_SORT,
  OVERVIEW_SORT_COLUMNS,
  gridSortColumns,
} from "@/modules/club-reports/area-table-sort";
import { buildStaffMonthlyRecords } from "@/modules/club-reports/staff-monthly-records-domain";
import { buildStaffPoints } from "@/modules/club-reports/staff-points-domain";
import { AdminPageHeader } from "@/components/admin-page-header";
import { SearchAsYouTypeForm, SearchResultStatus } from "@/components/search-as-you-type";
import styles from "@/components/club-directory.module.css";
import pointsStyles from "@/components/staff-points.module.css";

export const metadata: Metadata = { title: "Club summary" };
export const dynamic = "force-dynamic";

type Search = { year?: string; sort?: string; dir?: string; gridSort?: string; gridDir?: string; overviewSort?: string; overviewDir?: string; q?: string | string[]; view?: string; attention?: string; page?: string; month?: string; show?: string; all?: string };
const views = [
  { key: "directory", label: "Club directory", icon: LayoutGrid },
  { key: "records", label: "Monthly Records", icon: ClipboardList },
  { key: "points", label: "Points", icon: ChartNoAxesColumn },
  { key: "events", label: "Event participation", icon: CalendarDays },
] as const;

/** Staff directory and separately selected reports (#1298), using the same authorized summary data as before. */
export default async function ClubSummaryAdminPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (!(await hasClubsAdministration(user))) redirect("/no-access");
  const params = await searchParams;
  const now = new Date();
  const clubYear = resolveAreaClubYear(params.year, now);
  const view = parseClubSummaryView(params.view, params.sort);
  const query = parseClubQuery(params.q);
  const attention = params.attention === "needs-attention";
  const sort = parseLeaderboardSort(params.sort);
  const [clubs, events, newYearStatus] = await Promise.all([
    getAreaClubsSummary(clubYear, now),
    view === "events" ? listAreaClubEvents(clubYear) : Promise.resolve([]),
    view === "directory" && carryForwardOversightOpen(now) ? listClubsNewYearStatus(now) : Promise.resolve(null),
  ]);
  const points = view === "points" ? buildStaffPoints({ clubs, clubYear, q: params.q, all: params.all }) : null;
  const directory = buildClubDirectory({ clubs, clubYear, now, query, attention, page: Number(params.page ?? 1) });
  // Search, the attention filter and paging only apply to the directory (#1304): links to a report view keep just the year.
  const href = (options: { view?: typeof view; page?: number; sort?: string } = {}) => {
    const target = options.view ?? view;
    return target === "directory" && view === "directory"
      ? clubSummaryHref({ clubYear, query, attention, page: directory.page, ...options })
      : clubSummaryHref({ clubYear, ...options, page: undefined });
  };
  // Each table on a view sorts through its own params (#1458): the records table `sort`/`dir`, the two tables under
  // "Full-year grid" `gridSort` and `overviewSort`, the event tables `sort`/`dir` on their own view.
  // Sort links carry only the params the current view uses, so a stale filter of another view (the directory's
  // `attention`, `page`) never rides along (#1458).
  const viewKeys: Record<typeof view, readonly string[]> = {
    directory: [],
    records: ["year", "view", "month", "q", "show", "all", "sort", "dir", "gridSort", "gridDir", "overviewSort", "overviewDir"],
    points: [],
    events: ["year", "view", "sort", "dir"],
  };
  const searchParamsRecord: Record<string, string | string[] | undefined> = Object.fromEntries(Object.entries(params).filter(([name]) => viewKeys[view].includes(name)));
  const gridSorting = serverSort("/admin/clubs/summary", searchParamsRecord, gridSortColumns(clubYear), GRID_DEFAULT_SORT, { prefix: "grid", hash: "#monthly-grid" });
  const overviewSorting = serverSort("/admin/clubs/summary", searchParamsRecord, OVERVIEW_SORT_COLUMNS, OVERVIEW_DEFAULT_SORT, { prefix: "overview", hash: "#club-overview" });
  const eventSorting = serverSort("/admin/clubs/summary", searchParamsRecord, EVENT_CLUB_SORT_COLUMNS, EVENT_CLUB_DEFAULT_SORT, { hash: "#club-events" });
  const links = {
    clubHref: (id: string) => clubDirectoryClubHref(id, clubYear),
    reportHref: (id: string, month: string) => `/admin/clubs/reports/${encodeURIComponent(id)}/${encodeURIComponent(month)}?year=${encodeURIComponent(clubYear)}`,
  };
  return (
    <section className="page-stack">
      <AdminPageHeader path="/admin/clubs/summary" year={clubYear} clubSummaryView={view} />
      <ClubSummaryLegacyAnchor />
      <StaffPageHeader
        description={`Club year ${clubYear}. Find a club or choose a report. Roster counts are for the selected club year.`}
        primary={(
          <AreaExportLinks
            basePath="/api/admin/club-reports/area-export"
            clubYear={clubYear}
            reports={[{ key: "summary", label: "Summary CSV" }, { key: "points", label: "Points CSV" }]}
          />
        )}
      />
      <nav className={styles.views} aria-label="Club summary views">
        {views.map(({ key, label, icon: Icon }) => (
          <Link key={key} href={`${href({ view: key, sort: key === "points" ? sort : undefined })}#${clubSummaryAnchors[key]}`} aria-current={view === key ? "page" : undefined} prefetch={false}>
            <Icon size={18} aria-hidden="true" />{label}
          </Link>
        ))}
      </nav>
      <h2 className="club-summary-section" id={clubSummaryAnchors[view]}>{views.find((item) => item.key === view)!.label}</h2>
      <SearchAsYouTypeForm className={view === "points" ? `${styles.toolbar} ${pointsStyles.toolbar}` : styles.toolbar} action="/admin/clubs/summary">
        <input type="hidden" name="view" value={view} />
        <label>Club year<select data-default-value={resolveAreaClubYear(undefined, now)} defaultValue={clubYear} name="year">{clubYearOptions(clubYear, now).map((year) => <option key={year}>{year}</option>)}</select></label>
        {view === "directory" ? <>
          <label className={styles.search}>Search by club or church name<input type="search" name="q" defaultValue={query} maxLength={80} autoComplete="off" /></label>
          <label>Show<select data-default-value="all" name="attention" defaultValue={attention ? "needs-attention" : "all"} aria-describedby="club-attention-help"><option value="all">All clubs</option><option value="needs-attention">Needs attention</option></select></label>
        </> : <>
          {view === "points" && <>
            <input type="hidden" name="sort" value={sort} />
            {points?.expanded && <input type="hidden" name="all" value="1" />}
            <label className={styles.search}>Search<span className="sr-only"> by club or church name</span><input type="search" name="q" defaultValue={points?.query} maxLength={80} autoComplete="off" /></label>
          </>}
        </>}
        <button className="secondary-button" type="submit">{view === "directory" ? "Find clubs" : view === "points" ? "Apply" : "Apply year"}</button>
        {view === "directory" && (query || attention) && <Link className="secondary-button" href={clubSummaryHref({ clubYear })} prefetch={false}>Clear filters</Link>}
      </SearchAsYouTypeForm>
      {view === "directory" && <>
        <p className={styles.note} id="club-attention-help">Needs attention: {directory.monthLabel} records that are not submitted or are submitted and awaiting review. This filter only checks that monthly record.</p>
        <ListPager hrefFor={(page) => href({ view: "directory", page })} label="Club directory pages" part="count" noun={query || attention ? `matching clubs (${directory.totalClubs} active clubs in total)` : "active clubs"} nounOne={query || attention ? `matching club (${directory.totalClubs} active clubs in total)` : "active club"} slice={directory} />
        <p className={styles.note}>Sorted by club name.</p>
        {directory.total > 0 ? <ClubDirectoryCards clubs={directory.items} clubYear={clubYear} monthLabel={directory.monthLabel} /> : <div className="panel"><p>{directory.totalClubs === 0 ? "No active clubs for this club year." : "No clubs match these filters. Try another club or church name, or clear the filters."}</p></div>}
        <ListPager hrefFor={(page) => href({ view: "directory", page })} label="Club directory pages" part="pages" slice={directory} />
        {newYearStatus && newYearStatus.clubs.length > 0 && <details className={`panel ${styles.details}`}><summary>Roster carry-forward status</summary><ClubNewYearStatus clubHref={(id) => clubDirectoryClubHref(id, newYearStatus.toClubYear)} status={newYearStatus} /></details>}
      </>}
      {view === "records" && <>
        <Link className="secondary-button" href={`/admin/clubs/reports?year=${encodeURIComponent(clubYear)}`}>Review monthly records</Link>
        <StaffMonthlyRecords clubYear={clubYear} links={links} view={buildStaffMonthlyRecords({ clubs, clubYear, now, month: params.month, q: params.q, show: params.show, all: params.all, sort: params.sort, dir: params.dir })} />
        <details className={`panel ${styles.details}`} open={Boolean(params.gridSort || params.overviewSort) || undefined}>
          <summary>Full-year grid and yearly totals</summary>
          <AreaMonthlyReportsTable clubYear={clubYear} clubs={clubs} links={links} sorting={gridSorting} />
          <p className={styles.note}>Directors, roster counts, report totals and Sterling Volunteers counts.</p>
          <AreaClubsOverview clubYear={clubYear} clubs={clubs} links={links} sorting={overviewSorting} />
        </details>
      </>}
      {points && <SearchResultStatus message={`${points.matches.length} of ${points.totalClubs} clubs shown`} />}
      {points && <StaffPoints clubYear={clubYear} view={points} />}
      {view === "events" && <AreaClubEvents clubHref={links.clubHref} events={events} sorting={eventSorting} />}
    </section>
  );
}
