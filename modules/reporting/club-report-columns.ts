/**
 * Club event report columns (#1671): the columns a person may choose for a club event's attendee-level report or CSV.
 * Pure and side-effect free, so the builder, the staff route and the Area Coordinator route all agree on what a column
 * key means and who may see it (the pattern of `modules/club-rosters/export-columns.ts`, #490).
 *
 * Every column names who may see it. The server checks the chosen keys against the viewer and refuses the request when
 * one is not theirs, so a hand-edited request cannot add a column the builder never offered. Health records, guardian
 * contacts and birth dates are never offered to anyone here.
 */
import { formatPersonName } from "@/lib/person-name";
import type { ClubEventRecord } from "@/modules/reporting/club-event-reports";

/**
 * Who may be offered a column:
 * - `everyone`: staff and Area Coordinators alike (what the coordinator view already shows);
 * - `staff`: staff with report access only (never an Area Coordinator);
 * - `dietary`: staff who may read the free-text dietary answer (`canViewDietaryDetails`).
 */
type ColumnAudience = "everyone" | "staff" | "dietary";

type ClubReportColumnDefinition = { header: string; audience: ColumnAudience };

export const CLUB_REPORT_COLUMNS = {
  club: { header: "Club", audience: "everyone" },
  church: { header: "Sponsoring church", audience: "everyone" },
  location: { header: "Location", audience: "everyone" },
  confirmation: { header: "Confirmation", audience: "staff" },
  name: { header: "Name", audience: "everyone" },
  role: { header: "Role", audience: "everyone" },
  age: { header: "Age", audience: "everyone" },
  classLevel: { header: "Class", audience: "everyone" },
  ribbons: { header: "Event ribbons", audience: "everyone" },
  baptismInterest: { header: "Baptism interest", audience: "everyone" },
  medicalVolunteer: { header: "Medical volunteer", audience: "everyone" },
  masterGuide: { header: "Master Guide investiture", audience: "everyone" },
  firstTimeCamper: { header: "First-time camper", audience: "everyone" },
  hasDietaryNeed: { header: "Has a dietary need", audience: "staff" },
  dietaryNeeds: { header: "Dietary needs", audience: "dietary" },
} as const satisfies Record<string, ClubReportColumnDefinition>;

export type ClubReportColumnKey = keyof typeof CLUB_REPORT_COLUMNS;

export const CLUB_REPORT_COLUMN_KEYS = Object.keys(CLUB_REPORT_COLUMNS) as ClubReportColumnKey[];

export function isClubReportColumnKey(value: string): value is ClubReportColumnKey {
  return Object.hasOwn(CLUB_REPORT_COLUMNS, value);
}

/** Minimal by default (the issue's decision): club, name and role. */
export const DEFAULT_CLUB_REPORT_COLUMNS: readonly ClubReportColumnKey[] = ["club", "name", "role"];

/** Rows a preview returns. The server enforces this, never only the builder. */
export const CLUB_REPORT_PREVIEW_ROW_LIMIT = 5;

export type ClubReportViewer =
  | { kind: "staff"; canViewDietaryDetails: boolean }
  | { kind: "coordinator" };

/** Layouts are kept apart by audience, so a coordinator's saved list can never hold a staff-only key. */
export type ClubReportLayoutAudience = "STAFF" | "COORDINATOR";

export function layoutAudienceFor(viewer: ClubReportViewer): ClubReportLayoutAudience {
  return viewer.kind === "staff" ? "STAFF" : "COORDINATOR";
}

export function mayViewClubReportColumn(viewer: ClubReportViewer, key: ClubReportColumnKey): boolean {
  const audience = CLUB_REPORT_COLUMNS[key].audience as ColumnAudience;
  if (audience === "everyone") return true;
  if (viewer.kind !== "staff") return false;
  return audience === "staff" || viewer.canViewDietaryDetails;
}

/** The columns a viewer is offered, in catalog order. */
export function clubReportColumnKeysFor(viewer: ClubReportViewer): ClubReportColumnKey[] {
  return CLUB_REPORT_COLUMN_KEYS.filter((key) => mayViewClubReportColumn(viewer, key));
}

