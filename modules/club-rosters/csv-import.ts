import { rosterClassFrom } from "@/modules/club-imports/domain";
import type { ClubBaptized, RosterClassLevel, ClubSchoolGrade } from "@/modules/club-rosters/domain";
import {
  clubRosterAttendeeTypeLabels,
  missingRosterFields,
  parseRosterBirthDateInput,
  rosterFieldLabels,
  rosterRoleOrDefault,
  schoolGradeFromText,
  clubBaptizedAnswers,
  clubBaptizedLabels,
} from "@/modules/club-rosters/domain";
import { parseCsvMatrix } from "@/modules/imports/csv-parser";
import { toCsv } from "@/modules/reporting/csv";
import { formatPersonName } from "@/lib/person-name";

/**
 * Club roster CSV (#384): a template to fill in, and an upload that adds new
 * people and updates people already on this year's roster. Pure: parsing and
 * planning only; the route applies the plan through the normal roster
 * functions, so every rule (sealed birth dates, duplicates) still holds.
 *
 * A person is matched by name. The preview never shows anything already on
 * file (no birth dates), only what the file says and what will happen.
 */

export const ROSTER_CSV_HEADERS = ["First name", "Last name", "Birth date", "Type", "Current class", "Grade", "Role", "Gender", "Baptized"] as const;
export const MAX_ROSTER_CSV_ROWS = 500;
export const MAX_ROSTER_CSV_BYTES = 200_000;

export function rosterCsvTemplate() {
  return toCsv([[...ROSTER_CSV_HEADERS]]);
}

type AttendeeType = "YOUTH" | "STAFF" | "ADULT" | "UNDERAGE";

export type RosterCsvRow = {
  line: number;
  firstName: string;
  lastName: string;
  /** Undefined means the cell was blank: keep what's on file. */
  birthDate?: string;
  attendeeType?: AttendeeType;
  classLevel?: RosterClassLevel | null;
  /** Teen Leadership Training (#1851), youth only. Undefined means the cell was blank: keep what's on file. */
  isTlt?: boolean;
  /** School grade (#1664). Undefined means the cell was blank: keep what's on file. */
  schoolGrade?: ClubSchoolGrade;
  /** Baptized (#1852), any type. Undefined means the cell was blank: keep what's on file. Never listed as missing. */
  baptized?: ClubBaptized;
  role?: string;
  gender?: "FEMALE" | "MALE" | null;
  problems: string[];
};

const headerKeys: Record<string, keyof Omit<RosterCsvRow, "line" | "problems">> = {
  firstname: "firstName",
  first: "firstName",
  lastname: "lastName",
  last: "lastName",
  birthdate: "birthDate",
  dateofbirth: "birthDate",
  dob: "birthDate",
  type: "attendeeType",
  class: "classLevel",
  classlevel: "classLevel",
  currentclass: "classLevel",
  tlt: "isTlt",
  teenleadershiptraining: "isTlt",
  grade: "schoolGrade",
  schoolgrade: "schoolGrade",
  baptized: "baptized",
  role: "role",
  gender: "gender",
};

const typeValues: Record<string, AttendeeType> = {
  youth: "YOUTH",
  pathfinder: "YOUTH",
  member: "YOUTH",
  staff: "STAFF",
  adult: "ADULT",
  underage: "UNDERAGE",
};

