import { z } from "zod";
import { scannerMealTypes, type MealTypeValue } from "@/modules/meals/domain";
import { serviceKey, serviceLabel, type ServedReport, type ServedRow } from "@/modules/meals/served-report";
import { toCsv } from "@/modules/reporting/csv";
import { KITCHEN_COUNT_MAX, KITCHEN_NOTE_MAX, kitchenCountKindLabels, kitchenCountKinds, type KitchenCountKind } from "@/modules/meals/kitchen-count-kinds";

export { KITCHEN_COUNT_MAX, KITCHEN_NOTE_MAX, kitchenCountKindLabels, kitchenCountKinds, type KitchenCountKind };

/**
 * Kitchen-entered counts per meal service (#1029): prepared, wasted, donated and transferred. Pure rules, no database.
 *
 * Every entry is append-only and carries who entered it and when. A correction is a new entry that names the entry it
 * supersedes; the current figure of a (service, kind) is the entry nothing supersedes, and the earlier entries stay in the
 * history. These counts are never added to, subtracted from or written over the served count, which comes only from the
 * scanner redemptions (#1028): the report keeps every column apart and shows prepared minus served as the variance.
 */

/** The short definitions shown with the report's columns (screen and the counts page). */
export const kitchenColumnDefinitions = {
  ordered: "Ordered: café meal tickets sold for the service, on live registrations. Not a count of food.",
  served: "Served: meals the café scanner recorded as eaten. Comes only from the imported scanner results.",
  PREPARED: "Prepared: portions the kitchen made, as the kitchen entered them.",
  WASTED: "Wasted: prepared portions thrown away, as the kitchen entered them.",
  DONATED: "Donated: prepared portions given away outside the event, as the kitchen entered them.",
  TRANSFERRED: "Transferred: prepared portions sent to another service or group, as the kitchen entered them.",
  variance: "Variance: prepared minus served. Positive means more was made than eaten. Blank until prepared is entered.",
} as const;

const serviceKeyPattern = /^(\d{4}-\d{2}-\d{2}|any):(BREAKFAST|LUNCH|SUPPER)$/;

/** Splits `2026-10-15:LUNCH` or `any:LUNCH` into the stored parts (`any` is stored as an empty date). Null when not a service key. */
export function parseServiceKey(key: string): { serviceDate: string; mealType: MealTypeValue } | null {
  const match = serviceKeyPattern.exec(key);
  if (!match) return null;
  const [date, meal] = key.split(":");
  if (date !== "any") {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  }
  return { serviceDate: date === "any" ? "" : date, mealType: meal as MealTypeValue };
}

export const kitchenCountInputSchema = z.object({
  serviceKey: z.string().regex(serviceKeyPattern, "Choose a meal service."),
  kind: z.enum(kitchenCountKinds),
  quantity: z.number({ error: "Enter a whole number." }).int("Enter a whole number.").min(0, "A count cannot be negative.").max(KITCHEN_COUNT_MAX, `A count cannot be more than ${KITCHEN_COUNT_MAX}.`),
  note: z.string().trim().max(KITCHEN_NOTE_MAX, `A note can be up to ${KITCHEN_NOTE_MAX} characters.`).nullish()
    .transform((value) => (value ? value : null)),
  /** The entry the person was looking at when they changed the figure, or null when there was none. A mismatch is refused. */
  supersedesId: z.string().min(1).max(64).nullable(),
}).strict();
export type KitchenCountInput = z.infer<typeof kitchenCountInputSchema>;

export type KitchenCountEntry = {
  id: string;
  serviceDate: string;
  mealType: MealTypeValue;
  kind: KitchenCountKind;
  quantity: number;
  note: string | null;
  enteredBy: string;
  enteredAt: string;
  supersedesId: string | null;
};

export type KitchenCountCell = { quantity: number; note: string | null; entryId: string; enteredBy: string; enteredAt: string };

export type KitchenCountRow = {
  key: string;
  label: string;
  serviceDate: string;
  mealType: MealTypeValue;
  ordered: number;
  served: number;
  /** The current entry per kind; absent while the kitchen has entered nothing (which is not the same as zero). */
  counts: Partial<Record<KitchenCountKind, KitchenCountCell>>;
  /** Prepared minus served, or null until prepared is entered. */
  variance: number | null;
  /** Every entry of the service, oldest first, with whether a later one superseded it. */
  history: Array<KitchenCountEntry & { superseded: boolean }>;
};
export type KitchenCountsTotals = {
  ordered: number;
  served: number;
  /** Per kind, the sum over services that have an entry; null when no service has one (nothing entered is not zero). */
  counts: Record<KitchenCountKind, number | null>;
  /** Prepared minus served over only the services where prepared was entered; null when none. */
  variance: number | null;
  /** The served total of those same services, shown beside the variance so it can be read against them. */
  varianceServed: number;
  varianceServices: number;
};
export type KitchenCountsReport = { rows: KitchenCountRow[]; totals: KitchenCountsTotals };

