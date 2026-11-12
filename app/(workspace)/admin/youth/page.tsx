import type { Metadata } from "next";
import { NavigationLink as Link } from "@/components/navigation-link";
import { notFound, redirect } from "next/navigation";
import { ActAsButton } from "@/components/act-as-button";
import { ColumnHeader } from "@/components/column-header";
import { ExportLink } from "@/components/export-link";
import { GetFilterForm } from "@/components/get-filter-form";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote } from "@/components/list-sort";
import { StaffPageHeader } from "@/components/staff-page-header";
import { cardCell } from "@/components/table-card-labels";
import { paginate } from "@/lib/pagination";
import { serverSort, sortOrderText, type SortKind } from "@/lib/list-sort";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { getCurrentSession } from "@/modules/access/current-session";
import {
  clubChurchMemberLabels,
  clubClassLevelLabels,
  clubClassLevels,
  clubChurchMembers,
  clubSchoolGradeLabels,
  clubSchoolGrades,
  clubSchoolTypeLabels,
  clubSchoolTypes,
} from "@/modules/club-rosters/domain";
import { youthDirectoryViewerFor } from "@/modules/youth-directory/access";
import {
  DEFAULT_YOUTH_SORT,
  NOT_GIVEN,
  YOUTH_SORTS,
  ageText,
  churchMemberLabel,
  classLevelLabel,
  clubChoices,
  countByClub,
  countByGradeAndSchool,
  filterYouth,
  gradeLabel,
  hasYouthFilters,
  parseYouthQuery,
  schoolTypeLabel,
  sortYouth,
  youthQueryString,
  type YouthSort,
} from "@/modules/youth-directory/domain";
import { listYouthDirectoryRows } from "@/modules/youth-directory/repository";
import styles from "./youth-directory.module.css";

