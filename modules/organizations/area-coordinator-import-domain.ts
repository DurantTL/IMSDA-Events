import { isValidInvitationEmail, normalizeInvitationEmail } from "@/modules/staff-invitations/domain";
import { CsvImportError, parseCsvMatrix } from "@/modules/imports/csv-parser";
import { toCsv } from "@/modules/reporting/csv";
import { formatPersonName } from "@/lib/person-name";

/**
 * Area Coordinator CSV import (#1608): pure parsing and planning. The columns are the ones a FluentCRM contacts export
 * already has, so that file works as it is. Nothing here reads the database, saves, or emails anyone.
 */

export const AREA_COORDINATOR_CSV_HEADERS = ["First name", "Last name", "Email"] as const;
export const MAX_AREA_COORDINATOR_CSV_ROWS = 500;
export const MAX_AREA_COORDINATOR_CSV_BYTES = 200_000;
const NAME_PART_MAX = 80;

export function areaCoordinatorCsvTemplate() {
  return toCsv([[...AREA_COORDINATOR_CSV_HEADERS]]);
}

export class AreaCoordinatorCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AreaCoordinatorCsvError";
  }
}

export type AreaCoordinatorCsvRow = { line: number; firstName: string; lastName: string; rawEmail: string; email: string; problem: string | null };

const clean = (value: string | undefined) => (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
/** "First  NAME " and "first name" are the same header. */
const headerKey = (value: string | undefined) => clean(value?.replace(/^﻿/, "")).toLowerCase();

export function parseAreaCoordinatorCsv(text: string): AreaCoordinatorCsvRow[] {
  if (text.length > MAX_AREA_COORDINATOR_CSV_BYTES) throw new AreaCoordinatorCsvError("That file is too large. Upload up to 500 people at a time.");
  let matrix: string[][];
  try {
    matrix = parseCsvMatrix(text.replace(/^﻿/, ""));
  } catch (error) {
    if (error instanceof CsvImportError) throw new AreaCoordinatorCsvError(error.message);
    throw error;
  }
  if (matrix.length === 0) throw new AreaCoordinatorCsvError("That file is empty. Download the template and fill it in.");
  const headers = matrix[0].map(headerKey);
  const first = headers.indexOf("first name");
  const last = headers.indexOf("last name");
  const email = headers.indexOf("email");
  if (email === -1) {
    throw new AreaCoordinatorCsvError("The first row needs the column names from the template: First name, Last name and Email.");
  }
  // Rows are numbered by position after the header (the shared parser skips wholly blank lines), like the roster import.
  const lines = matrix.slice(1)
    .map((cells, index) => ({ cells, line: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => clean(cell) !== ""));
  if (lines.length === 0) throw new AreaCoordinatorCsvError("That file has no people in it. Download the template and fill it in.");
  if (lines.length > MAX_AREA_COORDINATOR_CSV_ROWS) throw new AreaCoordinatorCsvError("Upload up to 500 people at a time.");

  return lines.map(({ cells, line }) => {
    const rawEmail = clean(cells[email]);
    const normalized = normalizeInvitationEmail(rawEmail);
    const firstName = first === -1 ? "" : clean(cells[first]).slice(0, NAME_PART_MAX);
    const lastName = last === -1 ? "" : clean(cells[last]).slice(0, NAME_PART_MAX);
    const problem = !rawEmail
      ? "The email is missing."
      : !isValidInvitationEmail(normalized)
        ? "That doesn't look like an email address."
        : null;
    return { line, firstName, lastName, rawEmail, email: normalized, problem };
  });
}

export type AreaCoordinatorImportStep = {
  line: number;
  name: string;
  action: "ADD" | "SKIP" | "ERROR";
  message: string;
  email: string;
  inviteName: string;
};

/** What the preview shows: the CsvImportDialog has Add, Update and Skip, so an error row is shown as a skip with its reason. */
export type AreaCoordinatorPublicStep = { line: number; name: string; action: "ADD" | "UPDATE" | "SKIP"; message: string };

export function areaCoordinatorPublicStep(step: AreaCoordinatorImportStep): AreaCoordinatorPublicStep {
  return {
    line: step.line,
    name: step.name,
    action: step.action === "ADD" ? "ADD" : "SKIP",
    message: step.action === "ERROR" ? `Error: ${step.message}` : step.message,
  };
}

/**
 * Decides each row. The first row for an email wins. A row is skipped when that email already has an active grant or an
 * open (pending or sent) invite; a missing or invalid email is an error. Two different emails under one name are both
 * added.
 */
export function planAreaCoordinatorImport(
  rows: readonly AreaCoordinatorCsvRow[],
  existing: { grantEmails: ReadonlySet<string>; openInviteEmails: ReadonlySet<string> },
): AreaCoordinatorImportStep[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const inviteName = formatPersonName(row);
    const name = inviteName ? (row.rawEmail ? `${inviteName} (${row.rawEmail})` : inviteName) : row.rawEmail;
    const base = { line: row.line, name, email: row.email, inviteName };
    if (row.problem) return { ...base, action: "ERROR" as const, message: row.problem };
    if (seen.has(row.email)) return { ...base, action: "SKIP" as const, message: "This email is already on an earlier row of the file." };
    seen.add(row.email);
    if (existing.grantEmails.has(row.email)) return { ...base, action: "SKIP" as const, message: "Already an Area Coordinator." };
    if (existing.openInviteEmails.has(row.email)) return { ...base, action: "SKIP" as const, message: "Already has an open Area Coordinator invite." };
    return { ...base, action: "ADD" as const, message: "Will be added. Not emailed until you press Send." };
  });
}
