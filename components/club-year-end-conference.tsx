"use client";

import { ExportLink } from "@/components/export-link";
import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Download, Search } from "lucide-react";
import { formatReportYearDueDate } from "@/modules/club-reports/year-end-domain";
import {
  DEFAULT_YEAR_END_TAB,
  YEAR_END_LIST_PATH,
  YEAR_END_PAGE_SIZE,
  YEAR_END_TABS,
  YEAR_END_TAB_LABELS,
  filterYearEndRows,
  parseYearEndTab,
  yearEndDetailHref,
  yearEndFromParam,
  yearEndStatusCounts,
  yearEndStatusLabel,
  yearEndTabCounts,
  type YearEndListRow,
} from "@/modules/club-reports/year-end-list-domain";
import { cardCell } from "@/components/table-card-labels";
import { GuardedLink } from "@/components/guarded-link";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote, SortableHeader } from "@/components/list-sort";
import { SearchClearButton } from "@/components/search-clear-button";
import { SearchResultStatus, useAddressParams, useClientSearch } from "@/components/search-as-you-type";
import { TabList, TabPanel } from "@/components/tab-list";
import { useTableSort, type SortSpec } from "@/components/use-table-sort";
import { paginate } from "@/lib/pagination";
import styles from "./club-year-end-conference.module.css";

type Row = YearEndListRow & { totalMembership: number | null };

/** Sorts from the headers, in the address (#1458); clubs stay in the order the server gave until a column is chosen. */
const YEAR_END_SORT = {
  club: { label: "Club", value: (row) => row.name },
  church: { label: "Sponsoring church", noteLabel: "sponsoring church", value: (row) => row.church },
  status: { label: "Status", value: (row) => yearEndStatusLabel(row.status, row.late) },
  membership: { label: "Total membership", kind: "number", noteLabel: "total membership", value: (row) => row.totalMembership },
} satisfies Record<string, SortSpec<Row>>;

// The tab and page are kept in the address (rules B2 and #1557); a value equal to its default is left out.
const LIST_DEFAULTS = { tab: DEFAULT_YEAR_END_TAB as string, page: "1" };
function parseListParams(params: URLSearchParams) {
  const page = params.get("page") ?? "1";
  return { tab: parseYearEndTab(params.get("tab")) as string, page: /^\d{1,4}$/.test(page) && Number(page) >= 1 ? page : "1" };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Every club's Year-End Report for a Pathfinder year (#607), worked through in tabs (#1843): "Needs review" (submitted
 * reports) first, then "Not submitted" and "All", with a status summary, search by club, church or director, sortable
 * columns and paging. Tab, search, sort and page live in the address, so coming back from a club's detail keeps the
 * place. Counts only, no names of young people; directors are named only to find a club.
 */