export const metadata: Metadata = { title: "Youth directory" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const sortLabels: Record<YouthSort, { label: string; kind: SortKind }> = {
  name: { label: "name", kind: "text" },
  club: { label: "club", kind: "text" },
  grade: { label: "grade", kind: "group" },
  age: { label: "age", kind: "number" },
};

/**
 * The Youth directory (#1685): every active youth on a Pathfinder club roster this club year, for system administrators
 * and active Youth Admins only. Counts first (they follow the filters), then the list and a CSV export. Names, club, age,
 * grade, school type, church membership and class level only: never a birth date, guardian, contact or health detail.
 * A page for anyone else is "not found", the same as a page that does not exist.
 */
export default async function YouthDirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  const role = await youthDirectoryViewerFor(user);
  if (!role) notFound();

  const params = await searchParams;
  const query = parseYouthQuery(params);
  const { clubYear, rows } = await listYouthDirectoryRows(new Date());
  const filtered = hasYouthFilters(query.filters);
  const selected = filterYouth(rows, query.filters);
  const sorted = sortYouth(selected, query.sort);
  const gradeCounts = countByGradeAndSchool(selected);
  const clubCounts = countByClub(selected);
  const maxGrade = Math.max(1, ...gradeCounts.rows.map((row) => row.total));
  const maxClub = Math.max(1, ...clubCounts.map((club) => club.count));
  const slice = paginate(sorted, Number(typeof params.page === "string" ? params.page : 1), PAGE_SIZE);
  const sorting = serverSort<YouthSort>("/admin/youth", Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)), YOUTH_SORTS, DEFAULT_YOUTH_SORT);
  const pageHref = (page: number) => `/admin/youth${youthQueryString(query, page > 1 ? { page: String(page) } : {})}`;
  const exportHref = `/api/admin/youth-directory/export${youthQueryString(query)}`;
  const clubs = clubChoices(rows);
  const activeSort = sorting.order.key ? sortLabels[sorting.order.key] : null;

  return (
    <section className={`page-stack ${styles.workspace}`}>
      <StaffPageHeader
        description={`Club year ${clubYear}. Every active youth on a club roster, for planning outreach. Names, club, age, grade, school type, church membership and class level only.`}
        primary={<ExportLink className="secondary-button" href={exportHref}>Download CSV</ExportLink>}
      />

      {role === "YOUTH_ADMINISTRATOR" && (
        <div className="intro-actions">
          <ActAsButton
            access="View only"
            endpoint="/api/admin/act-as/area-coordinator"
            label="Act as Area Coordinator (2 hours)"
            origin="youth"
            resultAction="Open the Area Coordinator portal"
            role="Area Coordinator"
          />
        </div>
      )}

      <section className={`panel ${styles.panel}`} aria-labelledby="youth-filters-heading">
        <h2 id="youth-filters-heading">Filter</h2>
        <GetFilterForm className={styles.toolbar} action="/admin/youth">
          {query.sort.key !== DEFAULT_YOUTH_SORT.key || query.sort.dir !== DEFAULT_YOUTH_SORT.dir ? (
            <>
              <input type="hidden" name="sort" value={query.sort.key ?? DEFAULT_YOUTH_SORT.key!} />
              <input type="hidden" name="dir" value={query.sort.dir} />
            </>
          ) : null}
          <label>
            Grade
            <select name="grade" defaultValue={query.filters.grade ?? ""}>
              <option value="">Any grade</option>
              {clubSchoolGrades.map((grade) => <option key={grade} value={grade}>{clubSchoolGradeLabels[grade]}</option>)}
              <option value={NOT_GIVEN}>Not given</option>
            </select>
          </label>
          <label>
            School type
            <select name="schoolType" defaultValue={query.filters.schoolType ?? ""}>
              <option value="">Any school type</option>
              {clubSchoolTypes.map((type) => <option key={type} value={type}>{clubSchoolTypeLabels[type]}</option>)}
              <option value={NOT_GIVEN}>Not given</option>
            </select>
          </label>
          <label>
            Church member
            <select name="churchMember" defaultValue={query.filters.churchMember ?? ""}>
              <option value="">Any answer</option>
              {clubChurchMembers.map((value) => <option key={value} value={value}>{clubChurchMemberLabels[value]}</option>)}
              <option value={NOT_GIVEN}>Not given</option>
            </select>
          </label>
          <label>
            Club
            <select name="club" defaultValue={query.filters.club ?? ""}>
              <option value="">Every club</option>
              {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
            </select>
          </label>
          <label>
            Class level
            <select name="classLevel" defaultValue={query.filters.classLevel ?? ""}>
              <option value="">Any class level</option>
              {clubClassLevels.map((level) => <option key={level} value={level}>{clubClassLevelLabels[level]}</option>)}
              <option value={NOT_GIVEN}>Not given</option>
            </select>
          </label>
          <button className="secondary-button" type="submit">Apply</button>
          {filtered && <Link className="secondary-button" href="/admin/youth" prefetch={false}>Clear filters</Link>}
        </GetFilterForm>
      </section>

      <section className={`panel ${styles.panel}`} aria-labelledby="youth-counts-heading" data-testid="youth-counts">
        <h2 id="youth-counts-heading">Counts</h2>
        <div className={styles.total} role="status">
          <strong>{selected.length}</strong>
          <span>{filtered ? `youth match these filters, of ${rows.length}` : "active youth on club rosters"}</span>
        </div>
        {selected.length === 0 ? (
          <div className={styles.empty}>
            <strong>{filtered ? "No youth match these filters" : "No youth on club rosters yet"}</strong>
            <p>{filtered ? "Try a different grade, school type or club, or clear the filters." : "Youth appear here once a club adds them to its roster for this club year."}</p>
            {filtered && <Link className="secondary-button" href="/admin/youth" prefetch={false}>Clear filters</Link>}
          </div>
        ) : (
          <>
            <div className={styles.countGrid}>
              <div className={styles.tableScroll}>
                <table className={styles.counts}>
                  <caption>Youth by grade and school type</caption>
                  <thead>
                    <tr>
                      <th scope="col">Grade</th>
                      {gradeCounts.columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradeCounts.rows.map((row) => (
                      <tr key={row.key}>
                        <th scope="row">{row.label}</th>
                        {gradeCounts.columns.map((column) => <td key={column.key}>{row.bySchoolType[column.key] ?? 0}</td>)}
                        <td>{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">All grades</th>
                      {gradeCounts.columns.map((column) => <td key={column.key}>{column.total}</td>)}
                      <td>{gradeCounts.total}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div>
                <h3 id="youth-by-grade-heading">Youth by grade</h3>
                <ul className={styles.bars} aria-labelledby="youth-by-grade-heading">
                  {gradeCounts.rows.map((row) => (
                    <li className={styles.bar} key={row.key}>
                      <span>{row.label}</span>
                      <span className={styles.barTrack} aria-hidden="true"><span className={styles.barFill} style={{ width: `${Math.max(2, Math.round((row.total / maxGrade) * 100))}%` }} /></span>
                      <span className={styles.barValue}>{row.total}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div>
              <h3 id="youth-by-club-heading">Youth by club</h3>
              <ul className={styles.bars} aria-labelledby="youth-by-club-heading">
                {clubCounts.map((club) => (
                  <li className={styles.bar} key={club.clubId}>
                    <span translate="no">{club.club}</span>
                    <span className={styles.barTrack} aria-hidden="true"><span className={styles.barFill} style={{ width: `${Math.max(2, Math.round((club.count / maxClub) * 100))}%` }} /></span>
                    <span className={styles.barValue}>{club.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      <section className={`panel ${styles.panel}`} aria-labelledby="youth-list-heading">
        <h2 id="youth-list-heading">Youth</h2>
        {slice.total === 0 ? (
          <p className={styles.lead}>{filtered ? "No youth match these filters." : "No youth on club rosters yet."}</p>
        ) : (
          <>
            {activeSort && <SortOrderNote>{sortOrderText(activeSort.label, sorting.order.dir, activeSort.kind)}</SortOrderNote>}
            <div className="report-table-wrap">
              <table role="table" className="report-table table-cards">
                <caption className="sr-only">Youth on club rosters, club year {clubYear}</caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <ColumnHeader column="name" label="Name" sorting={sorting} />
                    <ColumnHeader column="club" label="Club" sorting={sorting} />
                    <ColumnHeader column="age" label="Age" sorting={sorting} />
                    <ColumnHeader column="grade" label="Grade" sorting={sorting} />
                    <th role="columnheader" scope="col">School type</th>
                    <th role="columnheader" scope="col">Church member</th>
                    <th role="columnheader" scope="col">Class level</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {slice.items.map((row) => (
                    <tr role="row" key={row.id}>
                      <th role="rowheader" scope="row" translate="no">{row.name || "Name not given"}</th>
                      <td {...cardCell("Club")} translate="no">{row.club}</td>
                      <td {...cardCell("Age")}>
                        {row.age ? <>{ageText(row.age)}{row.age.reported && <span className={styles.reported}> (reported)</span>}</> : "Not given"}
                      </td>
                      <td {...cardCell("Grade")}>{gradeLabel(row.grade)}</td>
                      <td {...cardCell("School type")}>{schoolTypeLabel(row.schoolType)}</td>
                      <td {...cardCell("Church member")}>{churchMemberLabel(row.churchMember)}</td>
                      <td {...cardCell("Class level")}>{classLevelLabel(row.classLevel)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ListPager hrefFor={pageHref} label="Youth pages" noun="youth" nounOne="youth" slice={slice} />
          </>
        )}
        <p className={styles.note}>Age comes from the birth date on the roster; one marked reported is the age a form gave, with no birth date on file. Messaging families comes later.</p>
      </section>
    </section>
  );
}
