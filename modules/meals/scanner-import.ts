import { createHash } from "node:crypto";

import { CsvImportError, parseCsvMatrix } from "@/modules/imports/csv-parser";
import { mealTicketId, scannerMealTypes, type MealAgeGroupValue, type MealPayerValue, type MealTypeValue } from "@/modules/meals/domain";
import { MealError } from "@/modules/meals/errors";
import { formatInTimeZone } from "@/modules/calendar/conference-format";

/**
 * Café scanner results (#1028): the pure rules for reading what the scanner gives back and planning what to record. No
 * database and no clock, so the preview, the confirm step and the tests all plan the same way.
 *
 * Two files are accepted (Caleb, Oct 19, 2026):
 * - SHEET (preferred): the Google Sheet the scanner syncs with, downloaded as CSV. It is our own meal tickets export
 *   with `redeemed`, `redeemed_at` and `redeemed_by` filled in, so a row matches its ticket by the exact `ticket_id`.
 * - TRANSACTIONS: the scanner's `transactions.csv`. It has no ticket id, so a SUCCESS row is matched by registration
 *   (`scannedValue`), guest name, meal and event-local date. A row matching no ticket, or more than one kind of ticket,
 *   goes to the review list and is never recorded.
 *
 * Nothing here trusts the file: a row is checked against the ticket it names, and every outcome that is not a clean
 * match is shown to staff rather than saved.
 */

export const SCANNER_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const SCANNER_IMPORT_MAX_ROWS = 20_000;
/** How many review and conflict rows the preview lists; the counts always cover every row. */
export const SCANNER_PREVIEW_ROWS_SHOWN = 200;

export type ScannerSource = "SHEET" | "TRANSACTIONS";
export const scannerSourceLabels: Record<ScannerSource, string> = {
  SHEET: "Google Sheet (CSV download)",
  TRANSACTIONS: "Scanner transactions.csv",
};

export type ScannerSheetRow = {
  line: number;
  ticketId: string;
  regId: string;
  guestName: string;
  mealType: string;
  redeemed: string;
  redeemedAt: string;
  redeemedBy: string;
};
export type ScannerTransactionRow = {
  line: number;
  timestamp: string;
  scannedValue: string;
  mealType: string;
  result: string;
  stationName: string;
  /** The guest the scanner served (`entitlementPersonName`). Blank is never filled in from the person columns. */
  guestName: string;
};
export type ParsedScannerFile =
  | { source: "SHEET"; rows: ScannerSheetRow[] }
  | { source: "TRANSACTIONS"; rows: ScannerTransactionRow[] };

const normalizeHeader = (value: string) => value.replace(/^﻿/, "").trim().toLowerCase();

const sheetRequired = ["ticket_id", "reg_id", "guest_name", "meal_type", "redeemed", "redeemed_at", "redeemed_by"] as const;
const transactionRequired = ["timestamp", "scannedvalue", "mealtype", "result"] as const;

