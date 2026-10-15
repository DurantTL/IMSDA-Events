import { inflateRawSync } from "node:zlib";
import { CsvImportError, parseCsvMatrix } from "@/modules/imports/csv-parser";

/**
 * Reads an uploaded Cognito Forms export (#878) in memory: a CSV (one file per
 * sheet) or an Excel workbook (.xlsx, all sheets). Nothing is written to disk and
 * nothing is logged; the caller gets rows keyed by the header text and decides
 * what they mean. This file never sees a health value except to hand it on.
 *
 * The Excel reader is deliberately small (a ZIP central directory, shared
 * strings, plain cells) and bounded, so a hostile upload cannot expand without
 * limit. It reads cell values only: formulas, macros, links and images are ignored.
 */

export const MAX_HEALTH_IMPORT_FILE_BYTES = 8_000_000;
export const MAX_HEALTH_IMPORT_FILES = 4;
export const MAX_HEALTH_IMPORT_ROWS = 3_000;
const MAX_ZIP_ENTRIES = 200;
const MAX_ENTRY_BYTES = 15_000_000;
const MAX_CELLS_PER_ROW = 300;
const MAX_TOTAL_INFLATED_BYTES = 80_000_000;

export class HealthImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HealthImportFileError";
  }
}

export type SheetRows = { headers: string[]; rows: Array<Record<string, string>> };

// ---------------------------------------------------------------------------
// CSV

function sheetFromMatrix(matrix: string[][]): SheetRows {
  const headers = matrix[0]!.map((header) => header.replace(/^﻿/, "").trim());
  if (headers.every((header) => header === "")) throw new HealthImportFileError("A file has no header row.");
  if (matrix.length - 1 > MAX_HEALTH_IMPORT_ROWS) throw new HealthImportFileError(`A sheet has more than ${MAX_HEALTH_IMPORT_ROWS.toLocaleString("en-US")} rows. Export fewer entries at a time.`);
  const rows = matrix.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) row[header] = (values[index] ?? "").trim();
    });
    return row;
  });
  return { headers, rows };
}