const clean = (value: string | undefined) => (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

export class RosterCsvError extends Error {}

/** "2014-04-17", "4/17/2014", or "4/17/14" → "2014-04-17" (#424: the shared century rule). */
export function parseRosterCsv(text: string, currentYear = new Date().getFullYear()): RosterCsvRow[] {
  if (text.length > MAX_ROSTER_CSV_BYTES) throw new RosterCsvError("That file is too large. Upload up to 500 people at a time.");
  const matrix = parseCsvMatrix(text.replace(/^﻿/, ""));
  if (matrix.length === 0) throw new RosterCsvError("That file is empty. Download the template and fill it in.");
  const columns = matrix[0].map((header) => headerKeys[header.toLowerCase().replace(/[^a-z]/g, "")]);
  if (!columns.includes("firstName") || !columns.includes("lastName")) {
    throw new RosterCsvError("The first row needs the column names from the template, including First name and Last name.");
  }
  const body = matrix.slice(1);
  if (body.length > MAX_ROSTER_CSV_ROWS) throw new RosterCsvError("Upload up to 500 people at a time.");

  return body.map((cells, index) => {
    const row: RosterCsvRow = { line: index + 2, firstName: "", lastName: "", problems: [] };
    let classTlt = false;
    let columnTlt: boolean | undefined;
    columns.forEach((key, column) => {
      if (!key) return;
      const value = clean(cells[column]);
      if (key === "firstName" || key === "lastName") {
        row[key] = value.slice(0, 80);
        return;
      }
      if (value === "") return;
      if (key === "birthDate") {
        const date = parseRosterBirthDateInput(value, currentYear);
        if (date) row.birthDate = date;
        else row.problems.push(`Birth date "${value}" isn't a date. Use 2014-04-17, 4/17/2014, or 4/17/14.`);
      } else if (key === "attendeeType") {
        const type = typeValues[value.toLowerCase()];
        if (type) row.attendeeType = type;
        else row.problems.push(`Type "${value}" isn't one of Youth, Staff, Adult, or Underage.`);
      } else if (key === "classLevel") {
        const parsed = value.toLowerCase() === "none" ? { classLevel: null, isTlt: false } : rosterClassFrom(value);
        if (parsed === null) row.problems.push(`Class "${value}" isn't a Pathfinder class level.`);
        // "TLT" in the class column sets the TLT flag and leaves the class alone (#1851); settled after the loop.
        else if (parsed.isTlt) classTlt = true;
        else row.classLevel = parsed.classLevel;
      } else if (key === "isTlt") {
        const answer = value.toLowerCase();
        if (["yes", "y", "true", "1", "x"].includes(answer)) columnTlt = true;
        else if (["no", "n", "false", "0"].includes(answer)) columnTlt = false;
        else row.problems.push(`TLT "${value}" should be Yes or No, or left blank.`);
      } else if (key === "schoolGrade") {
        const grade = schoolGradeFromText(value);
        if (grade) row.schoolGrade = grade;
        else row.problems.push(`Grade "${value}" isn't K, 1 to 12, or Not in school.`);
      } else if (key === "baptized") {
        const answer = value.toLowerCase().replace(/[^a-z]/g, "");
        const match = answer === "y" ? "YES" : answer === "n" ? "NO" : clubBaptizedAnswers.find((item) => item.toLowerCase().replace(/_/g, "") === answer || clubBaptizedLabels[item].toLowerCase().replace(/[^a-z]/g, "") === answer);
        if (match) row.baptized = match;
        else row.problems.push(`Baptized "${value}" should be Yes, No or Not sure, or left blank.`);
      } else if (key === "role") {
        row.role = value.slice(0, 60);
      } else if (key === "gender") {
        const letter = value.toLowerCase()[0];
        if (letter === "f") row.gender = "FEMALE";
        else if (letter === "m") row.gender = "MALE";
        else row.problems.push(`Gender "${value}" should be Female or Male, or left blank.`);
      }
    });
    // The TLT column wins over a "TLT" class cell, whatever the column order (#1851).
    const tlt = columnTlt ?? (classTlt ? true : undefined);
    if (tlt !== undefined) row.isTlt = tlt;
    if (tlt === true && row.attendeeType !== undefined && row.attendeeType !== "YOUTH") {
      row.problems.push("TLT is only for youth. Change the type to Youth or leave TLT blank.");
    }
    if (!row.firstName || !row.lastName) row.problems.push("First and last name are both needed.");
    return row;
  });
}

function nameKey(firstName: string, lastName: string) {
  return formatPersonName({ firstName, lastName }).replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

const csvFieldOrder = ["birthDate", "attendeeType", "classLevel", "schoolGrade", "role", "gender"] as const;

/** The roster's fields (#424) an empty CSV cell left blank on this row. */
export function missingRosterCsvFields(row: RosterCsvRow): string[] {
  return csvFieldOrder.filter((field) => row[field] === undefined).map((field) => rosterFieldLabels[field]);
}

/**
 * What a new person from this row will be saved with (#424): a blank type is
 * Youth, and a blank role defaults by type (youth → "Pathfinder", others stay
 * blank). The import route saves exactly this.
 */
export function rosterCsvAddDefaults(row: RosterCsvRow) {
  const attendeeType: AttendeeType = row.attendeeType ?? "YOUTH";
  return { attendeeType, role: rosterRoleOrDefault(row.role, attendeeType) };
}

/**
 * The preview line for a new person (#424): which blanks get a default, then
 * what will still be missing on the roster afterwards.
 */
function addMessage(row: RosterCsvRow) {
  const { attendeeType, role } = rosterCsvAddDefaults(row);
  const defaults: string[] = [];
  if (row.attendeeType === undefined) defaults.push(`${rosterFieldLabels.attendeeType} → ${clubRosterAttendeeTypeLabels[attendeeType]}`);
  if (!(row.role ?? "").trim() && role) defaults.push(`${rosterFieldLabels.role} → ${role}`);
  const missing = missingRosterFields({
    attendeeType,
    role,
    classLevel: row.classLevel ?? null,
    schoolGrade: row.schoolGrade ?? null,
    gender: row.gender ?? null,
    birthDateNeeded: !row.birthDate,
  });
  return [
    "Will be added.",
    defaults.length > 0 ? `Will default: ${defaults.join(", ")}.` : "",
    missing.length > 0 ? `Missing: ${missing.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

export type RosterImportStep = {
  line: number;
  name: string;
  action: "ADD" | "UPDATE" | "SKIP";
  memberId: string | null;
  message: string;
  row: RosterCsvRow;
};

/** What the upload will do with each row, against this year's roster (names only). */
export function planRosterImport(rows: readonly RosterCsvRow[], existing: ReadonlyArray<{ id: string; firstName: string; lastName: string }>) {
  const byName = new Map<string, string[]>();
  for (const member of existing) {
    const key = nameKey(member.firstName, member.lastName);
    byName.set(key, [...(byName.get(key) ?? []), member.id]);
  }
  const seen = new Set<string>();
  return rows.map((row): RosterImportStep => {
    const name = formatPersonName(row);
    const key = nameKey(row.firstName, row.lastName);
    const skip = (message: string): RosterImportStep => ({ line: row.line, name, action: "SKIP", memberId: null, message, row });
    if (row.problems.length > 0) return skip(row.problems.join(" "));
    if (seen.has(key)) return skip("This name is already earlier in the file.");
    seen.add(key);
    const matches = byName.get(key) ?? [];
    if (matches.length > 1) return skip("More than one person on the roster has this name. Edit them by hand.");
    if (matches.length === 1) {
      // A TLT column alone (#1851) is a change too; it is never listed as blank, since it is optional.
      const changes = csvFieldOrder.filter((field) => row[field] !== undefined);
      if (changes.length === 0 && row.isTlt === undefined) return { line: row.line, name, action: "SKIP", memberId: matches[0], message: "Already on the roster; nothing to change.", row };
      // Blank cells on an update keep what's on file (#424), so they're only noted, not called missing.
      const blank = missingRosterCsvFields(row);
      const message = blank.length > 0
        ? `Will update what the file fills in. Blank in file: ${blank.join(", ")} (kept as on file).`
        : "Will update what the file fills in.";
      return { line: row.line, name, action: "UPDATE", memberId: matches[0], message, row };
    }
    if (!row.birthDate) return skip("New people need a birth date.");
    return { line: row.line, name, action: "ADD", memberId: null, message: addMessage(row), row };
  });
}