/** A leading apostrophe the scanner (or our export) puts before `=`, `+`, `-`, `@`, tab or CR to defuse a formula. */
export function stripFormulaGuard(value: string) {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

/** Reads a scanner file and works out which of the two formats it is. Throws a MealError (INVALID) for anything else. */
export function parseScannerFile(text: string): ParsedScannerFile {
  let matrix: string[][];
  try {
    matrix = parseCsvMatrix(text.replace(/^﻿/, ""));
  } catch (error) {
    if (error instanceof CsvImportError) throw new MealError("INVALID", error.message);
    throw error;
  }
  if (matrix.length - 1 > SCANNER_IMPORT_MAX_ROWS) {
    throw new MealError("INVALID", `The file has more than ${SCANNER_IMPORT_MAX_ROWS.toLocaleString("en-US")} rows. Export a shorter period and try again.`);
  }
  const header = matrix[0]!.map(normalizeHeader);
  const index = (name: string) => header.indexOf(name);
  const cell = (row: string[], name: string) => (index(name) >= 0 ? (row[index(name)] ?? "").trim() : "");
  const body = matrix.slice(1);

  if (index("ticket_id") >= 0) {
    const missing = sheetRequired.filter((name) => index(name) < 0);
    if (missing.length > 0) throw new MealError("INVALID", `The Google Sheet export is missing these columns: ${missing.join(", ")}.`);
    return {
      source: "SHEET",
      rows: body.map((row, position) => ({
        line: position + 2,
        ticketId: cell(row, "ticket_id"),
        regId: cell(row, "reg_id"),
        guestName: stripFormulaGuard(cell(row, "guest_name")),
        mealType: cell(row, "meal_type"),
        redeemed: cell(row, "redeemed"),
        redeemedAt: cell(row, "redeemed_at"),
        redeemedBy: stripFormulaGuard(cell(row, "redeemed_by")),
      })),
    };
  }
  if (index("scannedvalue") >= 0) {
    const missing = transactionRequired.filter((name) => index(name) < 0);
    if (missing.length > 0) throw new MealError("INVALID", `The transactions file is missing these columns: ${missing.join(", ")}.`);
    return {
      source: "TRANSACTIONS",
      rows: body.map((row, position) => ({
        line: position + 2,
        timestamp: cell(row, "timestamp"),
        scannedValue: cell(row, "scannedvalue"),
        mealType: cell(row, "mealtype"),
        result: cell(row, "result"),
        stationName: cell(row, "stationname"),
        guestName: stripFormulaGuard(cell(row, "entitlementpersonname")),
      })),
    };
  }
  throw new MealError("INVALID", "This is not a café scanner file. Use the Google Sheet downloaded as CSV (it has a ticket_id column) or the scanner's transactions.csv.");
}

// ---------------------------------------------------------------------------
// Text, meal and time normalization
// ---------------------------------------------------------------------------

/** Names are compared without case, accents' composition, extra spaces or a leading formula guard. */
export function normalizeName(value: string) {
  return stripFormulaGuard(value).normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The scanner says `dinner`; the meals module says supper. Only the three scanner meals are known. */
export function scannerMealType(value: string): MealTypeValue | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "breakfast") return "BREAKFAST";
  if (normalized === "lunch") return "LUNCH";
  if (normalized === "dinner" || normalized === "supper") return "SUPPER";
  return null;
}