export function readCsvSheet(bytes: Uint8Array): SheetRows {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HealthImportFileError("A CSV file isn't UTF-8 text. Export it again from Cognito Forms.");
  }
  try {
    return sheetFromMatrix(parseCsvMatrix(text));
  } catch (error) {
    if (error instanceof CsvImportError) throw new HealthImportFileError("A CSV file could not be read: it is empty or has an unterminated quote.");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ZIP / XLSX

type ZipEntry = { name: string; method: number; compressedSize: number; uncompressedSize: number; offset: number };

function listZip(bytes: Buffer): ZipEntry[] {
  // The end-of-central-directory record is in the last 64 KiB + 22 bytes.
  const searchFrom = Math.max(0, bytes.length - 65_557);
  let end = -1;
  for (let index = bytes.length - 22; index >= searchFrom; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new HealthImportFileError("That Excel file could not be read.");
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  if (count > MAX_ZIP_ENTRIES) throw new HealthImportFileError("That Excel file could not be read.");
  const entries: ZipEntry[] = [];
  for (let item = 0; item < count; item += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new HealthImportFileError("That Excel file could not be read.");
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    entries.push({
      method: bytes.readUInt16LE(cursor + 10),
      compressedSize: bytes.readUInt32LE(cursor + 20),
      uncompressedSize: bytes.readUInt32LE(cursor + 24),
      offset: bytes.readUInt32LE(cursor + 42),
      name: bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(bytes: Buffer, entry: ZipEntry, budget: { left: number }): string {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) throw new HealthImportFileError("That Excel file is too large to read.");
  const at = entry.offset;
  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== 0x04034b50) throw new HealthImportFileError("That Excel file could not be read.");
  const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
  const raw = bytes.subarray(start, start + entry.compressedSize);
  let data: Buffer;
  if (entry.method === 0) data = raw;
  else if (entry.method === 8) {
    try {
      data = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch {
      throw new HealthImportFileError("That Excel file could not be read.");
    }
  } else throw new HealthImportFileError("That Excel file could not be read.");
  budget.left -= data.length;
  if (budget.left < 0) throw new HealthImportFileError("That Excel file is too large to read.");
  return data.toString("utf8");
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(value: string) {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) return safeCodePoint(parseInt(entity.slice(2), 16), match);
      if (entity.startsWith("#")) return safeCodePoint(parseInt(entity.slice(1), 10), match);
      return XML_ENTITIES[entity.toLowerCase()] ?? match;
    });
}

function safeCodePoint(code: number, fallback: string) {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : fallback;
}

const TRUNCATED = "That Excel file looks cut off or damaged. Export it again from Cognito Forms.";

type Tag = { start: number; openEnd: number; selfClosing: boolean };

/**
 * The next `<name ...>` element start at or after `from`, found with indexOf only so a hostile sheet cannot make the
 * scan quadratic. `openEnd` is the index just past the start tag's `>`. Null when there is none (or it is cut off).
 */
function nextTag(xml: string, name: string, from: number): Tag | null {
  let at = from;
  for (;;) {
    const start = xml.indexOf(`<${name}`, at);
    if (start < 0) return null;
    const after = xml.charCodeAt(start + name.length + 1);
    // Whitespace, ">" or "/" ends the name: "<c" is not "<cols", "<t" is not "<tr".
    if (after === 32 || after === 9 || after === 10 || after === 13 || after === 62 || after === 47) {
      const close = xml.indexOf(">", start);
      if (close < 0) throw new HealthImportFileError(TRUNCATED);
      return { start, openEnd: close + 1, selfClosing: xml.charCodeAt(close - 1) === 47 };
    }
    at = start + 1;
  }
}

/** Each element's inner text, in order, linear in the input. A cut-off element ends the scan. */
function* elements(xml: string, name: string): Generator<{ inner: string; attributes: string }> {
  let cursor = 0;
  const closer = `</${name}>`;
  for (;;) {
    const tag = nextTag(xml, name, cursor);
    if (!tag) return;
    const attributes = xml.slice(tag.start + name.length + 1, tag.openEnd - 1);
    if (tag.selfClosing) {
      yield { inner: "", attributes };
      cursor = tag.openEnd;
      continue;
    }
    const end = xml.indexOf(closer, tag.openEnd);
    // A start tag with no end tag means the file is cut off. Refusing it beats importing the cells before the cut.
    if (end < 0) throw new HealthImportFileError(TRUNCATED);
    yield { inner: xml.slice(tag.openEnd, end), attributes };
    cursor = end + closer.length;
  }
}

/** Concatenated text of every `<t>` in a fragment (a shared string or inline string; rich-text runs join). */
function textOf(fragment: string) {
  let out = "";
  for (const part of elements(withoutPhonetic(fragment), "t")) out += decodeXml(part.inner);
  return out;
}

/** Drops `<rPh>` runs: the phonetic guide text (furigana) is not part of the cell's value. Linear, indexOf only. */
function withoutPhonetic(fragment: string) {
  if (!fragment.includes("<rPh")) return fragment;
  let out = "";
  let cursor = 0;
  for (;;) {
    const tag = nextTag(fragment, "rPh", cursor);
    if (!tag) return out + fragment.slice(cursor);
    out += fragment.slice(cursor, tag.start);
    if (tag.selfClosing) {
      cursor = tag.openEnd;
      continue;
    }
    const end = fragment.indexOf("</rPh>", tag.openEnd);
    if (end < 0) throw new HealthImportFileError(TRUNCATED);
    cursor = end + "</rPh>".length;
  }
}

function sharedStringsOf(xml: string | null): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  for (const item of elements(xml, "si")) {
    strings.push(textOf(item.inner));
    if (strings.length > 200_000) throw new HealthImportFileError("That Excel file is too large to read.");
  }
  return strings;
}

function columnIndex(reference: string) {
  const letters = /^[A-Z]+/.exec(reference.toUpperCase())?.[0] ?? "";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function attribute(attributes: string, name: string) {
  const marker = ` ${name}="`;
  const at = attributes.indexOf(marker);
  if (at < 0) return undefined;
  const start = at + marker.length;
  const end = attributes.indexOf('"', start);
  return end < 0 ? undefined : attributes.slice(start, end);
}

function matrixFromSheetXml(xml: string, shared: string[]): string[][] {
  const matrix: string[][] = [];
  for (const rowElement of elements(xml, "row")) {
    if (matrix.length > MAX_HEALTH_IMPORT_ROWS + 1) throw new HealthImportFileError(`A sheet has more than ${MAX_HEALTH_IMPORT_ROWS.toLocaleString("en-US")} rows. Export fewer entries at a time.`);
    const row: string[] = [];
    let next = 0;
    let cells = 0;
    for (const cell of elements(rowElement.inner, "c")) {
      cells += 1;
      if (cells > MAX_CELLS_PER_ROW) throw new HealthImportFileError("A sheet has too many columns to read.");
      const reference = attribute(cell.attributes, "r");
      const index = reference ? columnIndex(reference) : next;
      if (index < 0 || index >= MAX_CELLS_PER_ROW) continue;
      const type = attribute(cell.attributes, "t") ?? "n";
      let value = "";
      if (type === "inlineStr") value = textOf(cell.inner);
      else {
        const v = elements(cell.inner, "v").next().value;
        if (v) {
          if (type === "s") value = shared[Number(v.inner)] ?? "";
          else if (type === "b") value = v.inner.trim() === "1" ? "TRUE" : "FALSE";
          else value = decodeXml(v.inner);
        }
      }
      while (row.length < index) row.push("");
      row[index] = value;
      next = index + 1;
    }
    matrix.push(row);
  }
  return matrix.filter((row) => row.some((cell) => cell.trim() !== ""));
}

export function readXlsxSheets(bytes: Uint8Array): SheetRows[] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = listZip(buffer);
  const budget = { left: MAX_TOTAL_INFLATED_BYTES };
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const read = (name: string) => {
    const entry = byName.get(name);
    return entry ? readZipEntry(buffer, entry, budget) : null;
  };
  if (!byName.has("xl/workbook.xml")) throw new HealthImportFileError("That file isn't an Excel workbook.");
  const shared = sharedStringsOf(read("xl/sharedStrings.xml"));
  const sheetNames = entries.map((entry) => entry.name).filter((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (sheetNames.length === 0) throw new HealthImportFileError("That Excel file has no sheets.");
  const sheets: SheetRows[] = [];
  for (const name of sheetNames) {
    const matrix = matrixFromSheetXml(read(name) ?? "", shared);
    // A sheet with no header row (an empty sheet) is skipped; one that has headers but no data is kept.
    if (matrix.length > 0) sheets.push(sheetFromMatrix(matrix));
  }
  return sheets;
}

// ---------------------------------------------------------------------------
// Any upload

const isZip = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/** Every sheet in the uploaded files, as rows keyed by the header text. CSV is one sheet per file. */
export function readHealthImportFiles(files: Array<{ bytes: Uint8Array }>): SheetRows[] {
  if (files.length === 0) throw new HealthImportFileError("Choose the Cognito export file first.");
  if (files.length > MAX_HEALTH_IMPORT_FILES) throw new HealthImportFileError(`Choose at most ${MAX_HEALTH_IMPORT_FILES} files.`);
  const sheets: SheetRows[] = [];
  for (const file of files) {
    if (file.bytes.length === 0) throw new HealthImportFileError("A chosen file is empty.");
    if (file.bytes.length > MAX_HEALTH_IMPORT_FILE_BYTES) throw new HealthImportFileError("A chosen file is larger than 8 MB. Export fewer entries at a time.");
    if (isZip(file.bytes)) sheets.push(...readXlsxSheets(file.bytes));
    else sheets.push(readCsvSheet(file.bytes));
  }
  return sheets;
}