/** The current entry of every (service, kind): the one no other entry supersedes. */
export function currentEntries(entries: readonly KitchenCountEntry[]): KitchenCountEntry[] {
  const superseded = new Set(entries.map((entry) => entry.supersedesId).filter((id): id is string => Boolean(id)));
  return entries.filter((entry) => !superseded.has(entry.id));
}

export function kitchenVariance(prepared: number | undefined, served: number): number | null {
  return prepared === undefined ? null : prepared - served;
}

const mealOrder = (mealType: MealTypeValue) => scannerMealTypes.indexOf(mealType as (typeof scannerMealTypes)[number]);

/**
 * One row per service: every service with tickets sold, plus any service the kitchen entered counts for (so nothing
 * entered is ever hidden, even for a service with no tickets). Ordered and served are copied from the served report as
 * they are; nothing here changes them.
 */
export function buildKitchenCountsReport(served: Pick<ServedReport, "rows">, entries: readonly KitchenCountEntry[]): KitchenCountsReport {
  const rows = new Map<string, KitchenCountRow>();
  const ensure = (serviceDate: string, mealType: MealTypeValue, source?: ServedRow) => {
    const key = serviceKey(serviceDate, mealType);
    let row = rows.get(key);
    if (!row) {
      row = {
        key, label: serviceLabel(serviceDate, mealType), serviceDate, mealType,
        ordered: source?.sold.total ?? 0, served: source?.served.total ?? 0, counts: {}, variance: null, history: [],
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const row of served.rows) ensure(row.serviceDate, row.mealType, row);
  const ordered = [...entries].sort((a, b) => a.enteredAt.localeCompare(b.enteredAt) || a.id.localeCompare(b.id));
  const current = new Set(currentEntries(entries).map((entry) => entry.id));
  for (const entry of ordered) {
    const row = ensure(entry.serviceDate, entry.mealType);
    row.history.push({ ...entry, superseded: !current.has(entry.id) });
    if (current.has(entry.id)) {
      row.counts[entry.kind] = { quantity: entry.quantity, note: entry.note, entryId: entry.id, enteredBy: entry.enteredBy, enteredAt: entry.enteredAt };
    }
  }
  const sorted = [...rows.values()].sort((a, b) =>
    (a.serviceDate || "9999-99-99").localeCompare(b.serviceDate || "9999-99-99") || mealOrder(a.mealType) - mealOrder(b.mealType));
  const totals: KitchenCountsTotals = {
    ordered: 0, served: 0, counts: { PREPARED: null, WASTED: null, DONATED: null, TRANSFERRED: null }, variance: null, varianceServed: 0, varianceServices: 0,
  };
  for (const row of sorted) {
    row.variance = kitchenVariance(row.counts.PREPARED?.quantity, row.served);
    totals.ordered += row.ordered;
    totals.served += row.served;
    for (const kind of kitchenCountKinds) {
      const quantity = row.counts[kind]?.quantity;
      if (quantity !== undefined) totals.counts[kind] = (totals.counts[kind] ?? 0) + quantity;
    }
  }
  // The total variance only compares services where prepared was entered, so a missing entry never reads as zero made.
  const withPrepared = sorted.filter((row) => row.counts.PREPARED);
  totals.varianceServices = withPrepared.length;
  totals.varianceServed = withPrepared.reduce((sum, row) => sum + row.served, 0);
  totals.variance = withPrepared.length === 0 ? null : withPrepared.reduce((sum, row) => sum + (row.variance ?? 0), 0);
  return { rows: sorted, totals };
}

/** The per-service table as CSV, one column per measure, kept apart. Cells (notes included) are formula-escaped by `toCsv`. */
export function kitchenCountsCsv(report: KitchenCountsReport): string {
  const notes = (row: KitchenCountRow) => kitchenCountKinds
    .filter((kind) => row.counts[kind]?.note)
    .map((kind) => `${kitchenCountKindLabels[kind]}: ${row.counts[kind]?.note}`)
    .join(" | ");
  const cell = (value: number | null | undefined) => (value === undefined || value === null ? "" : value);
  return "﻿" + toCsv([
    ["Service", "Ordered (tickets sold)", "Served (scanner)", "Prepared", "Wasted", "Donated", "Transferred", "Variance (prepared minus served)", "Notes"],
    ...report.rows.map((row) => [
      row.label, row.ordered, row.served,
      cell(row.counts.PREPARED?.quantity), cell(row.counts.WASTED?.quantity), cell(row.counts.DONATED?.quantity), cell(row.counts.TRANSFERRED?.quantity),
      row.variance ?? "", notes(row),
    ]),
    [
      "All services", report.totals.ordered, report.totals.served,
      cell(report.totals.counts.PREPARED), cell(report.totals.counts.WASTED), cell(report.totals.counts.DONATED), cell(report.totals.counts.TRANSFERRED),
      report.totals.variance ?? "",
      report.totals.variance === null ? "" : `Variance covers only the ${report.totals.varianceServices} service${report.totals.varianceServices === 1 ? "" : "s"} with prepared entered (served there: ${report.totals.varianceServed}).`,
    ],
  ]);
}
