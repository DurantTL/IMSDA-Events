import { z } from "zod";

/**
 * The TLT directory's rules (#1686), free of server-only imports so tests and client components can use them.
 * The directory holds four editable things per TLT (year, position type, status, help-area tags) and nothing from
 * form answers. Ages are whole years; a birth date never appears here.
 */

export type TltDirectoryErrorCode = "NOT_A_TLT" | "NO_ACTIVE_GRANT" | "POSITION_NOT_AVAILABLE" | "TAG_NOT_AVAILABLE" | "NAME_TAKEN" | "ENTRY_NOT_FOUND";

export class TltDirectoryError extends Error {
  constructor(public readonly code: TltDirectoryErrorCode, message: string) {
    super(message);
    this.name = "TltDirectoryError";
  }
}

export const TLT_YEARS = [1, 2, 3, 4] as const;
export type TltYear = (typeof TLT_YEARS)[number];
export const tltYearLabel = (year: number | null) => (year ? `Year ${year}` : "Not set");

export const TLT_STATUSES = ["APPLIED", "APPROVED", "ACTIVE", "FINISHED", "LEFT"] as const;
export type TltStatusValue = (typeof TLT_STATUSES)[number];
/** A TLT with no saved record has no status: "Not set", not a guessed "Applied". */
export const tltStatusLabels: Record<TltStatusValue, string> = {
  APPLIED: "Applied",
  APPROVED: "Approved",
  ACTIVE: "Active",
  FINISHED: "Finished",
  LEFT: "Left",
};
export const tltStatusLabel = (status: TltStatusValue | null) => (status ? tltStatusLabels[status] : "Not set");

/** The NAD TLT operational departments (issue #1686 research). Order is the program's. */
export const SEEDED_POSITION_TYPES = [
  { seedKey: "administrative", name: "Administrative" },
  { seedKey: "ay-classwork-honors", name: "AY Classwork/Honors" },
  { seedKey: "outreach", name: "Outreach" },
  { seedKey: "camping-activities", name: "Camping/Activities" },
  { seedKey: "counseling", name: "Counseling" },
  { seedKey: "finance-clerical", name: "Finance/Clerical" },
] as const;

/** Short help-area names for the TLT Opportunities choices (`tltLeadershipOpportunities` in modules/forms/definition.ts). */
export const SEEDED_HELP_TAGS = [
  { seedKey: "setup", name: "Setup" },
  { seedKey: "photography", name: "Photography" },
  { seedKey: "office", name: "Office" },
  { seedKey: "flag-ceremony", name: "Flag ceremony" },
  { seedKey: "pathfinder-song", name: "Pathfinder Song" },
  { seedKey: "drums", name: "Drums" },
  { seedKey: "taps-reveille", name: "Taps or reveille" },
  { seedKey: "bell", name: "Bell ringing" },
  { seedKey: "mc", name: "MC" },
  { seedKey: "praise-team", name: "Praise team" },
  { seedKey: "scoring", name: "Scoring" },
  { seedKey: "campsite-inspection", name: "Campsite inspection" },
  { seedKey: "uniform-inspection", name: "Uniform inspection" },
  { seedKey: "trash-cleanup", name: "Trash and clean-up" },
  { seedKey: "awards", name: "Awards" },
  { seedKey: "games", name: "Games" },
  { seedKey: "town-crier", name: "Town Crier" },
] as const;

export const LIST_NAME_MAX = 60;

/** A list entry's name: trimmed, single spaces, 1 to 60 characters. */
export const listNameSchema = z.string().trim().min(1, "Enter a name.").max(LIST_NAME_MAX, `Keep the name to ${LIST_NAME_MAX} characters.`)
  .transform((value) => value.replace(/\s+/g, " "));

export const sameListName = (a: string, b: string) => a.trim().toLocaleLowerCase("en-US") === b.trim().toLocaleLowerCase("en-US");

const idSchema = z.string().trim().min(1).max(64);

/** The four fields she may change, for one person. Unknown keys are refused (never a roster field). */
export const profileUpdateSchema = z.object({
  personId: idSchema,
  tltYear: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.null()]),
  positionTypeId: idSchema.nullable(),
  status: z.enum(TLT_STATUSES).nullable(),
  tagIds: z.array(idSchema).max(60).transform((ids) => [...new Set(ids)]),
}).strict();
export type TltProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const listActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), list: z.enum(["position", "tag"]), name: listNameSchema }).strict(),
  z.object({ action: z.literal("rename"), list: z.enum(["position", "tag"]), id: idSchema, name: listNameSchema }).strict(),
  z.object({ action: z.literal("retire"), list: z.enum(["position", "tag"]), id: idSchema }).strict(),
  z.object({ action: z.literal("restore"), list: z.enum(["position", "tag"]), id: idSchema }).strict(),
]);
export type TltListAction = z.infer<typeof listActionSchema>;