export class ClubReportColumnError extends Error {
  constructor(public readonly code: "UNKNOWN_COLUMN" | "COLUMN_NOT_ALLOWED" | "NO_COLUMNS", message: string, public readonly status: 400 | 403) {
    super(message);
    this.name = "ClubReportColumnError";
  }
}

/**
 * The chosen keys as columns, in the order given. An unknown key is a 400; a known key the viewer may not see is a 403
 * that names it. Nothing is silently dropped, so a refused request never produces a file with fewer columns than asked.
 */
export function resolveClubReportColumns(viewer: ClubReportViewer, keys: readonly string[]): ClubReportColumnKey[] {
  if (keys.length === 0) throw new ClubReportColumnError("NO_COLUMNS", "Choose at least one column.", 400);
  const resolved: ClubReportColumnKey[] = [];
  for (const key of keys) {
    if (!isClubReportColumnKey(key)) throw new ClubReportColumnError("UNKNOWN_COLUMN", "That column does not exist.", 400);
    if (!mayViewClubReportColumn(viewer, key)) {
      throw new ClubReportColumnError("COLUMN_NOT_ALLOWED", `You can't include ${CLUB_REPORT_COLUMNS[key].header} in this report.`, 403);
    }
    if (!resolved.includes(key)) resolved.push(key);
  }
  return resolved;
}

/** Drops keys a viewer may not see, for loading a saved layout (never for a request: those are refused). */
export function visibleClubReportColumns(viewer: ClubReportViewer, keys: readonly unknown[]): ClubReportColumnKey[] {
  const kept: ClubReportColumnKey[] = [];
  for (const key of keys) {
    if (typeof key === "string" && isClubReportColumnKey(key) && mayViewClubReportColumn(viewer, key) && !kept.includes(key)) kept.push(key);
  }
  return kept;
}

export type ClubReportTable = {
  headers: string[];
  rows: string[][];
  /** The club each row belongs to, for printing one page per club. Never part of the CSV. */
  clubNames: string[];
};

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

/**
 * One row per attendee, clubs by name and people by name. `dietaryText` holds the free-text dietary answers by
 * attendee id and is read only for a viewer who may see the `dietaryNeeds` column (the caller builds it only then).
 */
export function buildClubReportTable(
  clubs: readonly ClubEventRecord[],
  columns: readonly ClubReportColumnKey[],
  dietaryText: ReadonlyMap<string, string> = new Map(),
): ClubReportTable {
  const people = clubs
    .flatMap((club) => club.attendees.map((attendee) => ({ club, attendee, name: formatPersonName(attendee, "sorted") })))
    .sort((left, right) => left.club.organizationName.localeCompare(right.club.organizationName) || left.name.localeCompare(right.name));

  const cell = (key: ClubReportColumnKey, entry: typeof people[number]): string => {
    const { club, attendee } = entry;
    switch (key) {
      case "club": return club.organizationName;
      case "church": return club.sponsoringChurch ?? "";
      case "location": return club.locationName ?? "";
      case "confirmation": return club.confirmationCode;
      case "name": return entry.name;
      case "role": return attendee.role ?? "";
      case "age": return attendee.ageOnEventDate === null ? "" : String(attendee.ageOnEventDate);
      case "classLevel": return attendee.classLevel ?? "";
      case "ribbons": return club.eventRibbons;
      case "baptismInterest": return club.baptismNames;
      case "medicalVolunteer": return yesNo(attendee.medicalPersonnel);
      case "masterGuide": return yesNo(attendee.masterGuideInvestiture);
      case "firstTimeCamper": return yesNo(attendee.firstTimeCamper);
      case "hasDietaryNeed": return yesNo(attendee.hasDietaryNeed);
      case "dietaryNeeds": return dietaryText.get(attendee.id) ?? "";
    }
  };

  return {
    headers: columns.map((key) => CLUB_REPORT_COLUMNS[key].header),
    rows: people.map((entry) => columns.map((key) => cell(key, entry))),
    clubNames: people.map((entry) => entry.club.organizationName),
  };
}
