import { z } from "zod";
import { toCsv } from "@/modules/reporting/csv";
import type { ClubHeadcounts } from "@/modules/reporting/club-event-reports";

/**
 * The simple event budget sheet (#1682). Pure and database-free: the rules for a cost line, the totals, and the CSV.
 *
 * A planning sheet, not accounting: nothing here, or anywhere in `modules/event-budgets/`, writes a payment, invoice, ledger
 * entry or registration. The figures that fill in by themselves are read from the same functions Finance and the reports use
 * (`figures.ts`), never worked out again here.
 *
 * Kept deliberately small, with plain table and type names, so the full event budgeting (#88) can absorb this boundary later:
 * its `EventBudgetCostLine` rows can become that budget's expense lines without a data change.
 */

export const BUDGET_MODULE_KEY = "event-budget" as const;

/** The suggestions a cost line's label is chosen from. A free description goes beside it; "Other" is for anything else. */
export const COST_LABEL_SUGGESTIONS = [
  "Pins",
  "Trophies",
  "Ribbons",
  "Wristbands",
  "Camporee bars",
  "Porta-potties",
  "Staff meals",
  "Rooms",
  "Supplies",
  "Other",
] as const;
export type CostLabel = (typeof COST_LABEL_SUGGESTIONS)[number];

/** A sane ceiling for one line: $1,000,000. Matches the database check. */
export const MAX_COST_CENTS = 100_000_000;
export const MAX_QUANTITY = 100_000;
export const MAX_DESCRIPTION_LENGTH = 200;
/** A sheet is a short list, not a ledger. */
export const MAX_COST_LINES = 200;

export const costLineInputSchema = z.object({
  label: z.enum(COST_LABEL_SUGGESTIONS, { error: "Choose what the cost is for." }),
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH, `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`).default(""),
  quantity: z.number().int("Quantity must be a whole number.").min(1, "Quantity must be at least 1.").max(MAX_QUANTITY, "That quantity is too large.").nullish().transform((value) => value ?? null),
  amountCents: z.number({ error: "Enter an amount." }).int("Enter the amount in whole cents.").min(0, "The amount cannot be negative.").max(MAX_COST_CENTS, "That amount is too large."),
}).strict();
export type CostLineInput = z.infer<typeof costLineInputSchema>;

export const costLineUpdateSchema = costLineInputSchema.extend({ id: z.string().min(1).max(64) }).strict();
export const costLineDeleteSchema = z.object({ id: z.string().min(1).max(64) }).strict();

/** The switch body, the same as the other optional tools. */
export const budgetSettingsSchema = z.object({ enabled: z.boolean() }).strict();
export type BudgetSettingsInput = z.infer<typeof budgetSettingsSchema>;

