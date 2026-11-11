import {
  clubChurchMemberLabels,
  clubClassLevelLabels,
  rosterTltCell,
  clubRosterGenderLabels,
  clubSchoolGradeLabels,
  clubSchoolTypeLabels,
  rosterSectionOf,
} from "@/modules/club-rosters/domain";
import type { RosterMemberRecord } from "@/modules/club-rosters/repository";
import { z } from "zod";

/**
 * The roster export an Area Coordinator may build (#1760). A separate, closed allow-list: it never grows from the
 * director's `ROSTER_EXPORT_COLUMNS`, so a column added there is not offered here by accident. Birth dates, emergency
 * contacts, phones, emails, addresses, and medical or insurance data are not in it, and the server rejects any key
 * that is not (400). Pure (no server-only), so the builder and the route agree on what a key means.
 */
export const COORDINATOR_ROSTER_EXPORT_COLUMNS = {
  firstName: { header: "First name" },
  lastName: { header: "Last name" },
  club: { header: "Club" },
  type: { header: "Type" },
  role: { header: "Role" },
  classLevel: { header: "Current class" },
  isTlt: { header: "TLT" },
  age: { header: "Age" },
  gender: { header: "Gender" },
  schoolGrade: { header: "Grade" },
  schoolType: { header: "School type" },
  churchMember: { header: "Church member" },
  sterling: { header: "Sterling Volunteers status" },
} as const satisfies Record<string, { header: string }>;

export type CoordinatorRosterExportColumnKey = keyof typeof COORDINATOR_ROSTER_EXPORT_COLUMNS;

/** In the order the builder offers them. */
export const COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS = Object.keys(COORDINATOR_ROSTER_EXPORT_COLUMNS) as CoordinatorRosterExportColumnKey[];

/** Minimal by default: club, first name, last name, role. */
export const DEFAULT_COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS: CoordinatorRosterExportColumnKey[] = ["club", "firstName", "lastName", "role"];

export function isCoordinatorRosterExportColumnKey(value: string): value is CoordinatorRosterExportColumnKey {
  return Object.hasOwn(COORDINATOR_ROSTER_EXPORT_COLUMNS, value);
}

export function coordinatorRosterExportHeader(key: CoordinatorRosterExportColumnKey) {
  return COORDINATOR_ROSTER_EXPORT_COLUMNS[key].header;
}

/** The most clubs one request may name (the whole conference is well under this). */
export const COORDINATOR_ROSTER_EXPORT_MAX_CLUBS = 500;

/**
 * The route's JSON body, parsed: `columns` (ordered keys), `clubs` (`"all"`, or ids), `year` and `preview`. Anything
 * outside the allow-list is a ZodError (a 400), never silently dropped. A POST body, not a query string (a download is
 * audited, so it must never be a link another site can trigger).
 */
export const coordinatorRosterExportBodySchema = z.object({
  columns: z.array(z.string())
    .min(1, "Choose at least one column.")
    .max(COORDINATOR_ROSTER_EXPORT_COLUMN_KEYS.length, "Choose each column only once.")
    .refine((keys) => new Set(keys).size === keys.length, { message: "Choose each column only once." })
    .refine((keys) => keys.every(isCoordinatorRosterExportColumnKey), { message: "One of those columns is not available to Area Coordinators." }),
  clubs: z.union([
    z.literal("all"),
    z.array(z.string().min(1).max(64)).min(1, "Choose all clubs or at least one club.").max(COORDINATOR_ROSTER_EXPORT_MAX_CLUBS, "Too many clubs chosen."),
  ]),
  year: z.string().max(16).optional(),
  preview: z.boolean().default(false),
}).strict().transform((value) => ({
  columns: value.columns as CoordinatorRosterExportColumnKey[],
  clubs: value.clubs === "all" ? ("all" as const) : [...new Set(value.clubs)],
  year: value.year,
  preview: value.preview,
}));

export function parseCoordinatorRosterExportBody(body: unknown) {
  return coordinatorRosterExportBodySchema.parse(body);
}

export type CoordinatorRosterExportRow = {
  clubName: string;
  member: RosterMemberRecord;
  /** The Sterling Volunteers label for an adult, blank for youth. */
  sterling: string;
};

/** Club, then last name, then first name. */
export function sortCoordinatorRosterRows(rows: CoordinatorRosterExportRow[]) {
  return rows.slice().sort((a, b) =>
    a.clubName.localeCompare(b.clubName)
    || a.member.lastName.localeCompare(b.member.lastName)
    || a.member.firstName.localeCompare(b.member.firstName)
    || a.member.id.localeCompare(b.member.id));
}

function cell(row: CoordinatorRosterExportRow, key: CoordinatorRosterExportColumnKey): string {
  const { member } = row;
  switch (key) {
    case "firstName": return member.firstName;
    case "lastName": return member.lastName;
    case "club": return row.clubName;
    case "type": return rosterSectionOf(member.attendeeType) === "STAFF" ? "Staff" : "Youth";
    case "role": return member.role || "";
    case "classLevel": return member.classLevel ? clubClassLevelLabels[member.classLevel] : "";
    case "isTlt": return rosterTltCell(member);
    case "age": return member.age !== null ? String(member.age) : member.reportedAge !== null ? String(member.reportedAge) : "";
    case "gender": return member.gender ? clubRosterGenderLabels[member.gender] : "";
    case "schoolGrade": return member.schoolGrade ? clubSchoolGradeLabels[member.schoolGrade] : "";
    case "schoolType": return member.schoolType ? clubSchoolTypeLabels[member.schoolType] : "";
    case "churchMember": return member.churchMember ? clubChurchMemberLabels[member.churchMember] : "";
    case "sterling": return row.sterling;
  }
}

/** One cell per chosen column, in the chosen order, under the default headers. Backs both the preview and the CSV. */
export function buildCoordinatorRosterTable(rows: CoordinatorRosterExportRow[], keys: CoordinatorRosterExportColumnKey[]) {
  return {
    headers: keys.map(coordinatorRosterExportHeader),
    rows: rows.map((row) => keys.map((key) => cell(row, key))),
  };
}
