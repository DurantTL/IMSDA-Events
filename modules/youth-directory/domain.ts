import { parseSortParams, sortRows, type SortState, type SortValue } from "@/lib/list-sort";
import {
  clubChurchMemberLabels,
  clubClassLevelLabels,
  clubSchoolGradeLabels,
  clubSchoolGrades,
  clubSchoolTypeLabels,
  clubSchoolTypes,
  clubChurchMembers,
  clubClassLevels,
  type ClubChurchMember,
  type ClubClassLevel,
  type ClubSchoolGrade,
  type ClubSchoolType,
} from "@/modules/club-rosters/domain";

/**
 * The Youth directory (#1685): every active youth on a Pathfinder club roster, for the conference youth director.
 * Pure: filters, sort, counts and the CSV rows, with no database. A row carries only what the directory shows: name,
 * club, age, grade, school type, church membership and class level. Never a birth date, guardian, contact, health
 * answer or gender; `YOUTH_DIRECTORY_FIELDS` is the whole list, and the guard test checks rows hold nothing else.
 */

/** The value of a filter that matches rows where the answer was never given. */
export const NOT_GIVEN = "none";

/** What the repository hands the domain for one youth. Age is computed on the server from the sealed birth date. */
export type YouthDirectoryRow = {
  id: string;
  name: string;
  clubId: string;
  club: string;
  /** Age in years, and whether it is the form's reported age (no birth date on file). Null when neither is known. */
  age: { years: number; reported: boolean } | null;
  grade: ClubSchoolGrade | null;
  schoolType: ClubSchoolType | null;
  churchMember: ClubChurchMember | null;
  classLevel: ClubClassLevel | null;
};

/** Every field a directory row may hold. Anything else (birth date, guardians, contacts, health, gender) never belongs here. */
export const YOUTH_DIRECTORY_FIELDS = ["id", "name", "clubId", "club", "age", "grade", "schoolType", "churchMember", "classLevel"] as const;

export const YOUTH_SORTS = ["name", "club", "grade", "age"] as const;
export type YouthSort = (typeof YOUTH_SORTS)[number];

export type YouthFilters = {
  grade: ClubSchoolGrade | typeof NOT_GIVEN | null;
  schoolType: ClubSchoolType | typeof NOT_GIVEN | null;
  churchMember: ClubChurchMember | typeof NOT_GIVEN | null;
  classLevel: ClubClassLevel | typeof NOT_GIVEN | null;
  /** A club's organization id. */
  club: string | null;
};

export type YouthQuery = { filters: YouthFilters; sort: SortState<YouthSort> };

export const DEFAULT_YOUTH_SORT: SortState<YouthSort> = { key: "name", dir: "asc" };

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | typeof NOT_GIVEN | null {
  if (value === NOT_GIVEN) return NOT_GIVEN;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Reads the filters and sort from search params. A value that is not one of the known choices is ignored, never trusted. */
export function parseYouthQuery(params: Params): YouthQuery {
  const club = first(params.club);
  return {
    filters: {
      grade: oneOf(first(params.grade), clubSchoolGrades),
      schoolType: oneOf(first(params.schoolType), clubSchoolTypes),
      churchMember: oneOf(first(params.churchMember), clubChurchMembers),
      classLevel: oneOf(first(params.classLevel), clubClassLevels),
      // A club id is a short opaque token; anything else is ignored, so no free text reaches a filter, a link or an audit entry.
      club: /^[A-Za-z0-9_-]{1,64}$/.test(club) ? club : null,
    },
    sort: parseSortParams({ sort: params.sort, dir: params.dir }, YOUTH_SORTS, DEFAULT_YOUTH_SORT),
  };
}

/** The query string for a query (only what differs from the default), for links, the export and the audit entry. */
export function youthQueryString(query: YouthQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query.filters)) if (value) params.set(key, value);
  if (query.sort.key !== DEFAULT_YOUTH_SORT.key || query.sort.dir !== DEFAULT_YOUTH_SORT.dir) {
    params.set("sort", query.sort.key ?? DEFAULT_YOUTH_SORT.key!);
    params.set("dir", query.sort.dir);
  }
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function hasYouthFilters(filters: YouthFilters) {
  return Object.values(filters).some(Boolean);
}

function matches(answer: string | null, wanted: string | null) {
  if (!wanted) return true;
  return wanted === NOT_GIVEN ? answer === null : answer === wanted;
}

export function filterYouth(rows: readonly YouthDirectoryRow[], filters: YouthFilters): YouthDirectoryRow[] {
  return rows.filter((row) =>
    matches(row.grade, filters.grade)
    && matches(row.schoolType, filters.schoolType)
    && matches(row.churchMember, filters.churchMember)
    && matches(row.classLevel, filters.classLevel)
    && (!filters.club || row.clubId === filters.club));
}

const compareText = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true });