export function ClubYearEndConference({ reportYear, initialRows, initialQuery = "" }: { reportYear: string; initialRows: Row[]; initialQuery?: string }) {
  const [rows, setRows] = useState(initialRows);
  const [params, setParams] = useAddressParams(LIST_DEFAULTS, parseListParams);
  const tab = parseYearEndTab(params.tab);
  const search = useClientSearch(initialQuery, undefined, "q");
  const filtered = useMemo(() => filterYearEndRows(rows, tab, search.term), [rows, tab, search.term]);
  const sorted = useTableSort(filtered, YEAR_END_SORT, "yearEnd");
  const slice = paginate(sorted.rows, Number(params.page), YEAR_END_PAGE_SIZE);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const counts = yearEndStatusCounts(rows);
  const tabCounts = yearEndTabCounts(rows);
  // A link into a club's detail carries this list's address, so its back link restores the same view (#1557).
  const pathname = usePathname();
  const addressSearch = useSearchParams();
  const from = pathname === YEAR_END_LIST_PATH ? yearEndFromParam(addressSearch ?? "") : null;
  const resetPage = () => setParams({ page: "1" }, "replace");

  async function reopen(row: Row) {
    setError("");
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/admin/club-reports/year-end/${encodeURIComponent(row.id)}/${reportYear}/reopen`, { method: "POST" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        setError(result.message ?? "The report could not be reopened.");
        return;
      }
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, status: "DRAFT", late: false, totalMembership: null } : item)));
    } catch {
      setError("The report could not be reopened. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  const sortBy = (column: keyof typeof YEAR_END_SORT) => { sorted.headerProps(column).onSort(); resetPage(); };
  const filtersSet = tab !== DEFAULT_YEAR_END_TAB || search.value.trim() !== "";
  const clearSearch = () => { search.setValue(""); resetPage(); };
  const clearFilters = () => { search.setValue(""); setParams({ tab: DEFAULT_YEAR_END_TAB, page: "1" }, "push"); };
  const tabItems = YEAR_END_TABS.map((key) => ({
    key,
    id: `year-end-tab-${key}`,
    panelId: "year-end-panel",
    label: `${YEAR_END_TAB_LABELS[key]} (${tabCounts[key]})`,
  }));
  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">{`Clubs · Pathfinder year ${reportYear}`}</p>
          <h2>Year-End Reports</h2>
          <p>Due {formatReportYearDueDate(reportYear)}.</p>
        </div>
        <ExportLink className="secondary-button" href={`/api/admin/club-reports/year-end/export?year=${reportYear}`}>
          <Download aria-hidden="true" size={16} /> Download CSV
        </ExportLink>
      </div>
      <ul aria-label="Year-End Reports by status" className={styles.summary}>
        <li><strong>{counts.submitted}</strong><span>{`Submitted (${counts.late} late)`}</span></li>
        <li><strong>{counts.draft}</strong><span>Draft</span></li>
        <li><strong>{counts.missing}</strong><span>Missing (no report)</span></li>
      </ul>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <div className={styles.controls}>
        <TabList
          className={styles.tabs}
          label="Year-End Reports"
          onSelect={(key) => setParams({ tab: key, page: "1" }, "push")}
          selectedClassName={styles.tabSelected}
          selectedKey={tab}
          tabClassName={styles.tab}
          tabs={tabItems}
        />
        <div>
          <label className="search-field">
            <Search aria-hidden="true" size={18} />
            <span className="sr-only">Find a club, church or director</span>
            <input
              {...search.inputProps}
              autoComplete="off"
              onChange={(event) => { search.inputProps.onChange(event); resetPage(); }}
              className={styles.search}
              placeholder="Find a club, church or director"
              type="search"
            />
            <SearchClearButton onClear={clearSearch} visible={search.value !== ""} />
          </label>
          {filtersSet && <button className={`secondary-button ${styles.action}`} onClick={clearFilters} type="button">Clear filters</button>}
          <SearchResultStatus message={`${plural(filtered.length, "club", "clubs")} listed.`} />
        </div>
      </div>
      <TabPanel className={styles.panel} id="year-end-panel" tabId={`year-end-tab-${tab}`}>
        {filtered.length === 0 ? (
          <div className="panel">
            {rows.length === 0 ? <p className="report-empty">{`No active clubs for ${reportYear}.`}</p> : search.term.trim() !== "" ? (
              <>
                <p className="report-empty">No club matches that search in this tab.</p>
                <button className={`secondary-button ${styles.action}`} onClick={clearFilters} type="button">Clear filters</button>
              </>
            ) : tab === "needs-review" ? (
              <>
                <p className="report-empty">No submitted reports are waiting.</p>
                <button className={`secondary-button ${styles.action}`} onClick={() => setParams({ tab: "not-submitted", page: "1" }, "push")} type="button">Show not submitted</button>
              </>
            ) : (
              <>
                <p className="report-empty">Every club has submitted its report.</p>
                <button className={`secondary-button ${styles.action}`} onClick={() => setParams({ tab: "needs-review", page: "1" }, "push")} type="button">Show needs review</button>
              </>
            )}
          </div>
        ) : (
          <>
            <ListPager label="Year-End Reports pages" noun="clubs" nounOne="club" onPage={(page) => setParams({ page: String(page) }, "push")} part="count" slice={slice} />
            <div className="table-wrap">
              {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
              <table role="table" className="report-table report-table-auto table-cards">
                <caption className="sr-only">{`Year-End Reports for ${reportYear}`}</caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <SortableHeader {...sorted.headerProps("club")} onSort={() => sortBy("club")} />
                    <SortableHeader {...sorted.headerProps("church")} onSort={() => sortBy("church")} />
                    <th role="columnheader">Directors</th>
                    <SortableHeader {...sorted.headerProps("status")} onSort={() => sortBy("status")} />
                    <SortableHeader {...sorted.headerProps("membership")} onSort={() => sortBy("membership")} />
                    <th role="columnheader"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {slice.items.map((row) => (
                    <tr role="row" key={row.id}>
                      <th role="rowheader" scope="row" translate="no">
                        <GuardedLink className={styles.open} href={yearEndDetailHref(row.id, reportYear, from)}>{row.name}</GuardedLink>
                      </th>
                      <td {...cardCell("Sponsoring church")} translate="no">{row.church}</td>
                      <td {...cardCell("Directors")} className={styles.directors} translate="no">{row.directors.join(", ")}</td>
                      <td {...cardCell("Status")} className={styles.status}>{yearEndStatusLabel(row.status, row.late)}</td>
                      <td {...cardCell("Total membership")}>{row.totalMembership ?? ""}</td>
                      <td {...cardCell(null)}>
                        {row.status === "SUBMITTED" && (
                          <button className={`secondary-button ${styles.action}`} disabled={busyId === row.id} onClick={() => reopen(row)} type="button">
                            Reopen<span className="sr-only">{` ${row.name} report`}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ListPager label="Year-End Reports pages" noun="clubs" nounOne="club" onPage={(page) => setParams({ page: String(page) }, "push")} part="pages" slice={slice} />
          </>
        )}
      </TabPanel>
    </section>
  );
}
