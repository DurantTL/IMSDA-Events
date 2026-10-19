import { mealTicketId, mealTypeLabels, scannerMealTypes, type MealPayerValue, type MealTypeValue } from "@/modules/meals/domain";
import { eventLocalDate } from "@/modules/meals/scanner-import";
import { toCsv } from "@/modules/reporting/csv";

/**
 * Meals served against tickets sold (#1028), for the kitchen report. One row per meal service: a service date and meal
 * for a ticket pinned to a day, or "any day" for a ticket good on any day of its meal (the registration form's tickets).
 * Every figure is split between paying (attendee) and conference-paid (staff, pastor, volunteer). Counts only: no names
 * anywhere in the summary, and the drill-down lists ticket ids, never people.
 */

export type ServedTicket = { id: string; number: number; mealType: MealTypeValue; serviceDate: string; payer: MealPayerValue };
export type ServedFigures = { paying: number; conference: number; total: number };
export type ServedRow = {
  /** `2026-10-15:LUNCH` or `any:LUNCH`: the drill-down's address. */
  key: string;
  /** Empty for a ticket good on any day. */
  serviceDate: string;
  mealType: MealTypeValue;
  label: string;
  sold: ServedFigures;
  served: ServedFigures;
  notUsed: ServedFigures;
};
export type ServedReport = { rows: ServedRow[]; totals: Omit<ServedRow, "key" | "serviceDate" | "mealType">; anyServed: boolean };

const zero = (): ServedFigures => ({ paying: 0, conference: 0, total: 0 });
const add = (figures: ServedFigures, payer: MealPayerValue) => {
  if (payer === "CONFERENCE") figures.conference += 1;
  else figures.paying += 1;
  figures.total += 1;
};
const minus = (a: ServedFigures, b: ServedFigures): ServedFigures => ({
  paying: a.paying - b.paying, conference: a.conference - b.conference, total: a.total - b.total,
});

export function serviceKey(serviceDate: string, mealType: MealTypeValue) {
  return `${serviceDate || "any"}:${mealType}`;
}

export function serviceLabel(serviceDate: string, mealType: MealTypeValue) {
  return `${serviceDate ? serviceDate : "Any day"} · ${mealTypeLabels[mealType]}`;
}

const mealOrder = (mealType: MealTypeValue) => scannerMealTypes.indexOf(mealType as (typeof scannerMealTypes)[number]);

export function buildServedReport(tickets: readonly ServedTicket[], served: ReadonlyMap<string, Date>): ServedReport {
  const rows = new Map<string, ServedRow>();
  for (const ticket of tickets) {
    const key = serviceKey(ticket.serviceDate, ticket.mealType);
    const row = rows.get(key) ?? {
      key, serviceDate: ticket.serviceDate, mealType: ticket.mealType, label: serviceLabel(ticket.serviceDate, ticket.mealType),
      sold: zero(), served: zero(), notUsed: zero(),
    };
    add(row.sold, ticket.payer);
    if (served.has(ticket.id)) add(row.served, ticket.payer);
    rows.set(key, row);
  }
  const sorted = [...rows.values()].sort((a, b) =>
    (a.serviceDate || "9999-99-99").localeCompare(b.serviceDate || "9999-99-99") || mealOrder(a.mealType) - mealOrder(b.mealType));
  const totals = { sold: zero(), served: zero(), notUsed: zero(), label: "All services" };
  for (const row of sorted) {
    row.notUsed = minus(row.sold, row.served);
    for (const figure of ["sold", "served", "notUsed"] as const) {
      totals[figure].paying += row[figure].paying;
      totals[figure].conference += row[figure].conference;
      totals[figure].total += row[figure].total;
    }
  }
  return { rows: sorted, totals, anyServed: totals.served.total > 0 };
}

export type ServedDrillRow = { ticketId: string; payer: MealPayerValue; served: boolean; servedOn: string };

/** The tickets of one service, by id only, in ticket order. `servedOn` is the event-local date the scanner served it. */
export function servedDrillDown(
  tickets: readonly ServedTicket[],
  served: ReadonlyMap<string, Date>,
  key: string,
  timeZone: string,
): ServedDrillRow[] {
  return tickets
    .filter((ticket) => serviceKey(ticket.serviceDate, ticket.mealType) === key)
    .sort((a, b) => a.number - b.number)
    .map((ticket) => {
      const at = served.get(ticket.id);
      return { ticketId: mealTicketId(ticket.number), payer: ticket.payer, served: Boolean(at), servedOn: at ? eventLocalDate(at, timeZone) : "" };
    });
}

/** The summary as CSV: counts only, one row per service plus a total, cells formula-escaped by `toCsv`. */
export function servedReportCsv(report: ServedReport): string {
  const line = (label: string, row: Pick<ServedRow, "sold" | "served" | "notUsed">) => [
    label,
    row.sold.paying, row.sold.conference, row.sold.total,
    row.served.paying, row.served.conference, row.served.total,
    row.notUsed.paying, row.notUsed.conference, row.notUsed.total,
  ];
  return "﻿" + toCsv([
    [
      "Service", "Sold (paying)", "Sold (conference-paid)", "Sold (total)", "Served (paying)", "Served (conference-paid)", "Served (total)",
      "Not used (paying)", "Not used (conference-paid)", "Not used (total)",
    ],
    ...report.rows.map((row) => line(row.label, row)),
    line("All services", report.totals),
  ]);
}
