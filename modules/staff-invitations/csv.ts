import { createHash } from "node:crypto";
import { parseCsvMatrix } from "@/modules/imports/csv-parser";
import {
  cleanName,
  isValidInvitationEmail,
  IMPORT_ROW_STATUSES,
  MAX_IMPORT_CHARACTERS,
  MAX_IMPORT_ROWS,
  NAME_MAX,
  normalizeInvitationEmail,
  parseInvitationGroup,
  type ExistingEmails,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportRowStatus,
  type StaffInvitationGroupValue,
} from "@/modules/staff-invitations/domain";

// ---------------------------------------------------------------------------------------------
// The CSV import and its preview
// ---------------------------------------------------------------------------------------------

export class InvitationCsvError extends Error {
  constructor(public readonly code: "INVALID_CSV" | "MISSING_EMAIL_COLUMN" | "TOO_MANY_ROWS" | "GROUP_REQUIRED" | "EMPTY", message: string) {
    super(message);
    this.name = "InvitationCsvError";
  }
}

const HEADER_ALIASES: Record<string, "email" | "firstName" | "lastName" | "group"> = {
  email: "email",
  e_mail: "email",
  email_address: "email",
  first_name: "firstName",
  firstname: "firstName",
  first: "firstName",
  given_name: "firstName",
  last_name: "lastName",
  lastname: "lastName",
  last: "lastName",
  surname: "lastName",
  family_name: "lastName",
  group: "group",
  type: "group",
};

function headerKey(value: string) {
  return value.replace(/^﻿/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function importDigest(rows: readonly Pick<ImportPreviewRow, "email" | "firstName" | "lastName" | "group" | "status">[]) {
  const creating = rows
    .filter((row) => row.status === "NEW")
    .map((row) => [row.email, row.firstName, row.lastName, row.group]);
  return createHash("sha256").update(JSON.stringify(creating)).digest("hex").slice(0, 32);
}

export type ParsedInvitationRow = Omit<ImportPreviewRow, "status"> & { problem: "INVALID_EMAIL" | "INVALID_GROUP" | "NAME_TOO_LONG" | null };

/**
 * Reads the CSV once. A required `email` column; optional first name, last name and group columns. A file with no group
 * column (or a blank group cell) uses `defaultGroup`, the group the office picked for the whole file. It throws
 * `InvitationCsvError` for a file that can't be read at all; otherwise every row is returned, with the problem it has on its
 * own (a bad email, an unknown group, a long name), if any.
 */
export function parseInvitationCsv(csv: string, defaultGroup: StaffInvitationGroupValue | null): ParsedInvitationRow[] {
  if (csv.length > MAX_IMPORT_CHARACTERS) {
    throw new InvitationCsvError("INVALID_CSV", "That file is too large. Split it into smaller files.");
  }
  let matrix: string[][];
  try {
    matrix = parseCsvMatrix(csv.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new InvitationCsvError("INVALID_CSV", error instanceof Error ? error.message : "The file could not be read as a CSV.");
  }
  const columns = new Map<"email" | "firstName" | "lastName" | "group", number>();
  matrix[0].forEach((header, index) => {
    const key = HEADER_ALIASES[headerKey(header)];
    if (key && !columns.has(key)) columns.set(key, index);
  });
  const emailColumn = columns.get("email");
  if (emailColumn === undefined) {
    throw new InvitationCsvError("MISSING_EMAIL_COLUMN", "The file needs a column named email in its first row.");
  }
  const groupColumn = columns.get("group");
  if (groupColumn === undefined && !defaultGroup) {
    throw new InvitationCsvError("GROUP_REQUIRED", "The file has no group column. Choose the group for everyone in it.");
  }
  const dataRows = matrix.slice(1);
  if (dataRows.length === 0) throw new InvitationCsvError("EMPTY", "The file has a header row but no people in it.");
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new InvitationCsvError("TOO_MANY_ROWS", `This file has more than ${MAX_IMPORT_ROWS} people. Split it into smaller files.`);
  }
  return dataRows.map((values, index): ParsedInvitationRow => {
    const cell = (column: number | undefined) => (column === undefined ? "" : (values[column] ?? ""));
    const email = normalizeInvitationEmail(cell(emailColumn));
    const firstName = cleanName(cell(columns.get("firstName")));
    const lastName = cleanName(cell(columns.get("lastName")));
    const groupText = cell(groupColumn).trim();
    const group = groupText ? parseInvitationGroup(groupText) : defaultGroup;
    const row = { line: index + 2, email, firstName, lastName, group };
    if (!isValidInvitationEmail(email)) return { ...row, problem: "INVALID_EMAIL" };
    if (!group) return { ...row, problem: "INVALID_GROUP" };
    if (firstName.length > NAME_MAX || lastName.length > NAME_MAX) return { ...row, problem: "NAME_TOO_LONG" };
    return { ...row, problem: null };
  });
}

/** The addresses of the usable rows, for looking up who already holds them. */
export function usableEmails(parsed: readonly ParsedInvitationRow[]) {
  return [...new Set(parsed.filter((row) => row.problem === null).map((row) => row.email))];
}

/** Says, row by row, what confirming would do, given who already holds each address. */
export function classifyInvitationRows(parsed: readonly ParsedInvitationRow[], existing: ExistingEmails): ImportPreview {
  const seen = new Set<string>();
  const rows: ImportPreviewRow[] = parsed.map(({ problem, ...row }): ImportPreviewRow => {
    if (problem) return { ...row, status: problem };
    if (seen.has(row.email)) return { ...row, status: "DUPLICATE_IN_FILE" };
    seen.add(row.email);
    if (existing.invited.has(row.email)) return { ...row, status: "ALREADY_INVITED" };
    if (existing.registered.has(row.email)) return { ...row, status: "ALREADY_REGISTERED" };
    return { ...row, status: "NEW" };
  });
  const counts = Object.fromEntries(IMPORT_ROW_STATUSES.map((status) => [status, 0])) as Record<ImportRowStatus, number>;
  for (const row of rows) counts[row.status] += 1;
  return { rows, counts, willCreate: counts.NEW, digest: importDigest(rows) };
}

/** Parse and classify in one step (for a caller that already knows who holds which address). */
export function buildImportPreview(input: { csv: string; defaultGroup: StaffInvitationGroupValue | null; existing: ExistingEmails }): ImportPreview {
  return classifyInvitationRows(parseInvitationCsv(input.csv, input.defaultGroup), input.existing);
}
