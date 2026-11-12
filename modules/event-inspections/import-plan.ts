import { createHash } from "node:crypto";
import { parseScoreText } from "@/modules/event-scoring/domain";
import { parseCsvMatrix } from "@/modules/imports/csv-parser";
import {
  importStatuses,
  maxImportBytes,
  maxImportRows,
  normalizeClubName,
  readInspectionKey,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportStatus,
  type InspectionKey,
} from "@/modules/event-inspections/domain";

/**
 * The inspection CSV import (#1896), pure and database-free. A file has the columns `club`, `inspection` (campsite or
 * uniform) and `score`; a `club id` or `club code` column is optional and, when a row fills it, picks the club exactly.
 * Clubs are matched by name among the clubs registered for the event, ignoring case, spacing and punctuation. Every row
 * gets a result and nothing is applied from here: the preview is shown first and applying needs the preview's digest.
 */

export class InspectionImportError extends Error {}

export type RegisteredClub = { organizationId: string; name: string; orgCode: string | null };

const clean = (value: string | undefined) => (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const headerKey = (header: string) => header.normalize("NFKC").toLowerCase().replace(/[^a-z]/g, "");

export function planInspectionImport(csv: string, clubs: readonly RegisteredClub[]): ImportPreview {
  if (csv.length > maxImportBytes) throw new InspectionImportError("That file is too large. Import up to 1,000 rows at a time.");
  let matrix: string[][];
  try {
    matrix = parseCsvMatrix(csv.replace(/^﻿/, ""));
  } catch (error) {
    throw new InspectionImportError(error instanceof Error ? error.message : "That file could not be read as a CSV.");
  }
  const headers = matrix[0].map(headerKey);
  const column = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const club = column("club", "clubname", "name");
  const idColumn = column("clubid", "clubcode", "orgcode", "organizationid", "code", "id");
  const inspection = column("inspection", "inspectiontype", "type");
  const score = column("score", "points", "total");
  if ((club < 0 && idColumn < 0) || inspection < 0 || score < 0) {
    throw new InspectionImportError("The first row needs the column names club, inspection and score.");
  }
  const body = matrix.slice(1);
  if (body.length === 0) throw new InspectionImportError("That file has no rows under the column names.");
  if (body.length > maxImportRows) throw new InspectionImportError("Import up to 1,000 rows at a time.");

  const byName = new Map<string, RegisteredClub[]>();
  const byId = new Map<string, RegisteredClub>();
  for (const registered of clubs) {
    const key = normalizeClubName(registered.name);
    byName.set(key, [...(byName.get(key) ?? []), registered]);
    byId.set(registered.organizationId.toLowerCase(), registered);
    if (registered.orgCode) byId.set(registered.orgCode.trim().toLowerCase(), registered);
  }

  const rows: ImportPreviewRow[] = body.map((cells, index) => {
    const row: ImportPreviewRow = {
      line: index + 2,
      status: "matched",
      clubText: (club >= 0 ? clean(cells[club]) : "") || (idColumn >= 0 ? clean(cells[idColumn]) : ""),
      inspectionText: clean(cells[inspection]),
      scoreText: clean(cells[score]),
      organizationId: null,
      clubName: null,
      inspection: null,
      hundredths: null,
      message: null,
    };
    const fail = (status: ImportStatus, message: string) => {
      row.status = status;
      row.message = message;
      return row;
    };
    const idText = idColumn >= 0 ? clean(cells[idColumn]).toLowerCase() : "";
    let found: RegisteredClub | null = null;
    if (idText) {
      found = byId.get(idText) ?? null;
      if (!found) return fail("unknown_club", "No club registered for this event has that id or code.");
    } else {
      const nameText = club >= 0 ? clean(cells[club]) : "";
      if (!nameText) return fail("unknown_club", "This row has no club.");
      const candidates = byName.get(normalizeClubName(nameText)) ?? [];
      if (candidates.length === 0) return fail("unknown_club", "No club registered for this event has this name.");
      if (candidates.length > 1) return fail("ambiguous_club", "Two registered clubs have this name. Add the club id or code column.");
      found = candidates[0];
    }
    const key = readInspectionKey(row.inspectionText);
    if (!key) return fail("bad_inspection", "Write campsite or uniform.");
    const parsed = parseScoreText("POINTS", row.scoreText);
    if (!parsed.ok) return fail("bad_score", parsed.message);
    row.organizationId = found.organizationId;
    row.clubName = found.name;
    row.inspection = key;
    row.hundredths = parsed.hundredths;
    return row;
  });

  // The same club and inspection twice: neither row is applied, because the file does not say which one is right.
  const seen = new Map<string, ImportPreviewRow[]>();
  for (const row of rows) {
    if (row.status !== "matched") continue;
    const key = `${row.organizationId}|${row.inspection}`;
    seen.set(key, [...(seen.get(key) ?? []), row]);
  }
  for (const group of seen.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.status = "duplicate";
      row.message = `This club and inspection appear on ${group.length} rows (lines ${group.map((member) => member.line).join(", ")}). Keep one.`;
    }
  }

  const counts = Object.fromEntries(importStatuses.map((status) => [status, 0])) as Record<ImportStatus, number>;
  for (const row of rows) counts[row.status] += 1;
  const digest = createHash("sha256").update(JSON.stringify({
    v: 1,
    rows: rows.map((row) => [row.line, row.status, row.organizationId, row.inspection, row.hundredths]),
  })).digest("hex");
  return { rows, counts, digest };
}

/** The rows an apply step writes: matched rows only. */
export function matchedRows(preview: ImportPreview): Array<ImportPreviewRow & { organizationId: string; inspection: InspectionKey; hundredths: number }> {
  return preview.rows.filter((row): row is ImportPreviewRow & { organizationId: string; inspection: InspectionKey; hundredths: number } =>
    row.status === "matched" && row.organizationId !== null && row.inspection !== null && row.hundredths !== null);
}