export type TltDirectoryRow = {
  personId: string;
  rosterMemberId: string;
  name: string;
  clubId: string;
  clubName: string;
  /** The club's sponsoring church (its parent organization), or "" when none is on file. */
  church: string;
  /** Whole years, or null when the roster has no birth date. */
  age: number | null;
  reportedAge: number | null;
  grade: string | null;
  tltYear: number | null;
  positionTypeId: string | null;
  positionName: string | null;
  status: TltStatusValue | null;
  tags: Array<{ id: string; name: string }>;
};

export const TLT_SORTS = ["name", "club", "year"] as const;
export type TltSort = (typeof TLT_SORTS)[number];

export type TltFilters = {
  q: string;
  clubId: string;
  /** "1" to "4", "none" for Not set, or "". */
  year: string;
  position: string;
  status: string;
  tag: string;
  sort: TltSort;
};

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? "" : value ?? "").trim();

/** Query-string filters, every value capped; anything unknown falls back to "no filter". */
export function parseTltFilters(query: Query): TltFilters {
  const sort = one(query.sort);
  const year = one(query.year);
  const status = one(query.status);
  return {
    q: one(query.q).slice(0, 80),
    clubId: one(query.club).slice(0, 64),
    year: year === "none" || (TLT_YEARS as readonly number[]).includes(Number(year)) ? year : "",
    position: one(query.position).slice(0, 64),
    status: status === "none" || (TLT_STATUSES as readonly string[]).includes(status) ? status : "",
    tag: one(query.tag).slice(0, 64),
    sort: (TLT_SORTS as readonly string[]).includes(sort) ? (sort as TltSort) : "name",
  };
}

export function filterTltRows(rows: readonly TltDirectoryRow[], filters: TltFilters): TltDirectoryRow[] {
  const needle = filters.q.toLocaleLowerCase("en-US");
  return rows.filter((row) => {
    if (needle && !row.name.toLocaleLowerCase("en-US").includes(needle)) return false;
    if (filters.clubId && row.clubId !== filters.clubId) return false;
    if (filters.year === "none" ? row.tltYear !== null : filters.year && row.tltYear !== Number(filters.year)) return false;
    if (filters.position === "none" ? row.positionTypeId !== null : filters.position && row.positionTypeId !== filters.position) return false;
    if (filters.status === "none" ? row.status !== null : filters.status && row.status !== filters.status) return false;
    if (filters.tag && !row.tags.some((tag) => tag.id === filters.tag)) return false;
    return true;
  });
}

const byName = (a: TltDirectoryRow, b: TltDirectoryRow) => a.name.localeCompare(b.name, "en-US") || a.personId.localeCompare(b.personId);

/** Name, club (then name), or TLT year (Year 1 first, Not set last, then name). */
export function sortTltRows(rows: readonly TltDirectoryRow[], sort: TltSort): TltDirectoryRow[] {
  const copy = [...rows];
  if (sort === "club") return copy.sort((a, b) => a.clubName.localeCompare(b.clubName, "en-US") || byName(a, b));
  if (sort === "year") return copy.sort((a, b) => (a.tltYear ?? 99) - (b.tltYear ?? 99) || byName(a, b));
  return copy.sort(byName);
}

export function tltAgeLabel(row: Pick<TltDirectoryRow, "age" | "reportedAge">) {
  if (row.age !== null) return `Age ${row.age}`;
  if (row.reportedAge !== null) return `Age ${row.reportedAge} (reported)`;
  return "Age not recorded";
}

export const TLT_EXPORT_HEADERS = ["Name", "Club", "Sponsoring church", "Age", "Grade", "TLT year", "Position type", "Status", "Help-area tags"] as const;

/** The CSV and print columns: exactly what is on screen. No birth date, contact detail, form answer or school detail. */
export function tltExportTable(rows: readonly TltDirectoryRow[]): { headers: string[]; rows: string[][] } {
  return {
    headers: [...TLT_EXPORT_HEADERS],
    rows: rows.map((row) => [
      row.name,
      row.clubName,
      row.church,
      row.age !== null ? String(row.age) : row.reportedAge !== null ? `${row.reportedAge} (reported)` : "",
      row.grade ?? "",
      tltYearLabel(row.tltYear),
      row.positionName ?? "",
      tltStatusLabel(row.status),
      row.tags.map((tag) => tag.name).join("; "),
    ]),
  };
}

export const exportBodySchema = z.object({
  q: z.string().max(80).default(""),
  club: z.string().max(64).default(""),
  year: z.string().max(8).default(""),
  position: z.string().max(64).default(""),
  status: z.string().max(16).default(""),
  tag: z.string().max(64).default(""),
  sort: z.string().max(8).default("name"),
}).strict();

/** Which filter keys were in use, for the audit entry (keys only: a search text can be a child's name). */
export function activeFilterKeys(filters: TltFilters): string[] {
  const keys: string[] = [];
  if (filters.q) keys.push("q");
  if (filters.clubId) keys.push("club");
  if (filters.year) keys.push("year");
  if (filters.position) keys.push("position");
  if (filters.status) keys.push("status");
  if (filters.tag) keys.push("tag");
  return keys;
}
