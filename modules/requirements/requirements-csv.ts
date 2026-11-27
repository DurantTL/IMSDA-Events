import { normalizeHonorCode } from "@/modules/honors/domain";
import { CsvImportError, parseCsvMatrix } from "@/modules/imports/csv-parser";
import { toCsv } from "@/modules/reporting/csv";
import {
  countTopLevelRequirements,
  isCalendarDate,
  MAX_REQUIREMENT_SECTION,
  MAX_REQUIREMENT_TEXT,
  REQUIREMENT_LABEL_PATTERN,
  type RequirementLine,
  sameRequirementLines,
} from "@/modules/requirements/domain";
import { type RequirementSource, requirementSourceForUrl } from "@/modules/requirements/sources";

/**
 * Honor requirements CSV (#2054): one row per requirement line, grouped by
 * honor code and language. `scripts/fetch-honor-requirements.ts` builds it
 * from the Pathfinder Wiki; staff review it and upload it on the honor
 * catalog. Text is taken only from a source whose license is recorded
 * (`./sources.ts`), and the License column has to name that license, so the
 * file states what it is importing under.
 *
 * Importing never deletes: an honor not in the file keeps its requirements,
 * text that hasn't changed is skipped, and changed text becomes a new version
 * with the old one kept (retired).
 */

export const REQUIREMENT_CSV_HEADERS = [
  "Code", "Honor", "Language", "Retrieved On", "Source URL", "License", "Section", "Number", "Item", "Text",
] as const;
export const MAX_REQUIREMENT_CSV_ROWS = 20_000;
export const MAX_REQUIREMENT_CSV_BYTES = 4_000_000;

export function requirementCsvTemplate() {
  return toCsv([[...REQUIREMENT_CSV_HEADERS]]);
}

export class RequirementCsvError extends Error {}

export type RequirementCsvRow = {
  line: number;
  code: string;
  honorName: string;
  language: string;
  retrievedOn: string;
  sourceUrl: string;
  license: string;
  section: string;
  number: number;
  label: string;
  text: string;
  problems: string[];
};

