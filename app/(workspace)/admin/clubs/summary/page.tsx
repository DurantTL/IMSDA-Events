import type { Metadata } from "next";
import { NavigationLink as Link } from "@/components/navigation-link";
import { redirect } from "next/navigation";
import { LayoutGrid, ClipboardList, ChartNoAxesColumn, CalendarDays } from "lucide-react";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { StaffPageHeader } from "@/components/staff-page-header";
import { AreaClubEvents, AreaClubsOverview, AreaExportLinks, AreaMonthlyReportsTable, AreaPointsChart } from "@/components/area-clubs-views";
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
import { buildStaffMonthlyRecords } from "@/modules/club-reports/staff-monthly-records-domain";
import { AdminPageHeader } from "@/components/admin-page-header";
import styles from "@/components/club-directory.module.css";

export const metadata: Metadata = { title: "Club summary" };
export const dynamic = "force-dynamic";

type Search = { year?: string; sort?: string; q?: string | string[]; view?: string; attention?: string; page?: string; month?: string; show?: string; all?: string };
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
  const directory = buildClubDirectory({ clubs, clubYear, now, query, attention, page: Number(params.page ?? 1) });
  // Search, the attention filter and paging only apply to the directory (#1304): links to a report view keep just the year.
  const href = (options: { view?: typeof view; page?: number; sort?: string } = {}) => {
    const target = options.view ?? view;
    return target === "directory" && view === "directory"
      ? clubSummaryHref({ clubYear, query, attention, page: directory.page, ...options })
      : clubSummaryHref({ clubYear, ...options, page: undefined });
  };
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
      <form className={styles.toolbar} method="get" action="/admin/clubs/summary">
        <input type="hidden" name="view" value={view} />
        <label>Club year<select name="year" defaultValue={clubYear}>{clubYearOptions(clubYear, now).map((year) => <option key={year}>{year}</option>)}</select></label>
        {view === "directory" ? <>
          <label className={styles.search}>Search by club or church name<input type="search" name="q" defaultValue={query} maxLength={80} autoComplete="off" /></label>
          <label>Show<select name="attention" defaultValue={attention ? "needs-attention" : "all"} aria-describedby="club-attention-help"><option value="all">All clubs</option><option value="needs-attention">Needs attention</option></select></label>
        </> : <>
          {view === "points" && <input type="hidden" name="sort" value={sort} />}
        </>}
        <button className="secondary-button" type="submit">{view === "directory" ? "Find clubs" : "Apply year"}</button>
        {view === "directory" && (query || attention) && <Link className="secondary-button" href={clubSummaryHref({ clubYear })} prefetch={false}>Clear filters</Link>}
      </form>
      {view === "directory" && <>
        <p className={styles.note} id="club-attention-help">Needs attention: {directory.monthLabel} records that are not submitted or are submitted and awaiting review. This filter only checks that monthly record.</p>
        <p className={styles.note}>Showing {directory.from}–{directory.to} of {directory.total} {query || attention ? `matching clubs (${directory.totalClubs} active clubs in total)` : "active clubs"}. Sorted by club name.</p>
        {directory.total > 0 ? <ClubDirectoryCards clubs={directory.items} clubYear={clubYear} monthLabel={directory.monthLabel} /> : <div className="panel"><p>{directory.totalClubs === 0 ? "No active clubs for this club year." : "No clubs match these filters. Try another club or church name, or clear the filters."}</p></div>}
        {directory.pageCount > 1 && <nav className="list-pager" aria-label="Club directory pages">
          {directory.page > 1 && <Link className="secondary-button" href={href({ view: "directory", page: directory.page - 1 })} prefetch={false}>Previous</Link>}
          <span>Page {directory.page} of {directory.pageCount}</span>
          {directory.page < directory.pageCount && <Link className="secondary-button" href={href({ view: "directory", page: directory.page + 1 })} prefetch={false}>Next</Link>}
        </nav>}
        {newYearStatus && newYearStatus.clubs.length > 0 && <details className={`panel ${styles.details}`}><summary>Roster carry-forward status</summary><ClubNewYearStatus clubHref={(id) => clubDirectoryClubHref(id, newYearStatus.toClubYear)} status={newYearStatus} /></details>}
      </>}
      {view === "records" && <>
        <Link className="secondary-button" href={`/admin/clubs/reports?year=${encodeURIComponent(clubYear)}`}>Review monthly records</Link>
        <StaffMonthlyRecords clubYear={clubYear} links={links} view={buildStaffMonthlyRecords({ clubs, clubYear, now, month: params.month, q: params.q, show: params.show, all: params.all })} />
        <details className={`panel ${styles.details}`}>
          <summary>Full-year grid and yearly totals</summary>
          <AreaMonthlyReportsTable clubYear={clubYear} clubs={clubs} links={links} />
          <p className={styles.note}>Directors, roster counts, report totals and Sterling Volunteers counts.</p>
          <AreaClubsOverview clubYear={clubYear} clubs={clubs} links={links} />
        </details>
      </>}
      {view === "points" && <AreaPointsChart basePath="/admin/clubs/summary" clubYear={clubYear} clubs={clubs} sort={sort} sortHref={(value) => `${href({ view: "points", sort: value })}#points`} />}
      {view === "events" && <AreaClubEvents clubHref={links.clubHref} events={events} />}
    </section>
  );
}