/** Turns what a person typed into whole cents. "12", "12.5", "$1,200.00" work; anything else is null. */
export function parseDollarsToCents(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export type CostLineView = {
  id: string;
  label: string;
  description: string;
  quantity: number | null;
  amountCents: number;
};

/** The fee per person as the registration pages show it: one amount, several amounts, or none to show. */
export type FeePerPerson =
  | { kind: "uniform"; amountCents: number }
  | { kind: "varies"; lowCents: number; highCents: number }
  | { kind: "none" };

export type BudgetFigures = {
  /** Finance's own totals for the event (`summarizeFinanceTotals`). */
  money: { billedCents: number; churchBilledCents: number; receivedCents: number; outstandingCents: number; refundedCents: number };
  /** Active (submitted or confirmed) registrations with a total above zero. For a club event a registration is one club. */
  payingRegistrations: number;
  feePerPerson: FeePerPerson;
  /** The club event report's head counts, by type. */
  counts: ClubHeadcounts;
  /** Null when lodging is not set up for the event, so the figure is hidden. */
  rooms: number | null;
  /** Null when meals are not set up for the event, so the figure is hidden. */
  mealsOrdered: number | null;
};

export type BudgetTotals = {
  /** Billed to attendees plus billed to churches: what the event expects to bring in. */
  incomeBilledCents: number;
  /** What Finance shows as received so far, after refunds. */
  incomeReceivedCents: number;
  costsCents: number;
  /** Billed income minus costs. */
  netBilledCents: number;
  /** Received income minus costs. */
  netReceivedCents: number;
};

export function sumCostLines(lines: ReadonlyArray<Pick<CostLineView, "amountCents">>): number {
  return lines.reduce((total, line) => total + line.amountCents, 0);
}

export function computeBudgetTotals(money: BudgetFigures["money"], lines: ReadonlyArray<Pick<CostLineView, "amountCents">>): BudgetTotals {
  const incomeBilledCents = money.billedCents + money.churchBilledCents;
  const incomeReceivedCents = money.receivedCents;
  const costsCents = sumCostLines(lines);
  return {
    incomeBilledCents,
    incomeReceivedCents,
    costsCents,
    netBilledCents: incomeBilledCents - costsCents,
    netReceivedCents: incomeReceivedCents - costsCents,
  };
}

export type BudgetSheet = {
  eventId: string;
  eventName: string;
  figures: BudgetFigures;
  costLines: CostLineView[];
  totals: BudgetTotals;
};

/** Last year's sheet, read only, for an event that was copied from another. */
export type CarriedBudget =
  | { kind: "none" }
  | { kind: "no-sheet"; sourceEventId: string; sourceEventName: string }
  | { kind: "sheet"; sourceEventId: string; sourceEventName: string; sheet: BudgetSheet };

const dollars = (cents: number) => Number((cents / 100).toFixed(2));

function feeText(fee: FeePerPerson): string {
  if (fee.kind === "uniform") return String(dollars(fee.amountCents));
  if (fee.kind === "varies") return `${dollars(fee.lowCents)} to ${dollars(fee.highCents)}`;
  return "";
}

function sheetRows(sheet: BudgetSheet): Array<Array<string | number>> {
  const { figures, totals } = sheet;
  const rows: Array<Array<string | number>> = [
    ["Filled in from registrations", "", "", ""],
    ["Billed to attendees", "", "", dollars(figures.money.billedCents)],
    ["Billed to churches", "", "", dollars(figures.money.churchBilledCents)],
    ["Received so far (after refunds)", "", "", dollars(figures.money.receivedCents)],
    ["Still owed", "", "", dollars(figures.money.outstandingCents)],
    ["Refunded", "", "", dollars(figures.money.refundedCents)],
    ["Paying registrations", "", figures.payingRegistrations, ""],
    ["Fee per person", "", "", feeText(figures.feePerPerson)],
    ["Pathfinders", "", figures.counts.pathfinder, ""],
    ["TLTs", "", figures.counts.tlt, ""],
    ["Staff", "", figures.counts.staff, ""],
    ["Children", "", figures.counts.child, ""],
    ["Total people", "", figures.counts.total, ""],
  ];
  if (figures.rooms !== null) rows.push(["Rooms", "", figures.rooms, ""]);
  if (figures.mealsOrdered !== null) rows.push(["Meals ordered", "", figures.mealsOrdered, ""]);
  rows.push(["Costs", "Description", "Quantity", "Amount"]);
  for (const line of sheet.costLines) rows.push([line.label, line.description, line.quantity ?? "", dollars(line.amountCents)]);
  rows.push(
    ["Total income (billed)", "", "", dollars(totals.incomeBilledCents)],
    ["Total income (received)", "", "", dollars(totals.incomeReceivedCents)],
    ["Total costs", "", "", dollars(totals.costsCents)],
    ["Income minus costs (billed)", "", "", dollars(totals.netBilledCents)],
    ["Income minus costs (received)", "", "", dollars(totals.netReceivedCents)],
  );
  return rows;
}

/**
 * The CSV for the conference: totals, counts and cost lines only. No names, emails or any other personal data, and no
 * attendee or registration rows. Last year's sheet follows this year's when there is one.
 */
export function budgetCsv(sheet: BudgetSheet, carried: CarriedBudget): string {
  const rows: Array<Array<string | number>> = [
    ["Budget sheet", sheet.eventName, "", ""],
    ...sheetRows(sheet),
  ];
  if (carried.kind === "sheet") {
    rows.push(["", "", "", ""], ["Last year", carried.sourceEventName, "", ""], ...sheetRows(carried.sheet));
  } else if (carried.kind === "no-sheet") {
    rows.push(["", "", "", ""], ["Last year", carried.sourceEventName, "", ""], ["No budget sheet was kept for last year's event.", "", "", ""]);
  }
  return toCsv(rows);
}