const clean = (value: string | undefined) => (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
/** The licensed text is kept as written: only canonical composition (NFC) and spacing, never NFKC, which would turn ½ into 1⁄2 or m² into m2. */
const cleanText = (value: string | undefined) => (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
/** Undoes the spreadsheet formula guard (`'=`) the CSV writer adds, so text starting with -, =, + or @ round-trips. */
const unguard = (value: string) => (/^'[=+\-@]/.test(value) ? value.slice(1) : value);

export function parseRequirementCsv(text: string): RequirementCsvRow[] {
  if (text.length > MAX_REQUIREMENT_CSV_BYTES) throw new RequirementCsvError("That file is too large. Split it into files of up to 20,000 rows.");
  let matrix: string[][];
  try {
    matrix = parseCsvMatrix(text.replace(/^﻿/, ""));
  } catch (error) {
    if (!(error instanceof CsvImportError)) throw error;
    if (error.message !== "The CSV is empty.") throw new RequirementCsvError("That file isn't a readable CSV. Check for a quote mark that isn't closed.");
    matrix = [];
  }
  if (matrix.length === 0) throw new RequirementCsvError("That file is empty. Download the template and fill it in.");
  const headers = matrix[0].map((header) => header.toLowerCase().replace(/[^a-z]/g, ""));
  const column = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const columns = {
    code: column("code", "honorcode"),
    honor: column("honor", "name", "honorname"),
    language: column("language", "lang"),
    retrievedOn: column("retrievedon", "retrieved"),
    sourceUrl: column("sourceurl", "source"),
    license: column("license", "licence"),
    section: column("section"),
    number: column("number", "requirement"),
    item: column("item", "part", "letter"),
    text: column("text", "requirementtext"),
  };
  const missing = (["code", "language", "retrievedOn", "sourceUrl", "license", "number", "text"] as const).filter((key) => columns[key] < 0);
  if (missing.length > 0) throw new RequirementCsvError("The first row needs the column names from the template, including Code, Language, Retrieved On, Source URL, License, Number and Text.");
  const body = matrix.slice(1).filter((cells) => cells.some((cell) => cell.trim() !== ""));
  if (body.length > MAX_REQUIREMENT_CSV_ROWS) throw new RequirementCsvError("Import up to 20,000 rows at a time.");

  return body.map((cells, index) => {
    const cell = (at: number) => (at < 0 ? "" : clean(cells[at]));
    const textCell = (at: number) => (at < 0 ? "" : cleanText(cells[at]));
    const numberText = cell(columns.number);
    const label = cell(columns.item).toLowerCase().replace(/[.)]+$/, "");
    const row: RequirementCsvRow = {
      line: index + 2,
      code: normalizeHonorCode(cell(columns.code)).slice(0, 40),
      honorName: textCell(columns.honor).slice(0, 120),
      language: cell(columns.language).toLowerCase(),
      retrievedOn: cell(columns.retrievedOn),
      sourceUrl: cell(columns.sourceUrl),
      license: cell(columns.license),
      section: unguard(textCell(columns.section)),
      number: Number(numberText),
      label,
      text: unguard(textCell(columns.text)),
      problems: [],
    };
    if (!row.code) row.problems.push("Every row needs an honor code.");
    if (!/^[a-z]{2}$/.test(row.language)) row.problems.push(`Language "${row.language}" should be a two-letter code such as en.`);
    if (!isCalendarDate(row.retrievedOn)) row.problems.push(`Retrieved On "${row.retrievedOn}" should be a date like 2026-11-27.`);
    if (!/^\d{1,3}$/.test(numberText) || row.number < 1) row.problems.push(`Number "${numberText}" should be a whole number from 1.`);
    if (label && !REQUIREMENT_LABEL_PATTERN.test(label)) row.problems.push(`Item "${label}" should be a letter (a, b) or a letter and a part (a.ii).`);
    if (!row.text) row.problems.push("Every row needs the requirement text.");
    if (row.text.length > MAX_REQUIREMENT_TEXT) row.problems.push("Requirement text is limited to 4,000 characters a row.");
    if (row.section.length > MAX_REQUIREMENT_SECTION) row.problems.push("A section name is limited to 120 characters.");
    return row;
  });
}

export type RequirementImportAction = "ADD" | "REPLACE" | "SKIP";

export type RequirementImportStep = {
  /** The first line of the honor's rows in the file. */
  line: number;
  code: string;
  name: string;
  language: string;
  action: RequirementImportAction;
  message: string;
  requirementCount: number;
  honorId: string | null;
  /** The current set this replaces, for REPLACE. */
  replacesSetId: string | null;
  source: RequirementSource | null;
  sourceUrl: string;
  retrievedOn: string;
  lines: RequirementLine[];
};

export type ExistingHonorForRequirements = { id: string; code: string; name: string };
export type CurrentRequirementSet = { id: string; honorId: string; language: string; sourceUrl: string; lines: RequirementLine[] };

const MAX_LISTED_PROBLEMS = 3;

/** One step per honor and language in the file, in the order each first appears. */
export function planRequirementImport(
  rows: readonly RequirementCsvRow[],
  honors: readonly ExistingHonorForRequirements[],
  currentSets: readonly CurrentRequirementSet[],
): RequirementImportStep[] {
  const honorByCode = new Map(honors.map((honor) => [honor.code, honor]));
  const currentByKey = new Map(currentSets.map((set) => [`${set.honorId}\u0000${set.language}`, set]));
  const groups = new Map<string, RequirementCsvRow[]>();
  for (const row of rows) {
    const key = `${row.code}\u0000${row.language}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.values()].map((group): RequirementImportStep => {
    const first = group[0]!;
    const honor = honorByCode.get(first.code) ?? null;
    const name = honor ? `${honor.name} (${honor.code})` : first.honorName ? `${first.honorName} (${first.code})` : first.code || `Line ${first.line}`;
    const lines = group.map(({ section, number, label, text }) => ({ section, number, label, text }));
    const base = {
      line: first.line,
      code: first.code,
      name,
      language: first.language,
      requirementCount: countTopLevelRequirements(lines),
      honorId: honor?.id ?? null,
      replacesSetId: null,
      source: null,
      sourceUrl: first.sourceUrl,
      retrievedOn: first.retrievedOn,
      lines,
    };
    const skip = (message: string): RequirementImportStep => ({ ...base, action: "SKIP", message });

    const rowProblems = group.flatMap((row) => row.problems.map((problem) => `Line ${row.line}: ${problem}`));
    if (rowProblems.length > 0) {
      const more = rowProblems.length - MAX_LISTED_PROBLEMS;
      return skip(`${rowProblems.slice(0, MAX_LISTED_PROBLEMS).join(" ")}${more > 0 ? ` And ${more} more.` : ""}`);
    }
    if (!honor) return skip(`No honor in the catalog has the code ${first.code}. Add the honor first.`);
    if (group.some((row) => row.sourceUrl !== first.sourceUrl)) return skip("Every row for an honor needs the same Source URL.");
    if (group.some((row) => row.retrievedOn !== first.retrievedOn)) return skip("Every row for an honor needs the same Retrieved On date.");
    if (group.some((row) => row.license !== first.license)) return skip("Every row for an honor needs the same License.");
    const source = requirementSourceForUrl(first.sourceUrl);
    if (!source) return skip("The Source URL isn't a page of a source whose license is recorded. Only Pathfinder Wiki pages can be imported.");
    if (first.license.toLowerCase() !== source.license.toLowerCase()) return skip(`The License should be ${source.license}, the license recorded for the ${source.name}.`);
    if (!source.languages.includes(first.language)) return skip(`Only ${source.languages.join(", ")} text can be imported for now.`);

    const seen = new Set<string>();
    const numbered = new Set<string>();
    // Requirements run 1, 2, 3 in each section, so a number read out of the text (such as "10.5 metres") is caught.
    const lastNumber = new Map<string, number>();
    for (const row of group) {
      const key = `${row.section}\u0000${row.number}\u0000${row.label}`;
      if (seen.has(key)) return skip(`Line ${row.line}: requirement ${row.number}${row.label ? row.label : ""} is in the file twice.`);
      seen.add(key);
      const parent = `${row.section}\u0000${row.number}`;
      if (row.label === "") {
        const expected = (lastNumber.get(row.section) ?? 0) + 1;
        if (row.number !== expected) return skip(`Line ${row.line}: requirement ${row.number} should be requirement ${expected}. Numbers run 1, 2, 3 in order; check the file against the source page.`);
        lastNumber.set(row.section, row.number);
      }
      if (row.label === "") numbered.add(parent);
      else if (!numbered.has(parent)) return skip(`Line ${row.line}: part ${row.label} comes before requirement ${row.number} itself.`);
    }

    const current = currentByKey.get(`${honor.id}\u0000${first.language}`);
    const step = { ...base, source };
    if (!current) return { ...step, action: "ADD", message: `Will add ${countLabel(base.requirementCount)}.` };
    if (current.sourceUrl === first.sourceUrl && sameRequirementLines(current.lines, lines)) {
      return { ...step, action: "SKIP", message: "Already up to date; nothing to change." };
    }
    return {
      ...step,
      action: "REPLACE",
      replacesSetId: current.id,
      message: `Will replace the current text with ${countLabel(base.requirementCount)}. The old version is kept.`,
    };
  });
}

function countLabel(count: number) {
  return `${count} ${count === 1 ? "requirement" : "requirements"}`;
}