const sortAccessors: Record<YouthSort, (row: YouthDirectoryRow) => SortValue> = {
  name: (row) => row.name,
  club: (row) => row.club,
  // School order (kindergarten first); no answer is blank, which sorts last in both directions.
  grade: (row) => (row.grade ? clubSchoolGrades.indexOf(row.grade) : null),
  age: (row) => row.age?.years ?? null,
};

/** Rows with no answer sort last. Ties keep name then club order, so the result is stable. */
export function sortYouth(rows: readonly YouthDirectoryRow[], sort: SortState<YouthSort>): YouthDirectoryRow[] {
  const byName = [...rows].sort((a, b) => compareText(a.name, b.name) || compareText(a.club, b.club));
  return sortRows(byName, sort.key ?? DEFAULT_YOUTH_SORT.key, sort.dir, sortAccessors);
}

export type GradeSchoolCounts = {
  /** Grades in school order, then "Not given"; only those with at least one youth. */
  rows: Array<{ key: string; label: string; bySchoolType: Record<string, number>; total: number }>;
  /** School types in order, then "Not given". */
  columns: Array<{ key: string; label: string; total: number }>;
  total: number;
};

/** Totals by grade x school type (a missing answer is its own "Not given" row and column). */
export function countByGradeAndSchool(rows: readonly YouthDirectoryRow[]): GradeSchoolCounts {
  const columns = [
    ...clubSchoolTypes.map((key) => ({ key: key as string, label: clubSchoolTypeLabels[key] as string, total: 0 })),
    { key: NOT_GIVEN, label: "Not given", total: 0 },
  ];
  const gradeKeys: string[] = [...clubSchoolGrades, NOT_GIVEN];
  const table = new Map<string, Record<string, number>>(gradeKeys.map((key) => [key, {}]));
  for (const row of rows) {
    const grade = table.get(row.grade ?? NOT_GIVEN)!;
    const type = row.schoolType ?? NOT_GIVEN;
    grade[type] = (grade[type] ?? 0) + 1;
    columns.find((column) => column.key === type)!.total += 1;
  }
  return {
    rows: gradeKeys
      .map((key) => {
        const bySchoolType = table.get(key)!;
        return {
          key,
          label: key === NOT_GIVEN ? "Not given" : clubSchoolGradeLabels[key as ClubSchoolGrade],
          bySchoolType,
          total: Object.values(bySchoolType).reduce((sum, count) => sum + count, 0),
        };
      })
      .filter((row) => row.total > 0),
    columns,
    total: rows.length,
  };
}

/** Youth per club, most first, then by club name. */
export function countByClub(rows: readonly YouthDirectoryRow[]): Array<{ clubId: string; club: string; count: number }> {
  const counts = new Map<string, { clubId: string; club: string; count: number }>();
  for (const row of rows) {
    const entry = counts.get(row.clubId) ?? { clubId: row.clubId, club: row.club, count: 0 };
    entry.count += 1;
    counts.set(row.clubId, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || compareText(a.club, b.club));
}

/** The clubs that have at least one youth this year, by name, for the club filter. */
export function clubChoices(rows: readonly YouthDirectoryRow[]): Array<{ id: string; name: string }> {
  const clubs = new Map<string, string>();
  for (const row of rows) clubs.set(row.clubId, row.club);
  return [...clubs].map(([id, name]) => ({ id, name })).sort((a, b) => compareText(a.name, b.name));
}

export const ageText = (age: YouthDirectoryRow["age"]) => (age ? String(age.years) : "");

export const YOUTH_CSV_HEADER = ["Name", "Club", "Age", "Age source", "Grade", "School type", "Church member", "Class level"] as const;

/** The export: the header, then one line per youth with exactly the directory's columns. Text cells are guarded against spreadsheet formulas by `toCsv`. */
export function youthCsvRows(rows: readonly YouthDirectoryRow[]): Array<Array<string | number>> {
  return [
    [...YOUTH_CSV_HEADER],
    ...rows.map((row) => [
      row.name,
      row.club,
      ageText(row.age),
      row.age ? (row.age.reported ? "Reported" : "Birth date") : "",
      row.grade ? clubSchoolGradeLabels[row.grade] : "",
      row.schoolType ? clubSchoolTypeLabels[row.schoolType] : "",
      row.churchMember ? clubChurchMemberLabels[row.churchMember] : "",
      row.classLevel ? clubClassLevelLabels[row.classLevel] : "",
    ]),
  ];
}

export const gradeLabel = (grade: ClubSchoolGrade | null) => (grade ? clubSchoolGradeLabels[grade] : "Not given");
export const schoolTypeLabel = (type: ClubSchoolType | null) => (type ? clubSchoolTypeLabels[type] : "Not given");
export const churchMemberLabel = (value: ClubChurchMember | null) => (value ? clubChurchMemberLabels[value] : "Not given");
export const classLevelLabel = (level: ClubClassLevel | null) => (level ? clubClassLevelLabels[level] : "Not given");