/** The scanner's `parseBool`: 1, true, yes or y. */
export const scannerSaysRedeemed = (value: string) => ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
function zoneParts(date: Date, timeZone: string) {
  let formatter = dateTimeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    dateTimeFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

/** The calendar date (YYYY-MM-DD) an instant falls on in the event's time zone. */
export function eventLocalDate(date: Date, timeZone: string) {
  const { year, month, day } = zoneParts(date, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A time for people, in the event's time zone (never the viewer's or the server's). */
export function eventLocalDateTime(date: Date, timeZone: string) {
  return formatInTimeZone(date, timeZone, { dateStyle: "medium", timeStyle: "short" });
}

const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The time the scanner wrote: an ISO instant with a zone (`2026-10-15T18:30:00.000Z`). A time without a zone (what Google
 * Sheets shows when it turns the text into a date-time) is refused, not guessed at: the sheet's zone is unknown. Null then.
 */
export function parseScannerInstant(value: string): Date | null {
  const text = value.trim();
  if (!isoInstant.test(text)) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The instant cut to whole UTC seconds (`2026-10-15T18:30:00Z`): what a redemption key uses, so a re-saved copy that lost the milliseconds matches the raw export. */
export function utcSecond(date: Date) {
  return `${new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** A live, active ticket of the event, as the café file would carry it. */
export type ImportTicket = {
  id: string;
  number: number;
  confirmationCode: string;
  guestName: string;
  mealType: MealTypeValue;
  /** Event-local service date; empty for a ticket good any day. */
  serviceDate: string;
  payer: MealPayerValue;
  ageGroup: MealAgeGroupValue | null;
};

export type ReviewReason =
  | "UNKNOWN_TICKET"
  | "WRONG_EVENT"
  | "INACTIVE_TICKET"
  | "MISMATCH"
  | "NO_MATCH"
  | "AMBIGUOUS"
  | "ALL_USED"
  | "INVALID_ROW"
  | "DUPLICATE_ROW";

export const reviewReasonLabels: Record<ReviewReason, string> = {
  UNKNOWN_TICKET: "Unknown ticket",
  WRONG_EVENT: "Ticket of another event",
  INACTIVE_TICKET: "Cancelled ticket",
  MISMATCH: "Row disagrees with its ticket",
  NO_MATCH: "No matching ticket",
  AMBIGUOUS: "More than one possible ticket",
  ALL_USED: "Every matching ticket is already used",
  INVALID_ROW: "Row could not be read",
  DUPLICATE_ROW: "Same ticket twice in the file",
};

export type PlannedRedemption = {
  line: number;
  ticketId: string;
  ticketNumber: number;
  occurredAt: string;
  redeemedByText: string | null;
  sourceKey: string;
};
export type PlannedConflict = {
  /** UNREDEEM: the file shows a served ticket as not redeemed. REREDEEM: the file shows a ticket served again after an accepted un-redeem. */
  kind: "UNREDEEM" | "REREDEEM";
  line: number;
  ticketId: string;
  ticketNumber: number;
  /** UNREDEEM: when the ticket is recorded as served. REREDEEM: when the file says it was served. */
  servedAt: string;
  /** The key the correction would carry: one per recorded event, so accepting twice is impossible. */
  sourceKey: string;
  /** REREDEEM only: the scanner's `redeemed_by` text for the new redemption. */
  redeemedByText: string | null;
};
export type ReviewRow = {
  line: number;
  reason: ReviewReason;
  /** Short description of what was in the row (never more than ids, meal and the name as written). */
  summary: string;
};

export type ScannerPlan = {
  source: ScannerSource;
  fileSha256: string;
  rowCount: number;
  counts: {
    /** Rows that would add a redemption. */
    newRedemptions: number;
    /** Rows already recorded (re-uploads) or that change nothing. */
    unchanged: number;
    /** Rows that un-redeem a ticket recorded as served. */
    conflicts: number;
    /** Rows left for staff to look at; nothing is saved for them. */
    review: number;
    /** Sheet rows for tickets the scanner has not redeemed. */
    notRedeemed: number;
    /** Transaction rows that were not SUCCESS. */
    notSuccess: number;
  };
  byReason: Partial<Record<ReviewReason, number>>;
  redemptions: PlannedRedemption[];
  conflicts: PlannedConflict[];
  review: ReviewRow[];
  /** The event already holds redemptions from the other file kind, so the same meal could be counted twice. */
  otherSourceHasRedemptions: boolean;
  /** Identifies what confirming would do; the confirm step must reproduce it. */
  digest: string;
};

export type PlanInput = {
  file: ParsedScannerFile;
  fileSha256: string;
  timeZone: string;
  /** Active tickets of live registrations. */
  tickets: readonly ImportTicket[];
  /** Ticket numbers of the event that are not active (cancelled, or their registration is no longer live). */
  inactiveNumbers: ReadonlySet<number>;
  /** Ticket numbers that exist in some other event, among those the file names. */
  otherEventNumbers: ReadonlySet<number>;
  /** Tickets whose latest event is REDEEMED, with that event's key and time. */
  served: ReadonlyMap<string, { sourceKey: string; occurredAt: Date }>;
  /** Tickets whose latest event is UNREDEEMED, with that event's key. */
  unredeemed: ReadonlyMap<string, string>;
  /** Every redemption key already stored for the event. */
  existingKeys: ReadonlySet<string>;
  /** The file kinds that already hold REDEEMED events for the event. */
  existingSources: ReadonlySet<ScannerSource>;
};

const ticketNumberPattern = /^MT-(\d{5,})$/i;
const SUMMARY_LIMIT = 140;
const clip = (value: string) => (value.length > SUMMARY_LIMIT ? `${value.slice(0, SUMMARY_LIMIT)}...` : value);
const BY_LIMIT = 120;

function emptyCounts(): ScannerPlan["counts"] {
  return { newRedemptions: 0, unchanged: 0, conflicts: 0, review: 0, notRedeemed: 0, notSuccess: 0 };
}

export function planScannerImport(input: PlanInput): ScannerPlan {
  const counts = emptyCounts();
  const byReason: Partial<Record<ReviewReason, number>> = {};
  const redemptions: PlannedRedemption[] = [];
  const conflicts: PlannedConflict[] = [];
  const review: ReviewRow[] = [];
  const toReview = (line: number, reason: ReviewReason, summary: string) => {
    counts.review += 1;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    review.push({ line, reason, summary: clip(summary) });
  };

  if (input.file.source === "SHEET") planSheet(input, input.file.rows, { counts, redemptions, conflicts, toReview });
  else planTransactions(input, input.file.rows, { counts, redemptions, toReview });

  const otherSource: ScannerSource = input.file.source === "SHEET" ? "TRANSACTIONS" : "SHEET";
  const otherSourceHasRedemptions = input.existingSources.has(otherSource);
  const digest = createHash("sha256").update(JSON.stringify({
    v: 1,
    source: input.file.source,
    file: input.fileSha256,
    redemptions: redemptions.map((row) => [row.ticketId, row.sourceKey, row.occurredAt]),
    conflicts: conflicts.map((row) => [row.ticketId, row.sourceKey, row.kind]),
    otherSourceHasRedemptions,
  })).digest("hex");
  return {
    source: input.file.source,
    fileSha256: input.fileSha256,
    rowCount: input.file.rows.length,
    counts,
    byReason,
    redemptions,
    conflicts,
    review,
    otherSourceHasRedemptions,
    digest,
  };
}

type Sinks = {
  counts: ScannerPlan["counts"];
  redemptions: PlannedRedemption[];
  toReview: (line: number, reason: ReviewReason, summary: string) => void;
};

function planSheet(input: PlanInput, rows: readonly ScannerSheetRow[], sinks: Sinks & { conflicts: PlannedConflict[] }) {
  const byNumber = new Map(input.tickets.map((ticket) => [ticket.number, ticket]));
  const seen = new Set<string>();
  for (const row of rows) {
    const label = `${row.ticketId || "(no ticket id)"} ${row.guestName}`.trim();
    const matched = ticketNumberPattern.exec(row.ticketId.trim());
    if (!matched) {
      sinks.toReview(row.line, "INVALID_ROW", `${label}: the ticket id is not an MT- number`);
      continue;
    }
    const number = Number(matched[1]);
    const ticket = byNumber.get(number);
    if (!ticket) {
      if (input.otherEventNumbers.has(number)) sinks.toReview(row.line, "WRONG_EVENT", `${label}: this ticket belongs to another event`);
      else if (input.inactiveNumbers.has(number)) sinks.toReview(row.line, "INACTIVE_TICKET", `${label}: the ticket was cancelled`);
      else sinks.toReview(row.line, "UNKNOWN_TICKET", `${label}: no such ticket in this event`);
      continue;
    }
    const meal = scannerMealType(row.mealType);
    if (row.regId.trim().toUpperCase() !== ticket.confirmationCode.toUpperCase() || meal !== ticket.mealType) {
      sinks.toReview(row.line, "MISMATCH", `${label}: the registration or meal does not match ticket ${mealTicketId(number)}`);
      continue;
    }
    // The scanner writes back by row position, and `redeemed_by` is the guest it actually served. A row that has moved
    // away from its ticket names someone other than its own guest_name.
    if (row.redeemedBy.trim() !== "" && normalizeName(row.redeemedBy) !== normalizeName(row.guestName)) {
      sinks.toReview(row.line, "MISMATCH", `${label}: served as "${row.redeemedBy}", not this ticket's guest (the row may have moved)`);
      continue;
    }
    if (seen.has(ticket.id)) {
      sinks.toReview(row.line, "DUPLICATE_ROW", `${label}: ${mealTicketId(number)} appears more than once`);
      continue;
    }
    seen.add(ticket.id);
    const current = input.served.get(ticket.id);

    if (!scannerSaysRedeemed(row.redeemed)) {
      if (current) {
        sinks.counts.conflicts += 1;
        sinks.conflicts.push({
          kind: "UNREDEEM", line: row.line, ticketId: ticket.id, ticketNumber: number, servedAt: current.occurredAt.toISOString(),
          sourceKey: `unredeem:${current.sourceKey}`, redeemedByText: null,
        });
      } else {
        sinks.counts.notRedeemed += 1;
      }
      continue;
    }
    const at = parseScannerInstant(row.redeemedAt);
    if (!at) {
      sinks.toReview(row.line, "INVALID_ROW", `${label}: redeemed is yes but redeemed_at is not an ISO time with a zone (for example 2026-10-15T18:30:00.000Z)`);
      continue;
    }
    const sourceKey = `sheet:${mealTicketId(number)}:${utcSecond(at)}`;
    if (current) {
      sinks.counts.unchanged += 1;
      continue;
    }
    if (input.existingKeys.has(sourceKey)) {
      // This exact redemption was imported before and a correction has since undone it. Offer to put it back; never do it silently.
      const lastUnredeem = input.unredeemed.get(ticket.id);
      if (lastUnredeem) {
        sinks.counts.conflicts += 1;
        sinks.conflicts.push({
          kind: "REREDEEM", line: row.line, ticketId: ticket.id, ticketNumber: number, servedAt: at.toISOString(),
          sourceKey: `reredeem:${lastUnredeem}`, redeemedByText: row.redeemedBy ? row.redeemedBy.slice(0, BY_LIMIT) : null,
        });
      } else {
        sinks.counts.unchanged += 1;
      }
      continue;
    }
    sinks.counts.newRedemptions += 1;
    sinks.redemptions.push({
      line: row.line, ticketId: ticket.id, ticketNumber: number, occurredAt: at.toISOString(),
      redeemedByText: row.redeemedBy ? row.redeemedBy.slice(0, BY_LIMIT) : null, sourceKey,
    });
  }
}

function planTransactions(input: PlanInput, rows: readonly ScannerTransactionRow[], sinks: Sinks) {
  const indexKey = (code: string, meal: MealTypeValue, name: string) => `${code.toUpperCase()}|${meal}|${name}`;
  const index = new Map<string, ImportTicket[]>();
  for (const ticket of [...input.tickets].sort((a, b) => a.number - b.number)) {
    const key = indexKey(ticket.confirmationCode, ticket.mealType, normalizeName(ticket.guestName));
    index.set(key, [...(index.get(key) ?? []), ticket]);
  }
  const used = new Set<string>();
  const sourceKeys = new Map<string, number>();

  // Oldest scan first, so which row claims a ticket never depends on the order the scanner exported them in.
  const ordered = rows
    .map((row) => ({ row, at: parseScannerInstant(row.timestamp) }))
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0) || a.row.line - b.row.line);

  for (const { row, at } of ordered) {
    if (row.result.trim().toUpperCase() !== "SUCCESS") {
      sinks.counts.notSuccess += 1;
      continue;
    }
    const meal = scannerMealType(row.mealType);
    const label = `${row.scannedValue} ${row.guestName} ${row.mealType.toLowerCase()}`.trim();
    if (!meal || !(scannerMealTypes as readonly string[]).includes(meal) || !at || !row.scannedValue || !row.guestName) {
      sinks.toReview(row.line, "INVALID_ROW", `${label}: the meal, time, registration or guest name (entitlementPersonName) is missing or not understood`);
      continue;
    }
    const name = normalizeName(row.guestName);
    // The key is stored forever: the registration and the guest are hashed into it, never written out.
    const who = sha256Hex(`${row.scannedValue.trim().toUpperCase()}|${name}`);
    const baseKey = `tx:${utcSecond(at)}:${meal}:${who}`;
    const repeat = sourceKeys.get(baseKey) ?? 0;
    sourceKeys.set(baseKey, repeat + 1);
    const sourceKey = repeat === 0 ? baseKey : `${baseKey}#${repeat + 1}`;
    if (input.existingKeys.has(sourceKey)) {
      sinks.counts.unchanged += 1;
      continue;
    }
    const localDate = eventLocalDate(at, input.timeZone);
    const candidates = (index.get(indexKey(row.scannedValue.trim(), meal, name)) ?? [])
      .filter((ticket) => ticket.serviceDate === "" || ticket.serviceDate === localDate);
    if (candidates.length === 0) {
      sinks.toReview(row.line, "NO_MATCH", `${label} on ${localDate}: no ticket for this registration, guest, meal and day`);
      continue;
    }
    const free = candidates.filter((ticket) => !input.served.has(ticket.id) && !used.has(ticket.id));
    if (free.length === 0) {
      sinks.toReview(row.line, "ALL_USED", `${label} on ${localDate}: every matching ticket is already recorded as served`);
      continue;
    }
    // Tickets of one selection are interchangeable; a different payer, day or age group is a different ticket.
    const kinds = new Set(free.map((ticket) => `${ticket.payer}|${ticket.serviceDate}|${ticket.ageGroup ?? ""}`));
    if (kinds.size > 1) {
      sinks.toReview(row.line, "AMBIGUOUS", `${label} on ${localDate}: ${kinds.size} different kinds of ticket could match`);
      continue;
    }
    const ticket = free[0]!;
    used.add(ticket.id);
    sinks.counts.newRedemptions += 1;
    sinks.redemptions.push({
      line: row.line, ticketId: ticket.id, ticketNumber: ticket.number, occurredAt: at.toISOString(),
      // The station that scanned it, never the guest: a transactions file has no `redeemed_by`.
      redeemedByText: row.stationName ? row.stationName.slice(0, BY_LIMIT) : null, sourceKey,
    });
  }
}

/** The ticket numbers a sheet file names, so the loader can tell another event's ticket from an unknown one. */
export function sheetTicketNumbers(file: ParsedScannerFile): number[] {
  if (file.source !== "SHEET") return [];
  const numbers = new Set<number>();
  for (const row of file.rows) {
    const matched = ticketNumberPattern.exec(row.ticketId.trim());
    if (matched) numbers.add(Number(matched[1]));
  }
  return [...numbers];
}

export const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");
